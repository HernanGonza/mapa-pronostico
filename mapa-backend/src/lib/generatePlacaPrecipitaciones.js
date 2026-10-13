const path = require("path");
const { createCanvas, loadImage, registerFont } = require("canvas");
const { dibujarIcono } = require("./iconosPlaca");
const { MATERIALES_DIR } = require("./generateMap");
const { incrustarFirma, conMetadatos } = require("./proteccionPlaca");

/**
 * Placa «Monitoreo de precipitaciones» — port a node-canvas de compose_monitoreo.py + wm_tile.py + protect.py del kit que
 * armó el equipo (misma tipografía, mismos colores y el mismo reparto vertical). Una tabla por estación (lo llovido en el
 * período, en el mes, la media y la anomalía) sobre una de las fotos de las placas diarias del pronóstico
 * (data/materiales/fondos-pronostico: lluvia 6–11, tormenta 1–5).
 *
 * Se puede editar el período, la 2.ª línea del título, los datos y la foto. NO se puede sacar (ni se edita) lo que protege la
 * placa, que se aplica siempre: la franja «Datos recopilados por la Dirección General de Alerta Temprana», la marca de agua
 * diagonal (28°, 6,5 %), la firma invisible en los píxeles y los metadatos de autoría dentro del PNG.
 * Feed 2250×2813 e historias 2250×4000 (en el kit los nombres venían al revés).
 */
const DIR_FUENTES = path.join(MATERIALES_DIR, "fuentes-placa");
registerFont(path.join(DIR_FUENTES, "BigShoulders-Bold.ttf"), { family: "Big Shoulders Placa", weight: "bold" });
registerFont(path.join(DIR_FUENTES, "LiberationSans-Regular.ttf"), { family: "Liberation Sans Placa" });
registerFont(path.join(DIR_FUENTES, "LiberationSans-Bold.ttf"), { family: "Liberation Sans Placa", weight: "bold" });
const TF = "Big Shoulders Placa", LS = "Liberation Sans Placa";

const FONDOS_DIR = path.join(MATERIALES_DIR, "fondos-pronostico");
const TAMANOS = { feed: { w: 2250, h: 2813, limite: 2260 }, historias: { w: 2250, h: 4000, limite: 3380 } };
const FOTO = { h: 1350, pie: 1269 }; // pie: donde empieza la franja blanca de logos de las fotos
// Las fotos que se pueden elegir: las de lluvia (6 a 11) y las de tormenta (1 a 5) de las placas diarias del pronóstico.
const FONDOS = [...[6, 7, 8, 9, 10, 11].map((id) => ({ id, grupo: "lluvia" })), ...[1, 2, 3, 4, 5].map((id) => ({ id, grupo: "tormenta" }))];
const FONDO_POR_DEFECTO = 6;
const TITULO = "MONITOREO DE PRECIPITACIONES";
const BANDA = "Datos recopilados por la Dirección General de Alerta Temprana";
const MARCA_DE_AGUA = "GOBIERNO DE MISIONES  ·  ALERTA TEMPRANA  ·  ORDENAMIENTO TERRITORIAL  ·  ECOLOGÍA  ·  ";
const NOTAS = { 1: "Estaciones del SMN", 2: "Estaciones del INTA", 3: "Estaciones automáticas", 4: "Estaciones de otras redes" };
const SUPER = { 1: "¹", 2: "²", 3: "³", 4: "⁴" };
const LIMITES = { filas: 24, nombre: 40, subtitulo: 48, periodo: 20 };
const BLANCO = "#fff", AZUL = "rgb(88,190,255)", NARANJA = "rgb(252,142,10)", GRIS = "rgb(205,212,224)";

const MENOS = "−";
/** Acepta 12.5, "12,5" o "" → número o null. */
const numero = (v) => { if (v === "" || v == null) return null; const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
const redondo = (n) => Math.round(n * 10) / 10;
const coma = (n) => (n == null ? "—" : String(redondo(n)).replace(".", ","));
/** La anomalía que se dibuja: la escrita o, si falta, mes − media. */
function anomaliaDe(f) {
  const escrita = numero(f.anomalia);
  return escrita ?? (numero(f.mes) != null && numero(f.media) != null ? redondo(numero(f.mes) - numero(f.media)) : null);
}
const conSigno = (a) => (a == null ? "—" : `${a > 0 ? "+" : a < 0 ? MENOS : ""}${coma(Math.abs(a))}`);

function errorDePlacaPrecipitaciones({ subtitulo = "", periodo, filas, fondo = FONDO_POR_DEFECTO } = {}) {
  if (typeof subtitulo !== "string" || !subtitulo.trim() || subtitulo.length > LIMITES.subtitulo) return `Escribí la segunda línea del título (hasta ${LIMITES.subtitulo} caracteres).`;
  if (typeof periodo !== "string" || !periodo.trim() || periodo.length > LIMITES.periodo) return `Escribí el período (ej.: «8 AL 13/10», hasta ${LIMITES.periodo} caracteres).`;
  if (!FONDOS.some((f) => f.id === Number(fondo))) return "Elegí una foto de fondo (de lluvia o de tormenta).";
  if (!Array.isArray(filas) || !filas.length) return "Cargá al menos una estación.";
  if (filas.length > LIMITES.filas) return `La placa admite hasta ${LIMITES.filas} estaciones.`;
  for (const [i, f] of filas.entries()) {
    if (typeof f?.nombre !== "string" || !f.nombre.trim() || f.nombre.length > LIMITES.nombre) return `La estación ${i + 1} necesita un nombre (hasta ${LIMITES.nombre} caracteres).`;
    if (f.nota != null && f.nota !== "" && !NOTAS[f.nota]) return `La nota de «${f.nombre}» no es válida.`;
    for (const c of ["periodo", "mes", "media", "anomalia"]) if (f[c] !== "" && f[c] != null && numero(f[c]) == null) return `El valor «${c}» de «${f.nombre}» no es un número.`;
    if (numero(f.periodo) == null) return `Falta la lluvia del período de «${f.nombre}».`;
  }
  return null;
}

/** Marca de agua: texto en diagonal repetido por todo el cuerpo (menos el pie), blanco al 6,5 %. Siempre se aplica. */
function marcaDeAgua(ctx, W, H, pie) {
  const D = Math.hypot(W, H) + 200, rowgap = 190;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, pie); ctx.clip();
  ctx.translate(W / 2, H / 2); ctx.rotate((-28 * Math.PI) / 180);
  ctx.font = `bold 64px "${TF}"`; ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillStyle = "rgba(255,255,255,0.065)";
  const tw = ctx.measureText(MARCA_DE_AGUA).width;
  for (let y = -D / 2, fila = 0; y < D / 2; y += rowgap, fila++) for (let x = -D / 2 - (fila % 2) * (tw / 2) - tw; x < D / 2; x += tw) ctx.fillText(MARCA_DE_AGUA, x, y);
  ctx.restore();
}

function gota(ctx, x0, y0, size, color) { // la misma gota que icon_drop del script
  const cx = x0 + size / 2, r = size * 0.3, cy = y0 + size * 0.64;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx, y0 + size * 0.06); ctx.lineTo(cx - r * 0.96, cy - r * 0.3); ctx.lineTo(cx + r * 0.96, cy - r * 0.3); ctx.closePath(); ctx.fill();
}

async function generarPlacaPrecipitaciones({ subtitulo, periodo, filas, fondo = FONDO_POR_DEFECTO, tamano = "feed", fecha = new Date().toISOString().slice(0, 10) }) {
  const error = errorDePlacaPrecipitaciones({ subtitulo, periodo, filas, fondo }) || (TAMANOS[tamano] ? null : "Tamaño inválido.");
  if (error) throw Object.assign(new Error(error), { status: 400 });
  const { w: W, h: H, limite } = TAMANOS[tamano];
  const canvas = createCanvas(W, H), ctx = canvas.getContext("2d");
  const ts = H / 2813, cx = W / 2, n = filas.length;
  const pie = Math.round((FOTO.pie / FOTO.h) * H);

  // Fondo: la foto (entera en feed; en historias, el centro a lo alto) con el cuerpo oscurecido para que se lea.
  const foto = await loadImage(path.join(FONDOS_DIR, `${Number(fondo)}.jpg`));
  const k = H / foto.height, sw = W / k;
  ctx.drawImage(foto, (foto.width - sw) / 2, 0, sw, foto.height, 0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, pie);
  g.addColorStop(0, "rgba(6,12,26,0.80)"); g.addColorStop(0.55, "rgba(6,12,26,0.66)"); g.addColorStop(1, "rgba(6,12,26,0.80)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, pie);

  const fuente = (peso, fam, s) => `${peso} ${Math.floor(s)}px "${fam}"`;
  const medir = (texto, font) => { ctx.font = font; return ctx.measureText(texto); };
  const lh = (font) => { const m = medir("Agjpq0", font); return Math.round(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent); };
  const ancho = (texto, font) => medir(texto, font).width;

  // Título: línea 1 blanca, línea 2 azul (se achica hasta entrar), raya blanca debajo.
  const T2 = subtitulo.trim().toLocaleUpperCase("es-AR");
  const f1 = fuente("bold", TF, 92 * ts);
  let sz = 150 * ts;
  while (ancho(T2, fuente("bold", TF, sz)) > W - 300 && sz >= 50) sz -= 2;
  const f2 = fuente("bold", TF, sz);
  let y = Math.floor(220 * ts);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const cen = (t, font, color, yy) => { // el borde superior de la tinta queda en yy, como textbbox de PIL
    const m = medir(t, font), w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    ctx.fillStyle = color; ctx.fillText(t, cx - w / 2 + m.actualBoundingBoxLeft, yy + m.actualBoundingBoxAscent); return [w, Math.round(h)];
  };
  const [w1, h1] = cen(TITULO, f1, BLANCO, y); y += h1 + Math.floor(34 * ts);
  const [w2, h2] = cen(T2, f2, AZUL, y); y += h2 + Math.floor(36 * ts);
  const uw = Math.max(w1, w2) + 70;
  ctx.fillStyle = BLANCO; ctx.fillRect(cx - uw / 2, y, uw, Math.floor(6 * ts)); y += Math.floor(6 * ts);
  const top = y + Math.floor(90 * ts);

  // Tabla: columnas y reparto vertical (la letra más grande con la que todo entra hasta `limite`, y después se estira).
  const mx = 110, tw = W - 2 * mx, fr = [0.34, 0.165, 0.165, 0.165, 0.165], colw = fr.map((f) => tw * f), xs = [mx];
  for (const c of colw) xs.push(xs[xs.length - 1] + c);
  const usadas = [...new Set(filas.map((f) => Number(f.nota)).filter(Boolean))].sort();
  const LEG = [usadas.map((u) => `${SUPER[u]} ${NOTAS[u]}`).join("     "), "Anomalía: diferencia entre lo acumulado en el mes y el valor medio."].filter(Boolean);
  const HEAD = ["ESTACIÓN", periodo.trim().toLocaleUpperCase("es-AR"), "MES", "MEDIA", "ANOMALÍA"];
  let u = 0, fh, fn, fb, fm, fl, fs, icon, gap, subH, headH, rh, legH, total;
  for (let i = 0; i < 40; i++) {
    u = Math.round((1.5 - 0.03 * i) * 100) / 100;
    fh = fuente("bold", LS, 36 * u); fn = fuente("normal", LS, 42 * u); fb = fuente("bold", LS, 42 * u); fm = fuente("normal", LS, 22 * u); fl = fuente("normal", LS, 34 * u); fs = fuente("normal", LS, 42 * u);
    icon = Math.floor(86 * u); gap = Math.floor(54 * u);
    subH = Math.max(icon, lh(fs)); headH = Math.floor(100 * u); rh = Math.floor(86 * u);
    legH = LEG.length * (lh(fl) + Math.floor(14 * u));
    total = subH + gap + headH + rh * n + Math.floor(rh * 0.95) + gap + legH;
    if (Math.max(...filas.map((f) => ancho(f.nombre.trim(), fn) + ancho(String(f.nota || ""), fm) + 30)) > colw[0] - 30) continue;
    if (Math.max(...HEAD.slice(1).map((h) => ancho(h, fh))) > colw[1] - 16) continue;
    if (top + total <= limite) break;
  }
  for (let i = 0; i < 9; i++) { // estirado vertical
    const m = Math.round((1.4 - 0.05 * i) * 100) / 100, rh2 = Math.floor(86 * u * m), hh2 = Math.floor(100 * u * (1 + (m - 1) * 0.5)), g2 = Math.floor(54 * u * (1 + (m - 1) * 1.2));
    const tot = subH + g2 + hh2 + rh2 * n + Math.floor(rh2 * 0.95) + g2 + legH;
    if (top + tot <= limite - 60) { rh = rh2; headH = hh2; gap = g2; total = tot; break; }
  }
  const y0 = top + (limite - top - total) * 0.35;
  gota(ctx, mx, y0, icon, AZUL);
  ctx.fillStyle = BLANCO; ctx.font = fs; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("Precipitación en milímetros (mm)", mx + icon + 36, y0 + icon / 2);
  const ty = y0 + subH + gap, sepH = Math.floor(rh * 0.95), tblH = headH + rh * n + sepH;
  const ytop = (i) => ty + headH + rh * i + sepH;

  // Panel oscuro, línea de encabezado, filas alternadas y franja azul de la fuente de los datos (fija).
  ctx.fillStyle = "rgba(8,12,20,0.667)";
  ctx.beginPath(); ctx.roundRect(mx - 18, ty - 12, tw + 36, tblH + 24, 26); ctx.fill();
  ctx.fillStyle = AZUL; ctx.fillRect(mx, ty + headH - 5, tw, 3);
  filas.forEach((_, i) => { if (i % 2 === 1) { ctx.fillStyle = "rgba(255,255,255,0.063)"; ctx.fillRect(mx + 6, ytop(i), tw - 12, rh); } });
  ctx.fillStyle = "rgba(88,190,255,0.216)"; ctx.fillRect(mx + 6, ty + headH + 4, tw - 12, sepH - 8);

  ctx.font = fh; ctx.fillStyle = AZUL; ctx.textBaseline = "middle";
  HEAD.forEach((h, i) => { if (i === 0) { ctx.textAlign = "left"; ctx.fillText(h, xs[0] + 24, ty + (headH - 5) / 2); } else { ctx.textAlign = "center"; ctx.fillText(h, xs[i] + colw[i] / 2, ty + (headH - 5) / 2); } });
  filas.forEach((f, i) => {
    const yc = ytop(i) + rh / 2, nombre = f.nombre.trim();
    ctx.textAlign = "left"; ctx.fillStyle = BLANCO; ctx.font = fn; ctx.fillText(nombre, xs[0] + 24, yc);
    if (f.nota) { const wn = ancho(nombre, fn); ctx.fillStyle = AZUL; ctx.font = fm; ctx.fillText(String(f.nota), xs[0] + 24 + wn + 6, yc - lh(fn) * 0.3); }
    ctx.textAlign = "center";
    ctx.fillStyle = BLANCO; ctx.font = fb; ctx.fillText(coma(numero(f.periodo)), xs[1] + colw[1] / 2, yc);
    ctx.font = fn; ctx.fillText(coma(numero(f.mes)), xs[2] + colw[2] / 2, yc);
    ctx.fillStyle = GRIS; ctx.fillText(coma(numero(f.media)), xs[3] + colw[3] / 2, yc);
    const a = anomaliaDe(f);
    ctx.fillStyle = a == null || a >= 0 ? AZUL : NARANJA; ctx.font = fb; ctx.fillText(conSigno(a), xs[4] + colw[4] / 2, yc);
  });
  let sepS = Math.floor(34 * u);
  while (ancho(BANDA, `bold ${sepS}px "${LS}"`) > tw - 60 && sepS > 12) sepS -= 2;
  ctx.font = `bold ${sepS}px "${LS}"`; ctx.fillStyle = BLANCO; ctx.textAlign = "center"; ctx.fillText(BANDA, mx + tw / 2, ty + headH + sepH / 2);
  let ly = ty + tblH + gap;
  ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.font = fl; ctx.fillStyle = GRIS;
  for (const l of LEG) { ctx.fillText(l, mx, ly); ly += lh(fl) + Math.floor(14 * u); }

  // «Emergencias ☎ 911 o Defensa Civil 103» entre el contenido y el pie (las fotos del pronóstico no lo traen).
  const fe = Math.round(66 * ts), ico = Math.round(fe * 1.2), ye = limite + (pie - limite) * 0.42;
  const partes = [["Emergencias ", 0], [null, 0], ["911", 1], [" o Defensa Civil ", 0], ["103", 1]];
  const fuenteE = (b) => `${b ? "bold" : "normal"} ${fe}px "${LS}"`;
  const medida = (p) => (p[0] === null ? ico + 16 * ts : (ctx.font = fuenteE(p[1]), ctx.measureText(p[0]).width + (p[0] === "911" ? 8 * ts : 0)));
  let xe = W - 150 - partes.reduce((s, p) => s + medida(p), 0);
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillStyle = BLANCO;
  for (const p of partes) {
    if (p[0] === null) { dibujarIcono(ctx, "emergencias", xe, ye - ico / 2, ico, "#fff"); xe += ico + 16 * ts; continue; }
    ctx.font = fuenteE(p[1]); ctx.fillText(p[0], xe, ye); xe += medida(p);
  }

  // Marca de agua (encima de todo el cuerpo), firma invisible y metadatos: van siempre.
  marcaDeAgua(ctx, W, H, pie);
  const datos = ctx.getImageData(0, 0, W, H);
  incrustarFirma(datos, `GOB-MNES-ALERTA-TEMP-${fecha.replace(/-/g, "")}`);
  ctx.putImageData(datos, 0, 0);
  return conMetadatos(canvas.toBuffer("image/png"), { titulo: `Monitoreo de precipitaciones - ${subtitulo.trim()} - ${periodo.trim()}`, fecha });
}

async function generarPlacaPrecipitacionesAmbos(opciones) {
  const [feedPng, historiasPng] = await Promise.all(["feed", "historias"].map((tamano) => generarPlacaPrecipitaciones({ ...opciones, tamano })));
  return { feedPng, historiasPng };
}

module.exports = { generarPlacaPrecipitaciones, generarPlacaPrecipitacionesAmbos, errorDePlacaPrecipitaciones, anomaliaDe, FONDOS, FONDO_POR_DEFECTO, NOTAS, LIMITES, TITULO, BANDA };
