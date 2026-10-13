const zlib = require("zlib");

/**
 * Protección de las placas oficiales contra el robo (portado de protect.py del kit de la placa de precipitaciones):
 *  - Firma invisible: 256 bits (el texto de FIRMA) repartidos en los bloques de 8×8 de la luminancia, cada uno codificado
 *    en el signo de (coef[3,2] − coef[2,3]) de su DCT. Sobrevive a copiar el archivo y, en general, a recortes y recompresión
 *    suaves; se lee con `detectarFirma`.
 *  - Metadatos dentro del PNG: autoría, copyright, «prohibido para entrenar IA» (tEXt, XMP y Exif).
 * Las posiciones de los bits salen de un generador con semilla fija (distinto del de numpy del script original: la firma
 * se verifica con `detectarFirma` de acá, no con el script de Python).
 */
const PASO = 14; // diferencia mínima entre los dos coeficientes: más = más robusta y más visible
const SEMILLA = 20261013;

const aBits = (buf) => Array.from(buf).flatMap((b) => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1));
/** 32 bytes exactos, como en el script (rellena con «_» y recorta). */
const cargaDe = (texto) => Buffer.from(String(texto).slice(0, 32).padEnd(32, "_"), "latin1");

function generador(semilla) { // mulberry32
  let a = semilla >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const asignacion = (n, nbits) => { const r = generador(SEMILLA); return Uint16Array.from({ length: n }, () => Math.floor(r() * nbits)); };

// Base del DCT-II ortonormal de 8 puntos: BASE[u][x].
const BASE = Array.from({ length: 8 }, (_, u) => Float32Array.from({ length: 8 }, (_, x) => (u === 0 ? Math.sqrt(1 / 8) : 0.5) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)));
/** Coeficiente (u = fila, v = columna) del DCT de un bloque de 8×8 de Y que empieza en (bx, by). */
function coef(Y, w, bx, by, u, v) {
  let s = 0;
  for (let y = 0; y < 8; y++) { const bu = BASE[u][y]; let f = 0; for (let x = 0; x < 8; x++) f += Y[(by + y) * w + bx + x] * BASE[v][x]; s += bu * f; }
  return s;
}
const luminancia = (rgba, n) => { const Y = new Float32Array(n); for (let i = 0; i < n; i++) Y[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]); return Y; };

/** Incrusta la firma en un ImageData RGBA (opaco); lo modifica y lo devuelve. */
function incrustarFirma(imageData, firma) {
  const { width: w, height: h, data } = imageData, bits = aBits(cargaDe(firma)), nbx = Math.floor(w / 8), nby = Math.floor(h / 8);
  const Y = luminancia(data, w * h), asg = asignacion(nbx * nby, bits.length);
  for (let by = 0; by < nby; by++) for (let bx = 0; bx < nbx; bx++) {
    const b = bits[asg[by * nbx + bx]], d = coef(Y, w, bx * 8, by * 8, 3, 2) - coef(Y, w, bx * 8, by * 8, 2, 3);
    if ((b && d >= PASO) || (!b && d <= -PASO)) continue;
    const adj = ((b ? PASO : -PASO) - d) / 2; // +adj en (3,2) y −adj en (2,3)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const dy = adj * (BASE[3][y] * BASE[2][x] - BASE[2][y] * BASE[3][x]), i = ((by * 8 + y) * w + bx * 8 + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round(data[i + c] + dy))); // sumar a Y = sumar a R, G y B
    }
  }
  return imageData;
}

/** Lee la firma de un ImageData RGBA → string (32 caracteres). Sin firma da basura. */
function detectarFirma(imageData) {
  const { width: w, height: h, data } = imageData, nbx = Math.floor(w / 8), nby = Math.floor(h / 8), nb = 256;
  const Y = luminancia(data, w * h), asg = asignacion(nbx * nby, nb), votos = new Float64Array(nb);
  for (let by = 0; by < nby; by++) for (let bx = 0; bx < nbx; bx++) votos[asg[by * nbx + bx]] += Math.sign(coef(Y, w, bx * 8, by * 8, 3, 2) - coef(Y, w, bx * 8, by * 8, 2, 3));
  const bytes = Buffer.alloc(32);
  for (let i = 0; i < nb; i++) if (votos[i] > 0) bytes[i >> 3] |= 1 << (7 - (i & 7));
  return bytes.toString("latin1");
}

// ---- Metadatos PNG (tEXt, iTXt con XMP, eXIf) ----
const TABLA_CRC = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(tipo, datos) {
  const t = Buffer.from(tipo, "latin1"), largo = Buffer.alloc(4), crc = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length); crc.writeUInt32BE(crc32(Buffer.concat([t, datos])));
  return Buffer.concat([largo, t, datos, crc]);
}
const tEXt = (k, v) => chunk("tEXt", Buffer.concat([Buffer.from(k, "latin1"), Buffer.from([0]), Buffer.from(v, "latin1")]));
const iTXt = (k, v) => chunk("iTXt", Buffer.concat([Buffer.from(k, "latin1"), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(v, "utf8")])); // sin compresión, sin idioma ni clave traducida

/** Exif mínimo (TIFF little-endian) con cuatro textos. */
function exif(tags) {
  const orden = Object.entries(tags).sort(([a], [b]) => a - b), n = orden.length;
  let offset = 8 + 2 + n * 12 + 4;
  const cab = Buffer.alloc(10 + n * 12 + 4), datos = [];
  cab.write("II", 0, "latin1"); cab.writeUInt16LE(42, 2); cab.writeUInt32LE(8, 4); cab.writeUInt16LE(n, 8);
  orden.forEach(([tag, texto], i) => {
    const v = Buffer.concat([Buffer.from(texto, "latin1"), Buffer.from([0])]), p = 10 + i * 12;
    cab.writeUInt16LE(Number(tag), p); cab.writeUInt16LE(2, p + 2); cab.writeUInt32LE(v.length, p + 4); cab.writeUInt32LE(offset, p + 8);
    datos.push(v); offset += v.length + (v.length % 2);
    if (v.length % 2) datos.push(Buffer.from([0]));
  });
  return Buffer.concat([cab, ...datos]);
}

/** Agrega los metadatos de autoría/copyright al PNG (antes del primer IDAT). */
function conMetadatos(png, { titulo, descripcion, fecha }) {
  const AUTOR = "Dirección General de Alerta Temprana - Gobierno de Misiones", COPY = `© ${fecha.slice(0, 4)} Gobierno de Misiones. Todos los derechos reservados.`;
  const DESC = descripcion || "Placa oficial. Prohibida su reproducción, edición o alteración, y su uso para entrenamiento o procesamiento por sistemas de inteligencia artificial, sin autorización expresa.";
  const textos = { Title: titulo, Author: AUTOR, Copyright: COPY, Description: DESC, Source: "Dirección General de Alerta Temprana - Subsecretaría de Ordenamiento Territorial - Ministerio de Ecología y RNR", "AI-Training": "prohibited", noai: "true", noimageai: "true", "Creation Time": fecha };
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" xmlns:plus="http://ns.useplus.org/ldf/xmp/1.0/">\n<dc:creator><rdf:Seq><rdf:li>${esc(AUTOR)} - Subsecretaría de Ordenamiento Territorial</rdf:li></rdf:Seq></dc:creator>\n<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${esc(COPY)}</rdf:li></rdf:Alt></dc:rights>\n<xmpRights:Marked>True</xmpRights:Marked>\n<xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">${esc(DESC)} Si se cita, mencionar la fuente: Dirección General de Alerta Temprana, Gobierno de Misiones.</rdf:li></rdf:Alt></xmpRights:UsageTerms>\n<plus:DataMining>http://ns.useplus.org/ldf/vocab/DMI-PROHIBITED-EXCEPTSEARCHENGINEINDEXING</plus:DataMining>\n</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const extra = Buffer.concat([
    ...Object.entries(textos).map(([k, v]) => tEXt(k, v)),
    iTXt("XML:com.adobe.xmp", xmp),
    chunk("eXIf", exif({ 0x013b: AUTOR, 0x8298: COPY, 0x010e: DESC, 0x0131: "Gobierno de Misiones - Alerta Temprana" })),
  ]);
  const finIHDR = 8 + 4 + 4 + 13 + 4; // firma PNG + chunk IHDR completo
  return Buffer.concat([png.subarray(0, finIHDR), extra, png.subarray(finIHDR)]);
}

/** Lee los textos tEXt de un PNG (para verificar). */
function leerTextos(png) {
  const out = {}; let p = 8;
  while (p < png.length) {
    const largo = png.readUInt32BE(p), tipo = png.toString("latin1", p + 4, p + 8);
    if (tipo === "tEXt") { const d = png.subarray(p + 8, p + 8 + largo), i = d.indexOf(0); out[d.toString("latin1", 0, i)] = d.toString("latin1", i + 1); }
    p += 12 + largo;
  }
  return out;
}

module.exports = { incrustarFirma, detectarFirma, conMetadatos, leerTextos, cargaDe, PASO };
