const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PDFDocument = require("pdfkit");
const { partesCondicion, CATALOGO } = require("./condiciones");
const { DIR_ICONOS } = require("./iconResolver");

/**
 * Informe «PREVISIÓN DEL TIEMPO PARA LA PROVINCIA DE MISIONES» en PDF, armado desde lo que se carga en el panel
 * (ya no se usa Word). Sigue el orden del informe de la DGAT: datos generales, resumen por zona, el detalle de cada zona
 * con sus localidades, el pronóstico extendido y los informes de los días.
 *
 * Protección: el PDF sale cifrado (AES-256) con clave de propietario propia y permisos acotados (se puede abrir e
 * imprimir; no copiar, modificar ni anotar). La clave es `PDF_OWNER_PASSWORD` del entorno; sin ella se usa una al azar
 * por archivo (nadie la conoce: el documento queda sellado). Lleva marca de agua en cada página.
 *
 * El borrador (`b`) es el del asistente del panel (mapa-frontend/src/components/InformePronostico.jsx):
 * {
 *   fecha: "AAAA-MM-DD", emision: "09:00",
 *   generales: { sol, luna, vientos, humedad, presion, faseLunar, riesgo }, avisoGeneral,
 *   zonas: { Norte|Centro|Sur: { tmin, tmax, condicion, aviso, humedad, viento, riesgo } },
 *   localidades: [{ localidad, zona, tmin, tmax, condicion }],
 *   extendido: { Norte|Centro|Sur: [{ fecha, tmin, tmax, condicion }] },
 *   informes: [{ fecha, resumen, precipitaciones, vientos, temperaturas }],
 * }
 */
const DATA = path.join(__dirname, "..", "..", "data");
const FUENTE = { normal: path.join(DATA, "alertas", "OakSans-Regular.ttf"), bold: path.join(DATA, "alertas", "OakSans-Bold.ttf"), titulo: path.join(DATA, "alertas", "aviso-especial", "OakSans-ExtraBold.ttf") };
const LOGOS = { alerta: path.join(DATA, "brand", "alerta-temprana.png"), flor: path.join(DATA, "brand", "ecologia-flor.png") };

const VERDE = "#3E6C51", VERDE_OSCURO = "#234131", CREMA = "#FAF4EB", GRIS = "#5d6f64", LINEA = "#cdd8d1", ROJO = "#B3262F", AZUL = "#1F5F9E";
const ZONAS = ["Norte", "Centro", "Sur"];
const M = 36, ANCHO = 595.28 - 2 * M, PIE = 36;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const fechaPartes = (iso) => { const [a, m, d] = String(iso).split("-").map(Number); const f = new Date(Date.UTC(a, m - 1, d, 12)); return { a, m, d, dia: DIAS[f.getUTCDay()] }; };
const fechaLarga = (iso) => { const f = fechaPartes(iso); return `${f.dia} ${f.d} de ${MESES[f.m - 1]} de ${f.a}`; };
const fechaDia = (iso) => { const f = fechaPartes(iso); return `${f.dia} ${f.d} de ${MESES[f.m - 1]}`; };
const fechaCorta = (iso) => { const f = fechaPartes(iso); return `${String(f.d).padStart(2, "0")}/${String(f.m).padStart(2, "0")}/${f.a}`; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const temp = (v) => { const s = String(v ?? "").trim(); return /^-?\d+([.,]\d+)?$/.test(s) ? `${s}°C` : s || "—"; };

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v, max = 1200) => typeof v === "string" && v.length <= max;

/** Valida la forma del borrador (los textos pueden venir vacíos: el PDF se puede bajar incompleto, como el borrador). */
function errorDeInforme(b) {
  if (!b || typeof b !== "object") return "Falta el informe.";
  if (!RE_FECHA.test(String(b.fecha || ""))) return "Falta la fecha del informe.";
  if (!b.zonas || ZONAS.some((z) => typeof b.zonas[z] !== "object" || !b.zonas[z])) return "Faltan las tres zonas.";
  if (!Array.isArray(b.localidades) || b.localidades.length > 40) return "Las localidades no son válidas.";
  if (!b.extendido || ZONAS.some((z) => !Array.isArray(b.extendido[z]) || b.extendido[z].length > 5)) return "El pronóstico extendido no es válido.";
  if (!Array.isArray(b.informes) || b.informes.length > 5) return "Los informes de los días no son válidos.";
  const campos = [...Object.values(b.generales || {}), b.avisoGeneral, ...ZONAS.flatMap((z) => Object.values(b.zonas[z])), ...b.localidades.flatMap((l) => Object.values(l)),
    ...ZONAS.flatMap((z) => b.extendido[z].flatMap((d) => Object.values(d))), ...b.informes.flatMap((i) => Object.values(i))];
  if (campos.some((c) => c != null && !texto(String(c), 2000))) return "Hay un texto demasiado largo.";
  return null;
}

// --- íconos: los PNG del SMN (data/iconos-smn), leídos una vez --------------------------------------------------
const cachePng = new Map();
const iconoPng = async (archivo) => {
  const nombre = path.basename(archivo); // «smn/3.png» → 3.png
  if (!cachePng.has(nombre)) cachePng.set(nombre, fs.readFileSync(path.join(DIR_ICONOS, nombre)));
  return cachePng.get(nombre);
};

/** Las condiciones de un texto con sus íconos de día ya cargados. */
async function condiciones(textoCond) {
  return Promise.all(partesCondicion(textoCond).map(async (c) => ({ nombre: c.nombre, dia: await iconoPng(c.dia), noche: await iconoPng(c.noche) })));
}

async function generarInformePdf(b, { claveDuenio = process.env.PDF_OWNER_PASSWORD } = {}) {
  const error = errorDeInforme(b);
  if (error) throw Object.assign(new Error(error), { status: 400 });

  // Los íconos se piden antes de dibujar (el dibujo es síncrono): una vez por texto de condición distinto.
  const textos = new Set([...ZONAS.map((z) => b.zonas[z].condicion), ...b.localidades.map((l) => l.condicion), ...ZONAS.flatMap((z) => b.extendido[z].map((d) => d.condicion))]);
  const iconos = new Map(await Promise.all([...textos].map(async (t) => [t, await condiciones(t)])));

  const chunks = [];
  const doc = new PDFDocument({
    size: "A4", margins: { top: M, bottom: PIE + 10, left: M, right: M }, bufferPages: true, pdfVersion: "1.7ext3",
    ownerPassword: claveDuenio || crypto.randomBytes(24).toString("hex"),
    permissions: { printing: "highResolution", modifying: false, copying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false },
    info: { Title: `Previsión del tiempo para la provincia de Misiones — ${fechaCorta(b.fecha)}`, Author: "Dirección General de Alerta Temprana — Ministerio de Ecología y RNR de Misiones", Subject: "Previsión del tiempo", Creator: "Sistema de Alerta Temprana" },
  });
  doc.on("data", (c) => chunks.push(c));
  const terminado = new Promise((ok, mal) => { doc.on("end", () => ok(Buffer.concat(chunks))); doc.on("error", mal); });
  doc.registerFont("Oak", FUENTE.normal); doc.registerFont("Oak-Bold", FUENTE.bold); doc.registerFont("Oak-Titulo", FUENTE.titulo);

  const limite = () => doc.page.height - doc.page.margins.bottom;
  /** Si lo que sigue no entra en lo que queda de la página, pasa a la siguiente. */
  const espacio = (alto) => { if (doc.y + alto > limite()) doc.addPage(); };

  function marcaDeAgua() {
    doc.save();
    doc.fillOpacity(0.055).fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(46);
    doc.rotate(-38, { origin: [doc.page.width / 2, doc.page.height / 2] });
    const t1 = "MINISTERIO DE ECOLOGÍA", t2 = "ALERTA TEMPRANA";
    doc.text(t1, 0, doc.page.height / 2 - 52, { width: doc.page.width, align: "center", lineBreak: false });
    doc.fontSize(34).text(t2, 0, doc.page.height / 2 + 4, { width: doc.page.width, align: "center", lineBreak: false });
    doc.restore();
  }
  let numero = 0;
  function encabezadoDePagina() {
    numero++;
    marcaDeAgua();
    if (numero === 1) return;
    doc.font("Oak-Bold").fontSize(8).fillColor(GRIS).text(`PREVISIÓN DEL TIEMPO · MISIONES · ${fechaCorta(b.fecha)}`, M, 18, { width: ANCHO, lineBreak: false });
    doc.y = M;
  }
  doc.on("pageAdded", encabezadoDePagina);
  encabezadoDePagina();

  // --- piezas ---------------------------------------------------------------------------------------------------
  const barra = (titulo, color = VERDE) => {
    espacio(30);
    const y = doc.y;
    doc.roundedRect(M, y, ANCHO, 20, 4).fill(color);
    doc.fillColor("#fff").font("Oak-Bold").fontSize(10.5).text(titulo.toUpperCase(), M + 10, y + 5.5, { width: ANCHO - 20, lineBreak: false });
    doc.y = y + 26;
  };
  const filaDato = (rotulo, valor) => {
    if (!String(valor ?? "").trim()) return;
    doc.font("Oak").fontSize(9.5);
    const alto = Math.max(14, doc.heightOfString(String(valor), { width: ANCHO - 120 }) + 3);
    espacio(alto);
    const y = doc.y;
    doc.fillColor(GRIS).font("Oak-Bold").fontSize(8.5).text(rotulo.toUpperCase(), M + 4, y + 1.5, { width: 105, lineBreak: false });
    doc.fillColor("#1b2a22").font("Oak").fontSize(9.5).text(String(valor), M + 112, y, { width: ANCHO - 120 });
    doc.y = y + alto;
  };
  /** Íconos de día (uno por condición) y el texto, en una celda de `ancho`. Devuelve el alto usado. */
  const celdaCondicion = (x, y, ancho, textoCond, alto = 26) => {
    const lista = iconos.get(textoCond) || [];
    let cx = x;
    for (const c of lista.slice(0, 4)) { doc.image(c.dia, cx, y + (alto - 24) / 2, { width: 24, height: 24 }); cx += 25; }
    doc.fillColor("#1b2a22").font("Oak").fontSize(9).text(textoCond || "—", cx + 3, y + (alto - 11) / 2 - (doc.heightOfString(textoCond || "—", { width: x + ancho - cx - 3 }) > 12 ? 5 : 0), { width: x + ancho - cx - 3 });
  };
  const tablaLocalidades = (filas) => {
    const cols = [{ x: M + 6, w: 130 }, { x: M + 140, w: 44 }, { x: M + 190, w: 44 }, { x: M + 242, w: ANCHO - 248 }];
    espacio(22 + 28);
    let y = doc.y;
    doc.rect(M, y, ANCHO, 16).fill("#eaf2ee");
    doc.fillColor(VERDE_OSCURO).font("Oak-Bold").fontSize(8);
    ["LOCALIDAD", "MÍN", "MÁX", "CONDICIÓN ESPERADA"].forEach((t, i) => doc.text(t, cols[i].x, y + 4.5, { width: cols[i].w, lineBreak: false }));
    y += 16;
    for (const f of filas) {
      if (y + 28 > limite()) { doc.addPage(); y = doc.y; }
      doc.moveTo(M, y + 28).lineTo(M + ANCHO, y + 28).lineWidth(0.5).strokeColor(LINEA).stroke();
      doc.fillColor("#1b2a22").font("Oak-Bold").fontSize(9.5).text(String(f.localidad).toUpperCase(), cols[0].x, y + 9, { width: cols[0].w, lineBreak: false });
      doc.fillColor(AZUL).font("Oak-Bold").fontSize(10.5).text(temp(f.tmin), cols[1].x, y + 8.5, { width: cols[1].w, lineBreak: false });
      doc.fillColor(ROJO).text(temp(f.tmax), cols[2].x, y + 8.5, { width: cols[2].w, lineBreak: false });
      celdaCondicion(cols[3].x, y, cols[3].w, f.condicion);
      y += 28;
    }
    doc.y = y + 6;
  };
  const alerta = (valor) => {
    const t = String(valor ?? "").trim() || "SIN AVISOS.";
    const sin = /^sin\s+avisos?\.?$/i.test(t) || /^s\/a$/i.test(t);
    espacio(20);
    const y = doc.y;
    doc.roundedRect(M, y, ANCHO, 17, 4).fill(sin ? "#eef3f0" : "#fdeaea");
    doc.fillColor(sin ? GRIS : ROJO).font("Oak-Bold").fontSize(9).text(`AVISO DE ALERTA: ${t.toUpperCase()}`, M + 8, y + 4.5, { width: ANCHO - 16, lineBreak: false });
    doc.y = y + 23;
  };

  // --- encabezado -----------------------------------------------------------------------------------------------
  doc.image(LOGOS.alerta, M - 6, M - 14, { width: 92 });
  doc.image(LOGOS.flor, M + ANCHO - 44, M - 2, { width: 44 });
  doc.fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(17).text("PREVISIÓN DEL TIEMPO", M + 96, M - 4, { width: ANCHO - 150, lineBreak: false });
  doc.font("Oak-Bold").fontSize(11).fillColor(VERDE).text("PARA LA PROVINCIA DE MISIONES", M + 96, M + 17, { width: ANCHO - 150, lineBreak: false });
  doc.font("Oak").fontSize(9).fillColor(GRIS).text(`Datos: ${cap(fechaLarga(b.fecha))}${b.emision ? ` · emisión ${b.emision} h` : ""}`, M + 96, M + 34, { width: ANCHO - 150, lineBreak: false });
  doc.moveTo(M, M + 54).lineTo(M + ANCHO, M + 54).lineWidth(1.5).strokeColor(VERDE).stroke();
  doc.y = M + 66;

  // --- datos generales --------------------------------------------------------------------------------------------
  const g = b.generales || {};
  barra("Datos generales");
  filaDato("Sol", g.sol); filaDato("Luna", g.luna); filaDato("Vientos", g.vientos); filaDato("Humedad", g.humedad);
  filaDato("Presión", g.presion); filaDato("Fase lunar", g.faseLunar); filaDato("Riesgo", g.riesgo);
  doc.y += 6;

  // --- resumen por zona -------------------------------------------------------------------------------------------
  barra("Resumen por zona");
  for (const z of ZONAS) {
    const d = b.zonas[z];
    espacio(34);
    const y = doc.y;
    doc.fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(11).text(z.toUpperCase(), M + 6, y + 9, { width: 60, lineBreak: false });
    doc.font("Oak").fontSize(8).fillColor(GRIS).text("MIN – MAX", M + 70, y + 4, { width: 60, lineBreak: false });
    doc.font("Oak-Bold").fontSize(11).fillColor(AZUL).text(temp(d.tmin), M + 70, y + 15, { width: 36, lineBreak: false });
    doc.fillColor(ROJO).text(temp(d.tmax), M + 108, y + 15, { width: 40, lineBreak: false });
    celdaCondicion(M + 162, y + 1, ANCHO - 168, d.condicion, 30);
    doc.moveTo(M, y + 33).lineTo(M + ANCHO, y + 33).lineWidth(0.5).strokeColor(LINEA).stroke();
    doc.y = y + 37;
  }
  alerta(b.avisoGeneral);

  // --- detalle de cada zona ---------------------------------------------------------------------------------------
  for (const z of ZONAS) {
    const d = b.zonas[z];
    doc.y += 4;
    espacio(110 + 28 * b.localidades.filter((l) => l.zona === z).length); // el bloque de una zona no se corta entre páginas
    barra(`Zona ${z}`);
    filaDato("Humedad", d.humedad); filaDato("Viento", d.viento); filaDato("Riesgo", d.riesgo);
    doc.y += 4;
    tablaLocalidades(b.localidades.filter((l) => l.zona === z));
    alerta(d.aviso);
  }

  // --- pronóstico extendido ---------------------------------------------------------------------------------------
  doc.y += 8;
  espacio(60 + 35 * (b.extendido.Norte.length || 1));
  barra("Pronóstico extendido");
  for (const z of ZONAS) {
    espacio(30 + 30 * (b.extendido[z].length || 1));
    doc.fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(10.5).text(`ZONA ${z.toUpperCase()}`, M + 4, doc.y, { width: ANCHO, lineBreak: false });
    doc.y += 14;
    for (const dia of b.extendido[z]) {
      espacio(32);
      const y = doc.y;
      doc.fillColor("#1b2a22").font("Oak-Bold").fontSize(9.5).text(cap(fechaDia(dia.fecha)).toUpperCase(), M + 6, y + 10, { width: 150, lineBreak: false });
      doc.fillColor(AZUL).font("Oak-Bold").fontSize(10.5).text(temp(dia.tmin), M + 160, y + 9, { width: 44, lineBreak: false });
      doc.fillColor(ROJO).text(temp(dia.tmax), M + 208, y + 9, { width: 44, lineBreak: false });
      celdaCondicion(M + 262, y + 2, ANCHO - 268, dia.condicion, 28);
      doc.moveTo(M, y + 32).lineTo(M + ANCHO, y + 32).lineWidth(0.5).strokeColor(LINEA).stroke();
      doc.y = y + 35;
    }
    doc.y += 8;
  }

  // --- informes de pronóstico -------------------------------------------------------------------------------------
  doc.y += 4;
  barra("Informes de pronóstico");
  for (const inf of b.informes) {
    espacio(70);
    doc.fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(11).text(cap(fechaDia(inf.fecha)), M + 2, doc.y, { width: ANCHO });
    doc.y += 4;
    const partes = [[null, inf.resumen], ["Precipitaciones", inf.precipitaciones], ["Vientos", inf.vientos], ["Temperaturas", inf.temperaturas]].filter(([, t]) => String(t ?? "").trim());
    for (const [rotulo, t] of partes) {
      doc.font("Oak").fontSize(9.5);
      const alto = doc.heightOfString(`${rotulo ? `${rotulo}: ` : ""}${t}`, { width: ANCHO - 6 }) + 5;
      espacio(alto);
      if (rotulo) doc.fillColor("#1b2a22").font("Oak-Bold").text(`${rotulo}: `, M + 2, doc.y, { width: ANCHO - 6, continued: true }).font("Oak").text(String(t).trim());
      else doc.fillColor("#1b2a22").font("Oak").text(String(t).trim(), M + 2, doc.y, { width: ANCHO - 6, align: "justify" });
      doc.y += 4;
    }
    doc.y += 8;
  }
  espacio(40);
  doc.moveTo(M, doc.y).lineTo(M + ANCHO, doc.y).lineWidth(0.5).strokeColor(LINEA).stroke();
  doc.y += 6;
  doc.font("Oak").fontSize(8.5).fillColor(GRIS).text("FUENTE: Dirección General de Alerta Temprana – Subsecretaría de Ordenamiento Territorial – Ministerio de Ecología y RNR de la Provincia de Misiones.", M, doc.y, { width: ANCHO });

  // pie con el número de página, en todas (se escribe al final, cuando se sabe cuántas son)
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    doc.page.margins.bottom = 0; // para poder escribir en la franja del pie sin que pdfkit salte de página
    doc.font("Oak").fontSize(8).fillColor(GRIS).text(`Ministerio de Ecología y RNR de Misiones · Alerta Temprana — Página ${i + 1} de ${paginas.count}`, M, doc.page.height - 26, { width: ANCHO, align: "center", lineBreak: false });
  }
  doc.end();
  return terminado;
}

module.exports = { generarInformePdf, errorDeInforme, ZONAS };
