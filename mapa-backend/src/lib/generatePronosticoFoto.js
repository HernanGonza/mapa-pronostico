const path = require("path");
const fs = require("fs");
const { createCanvas, loadImage } = require("canvas");
const coordinates = require("../config/coordinates");
const { formatoFecha } = require("./dateUtils");
const { resolveIconPath } = require("./iconResolver");
const { armarMunicipiosConPronostico } = require("./municipios");
const { colorPorCondicion } = require("./condiciones");
const { OAK_SANS } = require("./fuentes");
const { dibujarIcono } = require("./iconosPlaca");
const { dibujarTitulo, LAYOUTS } = require("./generatePlacasAlerta");
const { MATERIALES_DIR, MUNICIPIOS_GEOJSON_PATH, trazarGeometria, roundedRect, truncarTexto, detectarSiluetaProvincia, SEMILLA_LAT, SEMILLA_LNG } = require("./generateMap");
const { proyectar } = require("../config/projection");

/**
 * Placa del pronóstico con el estilo de las placas nuevas, sobre una de las fotos de las placas
 * diarias (data/materiales/fondos-pronostico: las 33 de "Alerta temprana_placas diarias", con el
 * título, la etiqueta y el texto limpiados; la franja de logos queda la de la foto):
 *  - Degradé oscuro arriba y abajo (para leer el título y la frase).
 *  - Título: "PREVISIÓN DEL TIEMPO" blanco y la fecha en el color de la condición del día.
 *  - El mapa: la provincia con cada municipio del color de su condición y las tarjetas de cada
 *    localidad (ícono, mín/máx, condición), en Oak Sans, ajustado al lugar libre.
 *  - Abajo: la etiqueta de la condición (verde de la marca, con ícono) y la frase del día.
 * Feed 2250×2813 (la foto entera) e historias 2250×4000 (el centro de la foto, a lo alto).
 */
const FONDOS_DIR = path.join(MATERIALES_DIR, "fondos-pronostico");
const TAMANOS = { feed: { w: 2250, h: 2813 }, historias: { w: 2250, h: 4000 } };
const FOTO = { w: 1080, h: 1350, pie: 1269 }; // pie: donde empieza la franja blanca de logos
const VERDE_MARCA = "#065842"; // el de la etiqueta de las placas diarias
const MAX_FRASE = 160;

// Las etiquetas de las placas diarias, con su ícono y el grupo de color del mapa que les toca.
const ETIQUETAS = {
  tormenta: { texto: "Tormenta", icono: "tormenta", condicion: "tormentas aisladas" },
  lluvia: { texto: "Lluvia", icono: "lluvia", condicion: "lluvias" },
  "algo-nublado": { texto: "Algo nublado", icono: "nubeSol", condicion: "algo nublado" },
  "parcialmente-nublado": { texto: "Parcialmente nublado", icono: "nubeSol", condicion: "parcialmente nublado" },
  nublado: { texto: "Nublado", icono: "nube", condicion: "nublado" },
  despejado: { texto: "Despejado", icono: "sol", condicion: "despejado" },
};
// De qué condición es cada foto (así venían numeradas las placas diarias).
const RANGOS = [["tormenta", 1, 5], ["lluvia", 6, 11], ["algo-nublado", 12, 17], ["parcialmente-nublado", 18, 22], ["nublado", 23, 27], ["despejado", 28, 33]];
const FONDOS = RANGOS.flatMap(([etiqueta, desde, hasta]) => Array.from({ length: hasta - desde + 1 }, (_, i) => ({ id: desde + i, etiqueta })));

/**
 * La etiqueta que corresponde a las condiciones del día: la del grupo que más localidades tiene
 * (para sugerir la foto en el asistente).
 */
function etiquetaSugerida(filas = []) {
  const deCondicion = (c) => {
    const t = String(c || "").toLowerCase();
    if (/tormenta/.test(t)) return "tormenta";
    if (/lluvi|llovizn|chaparr/.test(t)) return "lluvia";
    if (/algo nublado/.test(t)) return "algo-nublado";
    if (/parcial/.test(t)) return "parcialmente-nublado";
    if (/nublado|cubierto/.test(t)) return "nublado";
    if (/despejado/.test(t)) return "despejado";
    return null;
  };
  const cuenta = {};
  for (const f of filas) { const e = deCondicion(f.CONDICION); if (e) cuenta[e] = (cuenta[e] || 0) + 1; }
  return Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0]?.[0] || "despejado";
}

function errorDePlacaFoto({ fondo, etiqueta, frase = "", estiloTarjeta = "oscura" } = {}) {
  if (!FONDOS.some((f) => f.id === Number(fondo))) return "Elegí una foto de fondo.";
  if (!ESTILOS_TARJETA[estiloTarjeta]) return "Elegí el estilo de las tarjetas.";
  if (!ETIQUETAS[etiqueta]) return "Elegí la etiqueta de la condición.";
  if (typeof frase !== "string" || frase.length > MAX_FRASE) return `La frase admite hasta ${MAX_FRASE} caracteres.`;
  return null;
}

let geojson, basemap;
const cargarBasemap = async () => (basemap ||= await loadImage(path.join(MATERIALES_DIR, "basemap.png")));

/**
 * La máscara de la silueta trae huecos donde basemap.png tiene dibujados los puntos rojos de las
 * localidades: se cierran (todo lo que no está conectado con el borde de la imagen es provincia).
 */
function rellenarAgujeros(mascara, W, H) {
  const afuera = new Uint8Array(W * H), pila = [];
  for (let x = 0; x < W; x++) pila.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) pila.push(y * W, y * W + W - 1);
  while (pila.length) {
    const q = pila.pop();
    if (afuera[q] || mascara[q]) continue;
    afuera[q] = 1;
    const x = q % W, y = (q / W) | 0;
    if (x > 0) pila.push(q - 1); if (x < W - 1) pila.push(q + 1); if (y > 0) pila.push(q - W); if (y < H - 1) pila.push(q + W);
  }
  // Ojo: lo que no es provincia ni toca el borde (textos de basemap.png, ej. el título) también
  // quedaría "adentro": sólo se cierran los huecos chicos, dentro del rectángulo de la provincia.
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let q = 0; q < mascara.length; q++) if (mascara[q]) { const x = q % W, y = (q / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const res = mascara.slice();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const q = y * W + x; if (!afuera[q]) res[q] = 1; }
  return res;
}
const municipiosGeo = () => (geojson ||= JSON.parse(fs.readFileSync(MUNICIPIOS_GEOJSON_PATH, "utf-8")));

/**
 * El mapa (provincia + municipios coloreados + tarjetas), sobre fondo transparente, en las
 * coordenadas de basemap.png (2250×2813, donde está calibrada la proyección). Devuelve el canvas
 * y el rectángulo que ocupa lo dibujado.
 */
async function dibujarCapaMapa(forecastRows, estilo = "oscura") {
  const W = 2250, H = 2813, scale = W / 1280;
  const capa = createCanvas(W, H), ctx = capa.getContext("2d");
  const porId = new Map(armarMunicipiosConPronostico(forecastRows).map((m) => [m.id, m]));
  const features = municipiosGeo().features;

  // La provincia es la de la placa de siempre: la silueta ilustrada de basemap.png (costa y ríos
  // suaves), recortada del papel crema. Encima, cada municipio de su color, semitransparente como
  // en la placa de siempre, y los límites entre municipios casi invisibles.
  const base = await cargarBasemap();
  const bctx = createCanvas(W, H).getContext("2d");
  bctx.drawImage(base, 0, 0);
  const semilla = proyectar(SEMILLA_LAT, SEMILLA_LNG);
  const silueta = rellenarAgujeros(detectarSiluetaProvincia(bctx, W, H, semilla.x, semilla.y), W, H);
  const color = createCanvas(W, H), cctx = color.getContext("2d");
  cctx.lineJoin = "round";
  for (const f of features) { trazarGeometria(cctx, f.geometry); cctx.fillStyle = colorPorCondicion(porId.get(f.properties.id)?.pronostico?.CONDICION); cctx.fill("evenodd"); }
  cctx.strokeStyle = "rgba(255,255,255,0.18)"; cctx.lineWidth = 1 * scale;
  for (const f of features) { trazarGeometria(cctx, f.geometry); cctx.stroke(); }
  bctx.globalAlpha = 0.78; bctx.drawImage(color, 0, 0); bctx.globalAlpha = 1;
  // Sólo la provincia: todo lo de afuera de la silueta queda transparente.
  const datos = bctx.getImageData(0, 0, W, H);
  for (let q = 0; q < silueta.length; q++) if (!silueta[q]) datos.data[q * 4 + 3] = 0;
  ctx.putImageData(datos, 0, 0);

  // Tarjetas de cada localidad (las mismas que la placa de siempre, en Oak Sans).
  const byLocalidad = new Map(forecastRows.map((r) => [r.LOCALIDAD.trim().toUpperCase(), r]));
  const imgsDir = path.join(MATERIALES_DIR, "imgs");
  const elementos = (await Promise.all(coordinates.map(async (coord) => {
    const row = byLocalidad.get(coord.LOCALIDAD.trim().toUpperCase());
    if (!row) return null;
    const iconPath = resolveIconPath(imgsDir, row.CONDICION);
    return { coord, row, icon: iconPath ? await loadImage(iconPath) : null };
  }))).filter(Boolean);
  const CARD_W = 226 * scale, CARD_H = 94 * scale, MARGEN = 22 * scale, GAP = 18 * scale;
  const ocupadas = [];
  // Los puntos de todas las localidades: ninguna tarjeta puede tapar el punto de otra.
  const puntos = elementos.map(({ coord }) => ({ x: coord.anchorX - 8 * scale, y: coord.anchorY - 8 * scale, w: 16 * scale, h: 16 * scale }));
  for (const { coord, row, icon } of elementos) {
    const box = ubicarConAire(coord.anchorX, coord.anchorY, ocupadas, puntos, CARD_W, CARD_H, MARGEN, W, H, GAP, AIRE_TARJETAS * scale);
    ocupadas.push(box);
    const px = Math.max(box.x, Math.min(coord.anchorX, box.x + box.w)), py = Math.max(box.y, Math.min(coord.anchorY, box.y + box.h));
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 3 * scale;
    ctx.beginPath(); ctx.moveTo(coord.anchorX, coord.anchorY); ctx.lineTo(px, py); ctx.stroke();
    ctx.fillStyle = "#b3262f"; ctx.beginPath(); ctx.arc(coord.anchorX, coord.anchorY, 5 * scale, 0, Math.PI * 2); ctx.fill();
    const E = ESTILOS_TARJETA[estilo] || ESTILOS_TARJETA.oscura;
    if (E.fondo) {
      ctx.save();
      ctx.fillStyle = E.fondo;
      roundedRect(ctx, box.x, box.y, box.w, box.h, 12 * scale); ctx.fill();
      if (E.borde) { ctx.strokeStyle = E.borde; ctx.lineWidth = 1.5 * scale; ctx.stroke(); }
      ctx.restore();
    }
    // Sin caja, el texto lleva una sombra para leerse sobre el mapa y la foto.
    const sombraTexto = () => { if (E.sombra) { ctx.shadowColor = E.sombra; ctx.shadowBlur = 8 * scale; ctx.shadowOffsetY = 1.5 * scale; } };
    if (icon) {
      const tam = 62 * scale, k = Math.min(tam / icon.width, tam / icon.height);
      ctx.drawImage(icon, box.x + 6 * scale + (58 * scale - icon.width * k) / 2, box.y + 7 * scale + (58 * scale - icon.height * k) / 2, icon.width * k, icon.height * k);
    }
    ctx.textBaseline = "top";
    const tx = box.x + 70 * scale;
    let nombreSize = 17 * scale;
    for (;;) { ctx.font = `bold ${nombreSize}px ${OAK_SANS}`; if (ctx.measureText(row.LOCALIDAD).width <= 146 * scale || nombreSize <= 12 * scale) break; nombreSize -= scale; }
    ctx.save(); sombraTexto();
    ctx.fillStyle = E.nombre; ctx.fillText(row.LOCALIDAD, tx, box.y + 10 * scale);
    ctx.font = `bold ${25 * scale}px ${OAK_SANS}`;
    ctx.fillStyle = E.min; ctx.fillText(`${row.TMIN}°`, tx, box.y + 37 * scale);
    ctx.fillStyle = E.separador; ctx.fillRect(tx + 54 * scale, box.y + 40 * scale, 1.5 * scale, 23 * scale);
    ctx.fillStyle = E.max; ctx.fillText(`${row.TMAX}°`, tx + 68 * scale, box.y + 37 * scale);
    ctx.restore();
    if (row.CONDICION) {
      const t = row.CONDICION.trim(), texto = t.charAt(0).toUpperCase() + t.slice(1), max = box.w - 12 * scale;
      let size = 13 * scale;
      for (;;) { ctx.font = `${size}px ${OAK_SANS}`; if (ctx.measureText(texto).width <= max || size <= 10 * scale) break; size -= scale; }
      ctx.save(); sombraTexto();
      ctx.fillStyle = E.condicion; ctx.fillText(truncarTexto(ctx, texto, max), box.x + 6 * scale, box.y + 68 * scale);
      ctx.restore();
    }
  }

  // Rectángulo de lo dibujado (para ajustarlo al lugar libre de la placa).
  const d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { capa, caja: { x: x0, y: y0, w: x1 - x0 + 2, h: y1 - y0 + 2 } };
}

// Estilos de las tarjetas de cada localidad (se elige en el asistente): vidrio oscuro, sin caja o vidrio claro.
const ESTILOS_TARJETA = {
  oscura: { fondo: "rgba(8,20,16,0.58)", borde: "rgba(255,255,255,0.22)", nombre: "#ffffff", min: "#9fd4ff", max: "#ffb2a6", separador: "rgba(255,255,255,0.45)", condicion: "#dfe7e3" },
  sinCaja: { fondo: null, sombra: "rgba(0,0,0,0.95)", nombre: "#ffffff", min: "#b4ddff", max: "#ffc1b7", separador: "rgba(255,255,255,0.7)", condicion: "#ffffff" },
  clara: { fondo: "rgba(255,255,255,0.55)", borde: "rgba(255,255,255,0.75)", nombre: "#16241e", min: "#063970", max: "#872338", separador: "rgba(30,40,35,0.4)", condicion: "#2c3833" },
};

// Aire mínimo entre tarjetas (en unidades del diseño de 1280 px de ancho).
const AIRE_TARJETAS = 16;
const solape = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Dónde va la tarjeta de una localidad: prueba 12 direcciones a 3 distancias del punto y se queda
 * con la que no pisa a otra tarjeta (dejando `aire` entre ellas), no tapa el punto de otra
 * localidad y no se sale de la imagen; entre las libres, la más cercana (guía corta).
 */
function ubicarConAire(ax, ay, ocupadas, puntos, w, h, margen, W, H, d, aire) {
  const infladas = ocupadas.map((o) => ({ x: o.x - aire, y: o.y - aire, w: o.w + 2 * aire, h: o.h + 2 * aire }));
  let mejor = null, mejorCosto = Infinity;
  for (const dist of [d, d * 3, d * 6]) {
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      // El centro de la tarjeta se corre sobre la dirección hasta que la tarjeta no toca el punto.
      const cx = ax + Math.cos(a) * (w / 2 + dist), cy = ay + Math.sin(a) * (h / 2 + dist);
      const box = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
      let costo = 0;
      if (box.x < margen) costo += (margen - box.x) * 10000;
      if (box.y < margen) costo += (margen - box.y) * 10000;
      if (box.x + w > W - margen) costo += (box.x + w - (W - margen)) * 10000;
      if (box.y + h > H - margen) costo += (box.y + h - (H - margen)) * 10000;
      for (const o of infladas) costo += solape(box, o) * 200;
      for (const p of puntos) if (!(p.x + p.w / 2 === ax && p.y + p.h / 2 === ay)) costo += solape(box, p) * 400;
      costo += Math.hypot(cx - ax, cy - ay) * 2;
      if (costo < mejorCosto) { mejorCosto = costo; mejor = box; }
    }
  }
  return mejor;
}

function ajustarLineas(ctx, texto, ancho) {
  const lineas = []; let actual = "";
  for (const palabra of String(texto).split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (ctx.measureText(prueba).width > ancho && actual) { lineas.push(actual); actual = palabra; } else actual = prueba;
  }
  if (actual) lineas.push(actual);
  return lineas;
}

async function generarPlacaPronosticoFoto({ forecastRows, date = new Date(), fondo, etiqueta, frase = "", tamano = "feed", estiloTarjeta = "oscura" }) {
  const error = errorDePlacaFoto({ fondo, etiqueta, frase, estiloTarjeta }) || (TAMANOS[tamano] ? null : "Tamaño inválido.");
  if (error) throw Object.assign(new Error(error), { status: 400 });
  // En el feed (más bajo) el título va un poco más chico, para que el mapa tenga más lugar.
  const { w: W, h: H } = TAMANOS[tamano], e = ETIQUETAS[etiqueta];
  const L = tamano === "feed" ? { ...LAYOUTS.feed, tituloY: 130, linea1: 70, linea2: 112 } : LAYOUTS.historias;
  const color = colorPorCondicion(e.condicion);
  const canvas = createCanvas(W, H), ctx = canvas.getContext("2d");

  // 1) Foto: entera en feed; en historias, el centro a lo alto (los logos del pie entran enteros).
  const foto = await loadImage(path.join(FONDOS_DIR, `${Number(fondo)}.jpg`));
  const k = H / foto.height, sw = W / k;
  ctx.drawImage(foto, (foto.width - sw) / 2, 0, sw, foto.height, 0, 0, W, H);
  const pie = Math.round((FOTO.pie / FOTO.h) * H);

  // 2) Degradé oscuro arriba (título) y abajo (etiqueta y frase).
  let g = ctx.createLinearGradient(0, 0, 0, H * 0.34);
  g.addColorStop(0, "rgba(6,14,12,0.72)"); g.addColorStop(1, "rgba(6,14,12,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.34);
  g = ctx.createLinearGradient(0, pie - H * 0.36, 0, pie);
  g.addColorStop(0, "rgba(6,14,12,0)"); g.addColorStop(1, "rgba(6,14,12,0.78)");
  ctx.fillStyle = g; ctx.fillRect(0, pie - H * 0.36, W, H * 0.36);

  // 3) Título.
  const { zonaY } = dibujarTitulo(ctx, W, L, ["PREVISIÓN DEL TIEMPO", formatoFecha(date).toLocaleUpperCase("es-AR")], color);

  // 4) Abajo, de abajo hacia arriba: la frase (con la raya blanca al costado) y la etiqueta.
  const mx = 190, fuente = tamano === "historias" ? 64 : 46, inter = 1.25;
  ctx.font = `bold ${fuente}px ${OAK_SANS}`;
  const lineas = frase.trim() ? ajustarLineas(ctx, frase.trim().toLocaleUpperCase("es-AR"), W - 2 * mx - 50).slice(0, 3) : [];
  const fraseH = lineas.length * fuente * inter;
  const aireAbajo = Math.round(H * (tamano === "historias" ? 0.05 : 0.035));
  const fraseY = pie - aireAbajo - fraseH;
  if (lineas.length) {
    ctx.fillStyle = "#fff"; ctx.fillRect(mx, fraseY, 8, fraseH);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    lineas.forEach((l, i) => ctx.fillText(l, mx + 42, fraseY + (i + 0.5) * fuente * inter));
    ctx.restore();
  }
  const chipH = Math.round(fuente * 1.9), chipY = (lineas.length ? fraseY : pie - aireAbajo) - Math.round(fuente * 0.8) - chipH;
  ctx.font = `bold ${Math.round(fuente * 0.95)}px ${OAK_SANS}`;
  const chipTexto = e.texto.toLocaleUpperCase("es-AR"), iconoTam = Math.round(chipH * 0.72);
  const chipW = Math.round(chipH * 0.45 + iconoTam + chipH * 0.3 + ctx.measureText(chipTexto).width + chipH * 0.6);
  ctx.fillStyle = VERDE_MARCA;
  roundedRect(ctx, mx - 20, chipY, chipW, chipH, chipH / 2); ctx.fill();
  dibujarIcono(ctx, e.icono, mx - 20 + chipH * 0.42, chipY + (chipH - iconoTam) / 2, iconoTam, "#fff");
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
  ctx.fillText(chipTexto, mx - 20 + chipH * 0.42 + iconoTam + chipH * 0.3, chipY + chipH / 2 + 2);

  // 5) El mapa, lo más grande posible entre el título y la etiqueta, centrado.
  const { capa, caja } = await dibujarCapaMapa(forecastRows, estiloTarjeta);
  const zonaTop = zonaY - 10, zonaBottom = chipY - Math.round(H * 0.012), zonaW = W - 2 * 40, zonaH = zonaBottom - zonaTop;
  const s = Math.min(zonaW / caja.w, zonaH / caja.h, 1.2);
  const dw = caja.w * s, dh = caja.h * s;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
  ctx.drawImage(capa, caja.x, caja.y, caja.w, caja.h, (W - dw) / 2, zonaTop + (zonaH - dh) / 2, dw, dh);
  ctx.restore();
  return canvas.toBuffer("image/png");
}

async function generarPlacaPronosticoFotoAmbos(opciones) {
  const [feedPng, historiasPng] = await Promise.all(["feed", "historias"].map((tamano) => generarPlacaPronosticoFoto({ ...opciones, tamano })));
  return { feedPng, historiasPng };
}

module.exports = { generarPlacaPronosticoFoto, generarPlacaPronosticoFotoAmbos, errorDePlacaFoto, etiquetaSugerida, FONDOS, ETIQUETAS, ESTILOS_TARJETA, FONDOS_DIR, MAX_FRASE };
