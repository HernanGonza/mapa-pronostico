const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const { OAK_SANS, OAK_SANS_TITULO } = require("./fuentes");
const { dibujarIcono } = require("./iconosPlaca");
const { MATERIALES_DIR, roundedRect } = require("./generateMap");

/**
 * Placa «Monitoreo de precipitaciones»: una tabla por estación (lo llovido en el período, en el mes, la media y la
 * anomalía) sobre una de las fotos de lluvia de las placas diarias (data/materiales/fondos-pronostico). Se puede
 * editar el título de la 2.ª línea, el período, los datos y la foto; NO se puede sacar (ni se edita) lo que protege la
 * placa: la marca de agua diagonal que cubre todo el cuerpo, la franja «Datos recopilados por la Dirección General de
 * Alerta Temprana» y la franja de logos de la foto. Se dibuja siempre, sin opción de apagarla.
 * Feed 2250×2813 (la foto entera) e historias 2250×4000 (el centro de la foto, a lo alto), igual que el pronóstico.
 */
const FONDOS_DIR = path.join(MATERIALES_DIR, "fondos-pronostico");
const TAMANOS = { feed: { w: 2250, h: 2813 }, historias: { w: 2250, h: 4000 } };
const FOTO = { w: 1080, h: 1350, pie: 1269 }; // pie: donde empieza la franja blanca de logos
// Las fotos que se pueden elegir: las de lluvia (6 a 11) y las de tormenta (1 a 5) de las placas diarias del pronóstico.
const FONDOS = [...[6, 7, 8, 9, 10, 11].map((id) => ({ id, grupo: "lluvia" })), ...[1, 2, 3, 4, 5].map((id) => ({ id, grupo: "tormenta" }))];
const FONDO_POR_DEFECTO = 6;
const TITULO = "MONITOREO DE PRECIPITACIONES";
const BANDA = "Datos recopilados por la Dirección General de Alerta Temprana";
const MARCA_DE_AGUA = "GOBIERNO DE MISIONES · ECOLOGÍA · ORDENAMIENTO TERRITORIAL · ALERTA TEMPRANA";
const EMERGENCIAS = { a: "Emergencias", b: "911", c: " o Defensa Civil ", d: "103" };
const NOTAS = { 1: "Estaciones del SMN", 2: "Estaciones del INTA", 3: "Estaciones automáticas", 4: "Estaciones de otras redes" };
const LIMITES = { filas: 24, nombre: 40, subtitulo: 48, periodo: 20 };
const AZUL = "#3da9fc", NARANJA = "#ff9f1a";

const MENOS = "−"; // el signo menos de verdad, como en la placa
/** Acepta 12.5, "12,5" o "" → número o null. */
const numero = (v) => { if (v === "" || v == null) return null; const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
const redondo = (n) => Math.round(n * 10) / 10;
/** 214.4 → "214,4" · 257 → "257" · null → "—". */
const coma = (n) => (n == null ? "—" : String(redondo(n)).replace(".", ","));
/** La anomalía que se dibuja: la escrita o, si falta, mes − media. Con signo: «+3,6», «−10,1». */
function anomaliaDe(f) {
  const escrita = numero(f.anomalia), a = escrita ?? (numero(f.mes) != null && numero(f.media) != null ? redondo(numero(f.mes) - numero(f.media)) : null);
  return a;
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

/** La marca de agua: texto diagonal repetido por todo el cuerpo de la placa (hasta la franja de logos). Siempre se dibuja. */
function marcaDeAgua(ctx, W, alto) {
  const fuente = Math.round(W * 0.026), paso = Math.round(fuente * 3.1);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, alto); ctx.clip();
  ctx.translate(W / 2, alto / 2); ctx.rotate(-Math.PI / 6.5);
  ctx.font = `bold ${fuente}px ${OAK_SANS}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  const unidad = `${MARCA_DE_AGUA}   ·   `, largo = ctx.measureText(unidad).width, diag = Math.hypot(W, alto);
  for (let y = -diag / 2, fila = 0; y < diag / 2; y += paso, fila++) {
    for (let x = -diag / 2 - (fila % 2 ? largo / 2 : 0) - largo; x < diag / 2; x += largo) {
      ctx.lineWidth = Math.max(2, fuente * 0.06); ctx.strokeStyle = "rgba(0,0,0,0.16)"; ctx.strokeText(unidad, x, y);
      ctx.fillStyle = "rgba(255,255,255,0.17)"; ctx.fillText(unidad, x, y);
    }
  }
  ctx.restore();
}

function gota(ctx, x, y, tam, color) { // (x, y): centro
  ctx.save(); ctx.translate(x, y); ctx.scale(tam / 100, tam / 100); ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, -50); ctx.bezierCurveTo(10, -28, 34, -4, 34, 20); ctx.arc(0, 20, 34, 0, Math.PI, false); ctx.bezierCurveTo(-34, -4, -10, -28, 0, -50); ctx.closePath(); ctx.fill(); ctx.restore();
}

/** Achica la letra hasta que el texto entre en `ancho`. */
function ajustar(ctx, texto, fuenteBase, ancho, familia, peso = "bold") {
  let f = fuenteBase; ctx.font = `${peso} ${f}px ${familia}`;
  while (ctx.measureText(texto).width > ancho && f > 20) { f -= 2; ctx.font = `${peso} ${f}px ${familia}`; }
  return f;
}

async function generarPlacaPrecipitaciones({ subtitulo, periodo, filas, fondo = FONDO_POR_DEFECTO, tamano = "feed" }) {
  const error = errorDePlacaPrecipitaciones({ subtitulo, periodo, filas, fondo }) || (TAMANOS[tamano] ? null : "Tamaño inválido.");
  if (error) throw Object.assign(new Error(error), { status: 400 });
  const { w: W, h: H } = TAMANOS[tamano], s = W / 1600;
  const canvas = createCanvas(W, H), ctx = canvas.getContext("2d");

  // 1) Foto de lluvia: entera en feed; en historias, el centro a lo alto (los logos del pie entran enteros).
  const foto = await loadImage(path.join(FONDOS_DIR, `${Number(fondo)}.jpg`));
  const k = H / foto.height, sw = W / k;
  ctx.drawImage(foto, (foto.width - sw) / 2, 0, sw, foto.height, 0, 0, W, H);
  const pie = Math.round((FOTO.pie / FOTO.h) * H);
  // Oscurece el cuerpo para que se lea (la foto de lluvia es más clara que la de tormenta).
  let g = ctx.createLinearGradient(0, 0, 0, pie);
  g.addColorStop(0, "rgba(6,12,26,0.78)"); g.addColorStop(0.5, "rgba(6,12,26,0.62)"); g.addColorStop(1, "rgba(6,12,26,0.78)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, pie);

  // 2) Reparto vertical: título, leyenda, tabla (cabecera + banda + filas), notas y emergencias, centrado entre el borde y el pie.
  const n = filas.length, h = tamano === "historias" ? 1.5 : 1;
  const alto = { titulo: 245 * s * h, aireT: 70 * s, leyenda: 70 * s, aireL: 45 * s, cab: 82 * s, banda: 66 * s, aireN: 38 * s, notas: 92 * s, aireE: 36 * s, emerg: 80 * s };
  const fijo = Object.values(alto).reduce((a, b) => a + b, 0);
  const disponible = pie - 60 * s - 70 * s * h - fijo; // margen abajo (antes de los logos) y arriba
  const filaH = Math.max(40 * s, Math.min(disponible / n, 84 * s * h));
  const bloque = fijo + filaH * n, y0 = Math.max(50 * s, (pie - bloque) * 0.42);

  // 3) Título: línea 1 blanca, línea 2 celeste, raya blanca debajo.
  let y = y0;
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
  const f1 = ajustar(ctx, TITULO, 88 * s * h, W * 0.88, OAK_SANS_TITULO);
  ctx.fillStyle = "#fff"; ctx.fillText(TITULO, W / 2, y + f1 * 0.95);
  y += f1 * 1.08;
  const sub = subtitulo.trim().toLocaleUpperCase("es-AR");
  const f2 = ajustar(ctx, sub, 118 * s * h, W * 0.9, OAK_SANS_TITULO);
  ctx.fillStyle = AZUL; ctx.fillText(sub, W / 2, y + f2 * 0.95);
  y += f2 * 1.08;
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.fillStyle = "#fff"; ctx.fillRect(W * 0.055, y + 8 * s, W * 0.89, 7 * s);
  y = y0 + alto.titulo * 0 + (y - y0) + 8 * s + 7 * s + alto.aireT;

  // 4) Leyenda: gota + «Precipitación en milímetros (mm)».
  gota(ctx, W * 0.075, y + alto.leyenda / 2, 66 * s, AZUL);
  ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.font = `${Math.round(43 * s)}px ${OAK_SANS}`;
  ctx.fillText("Precipitación en milímetros (mm)", W * 0.113, y + alto.leyenda / 2);
  y += alto.leyenda + alto.aireL;

  // 5) Tabla.
  const px = W * 0.041, pw = W * 0.918, alturaTabla = alto.cab + alto.banda + filaH * n + 14 * s;
  ctx.fillStyle = "rgba(9,15,32,0.82)"; roundedRect(ctx, px, y - 10 * s, pw, alturaTabla, 26 * s); ctx.fill();
  const col = { nombre: W * 0.06, periodo: W * 0.43, mes: W * 0.579, media: W * 0.7275, anom: W * 0.877 };
  ctx.fillStyle = AZUL; ctx.font = `bold ${Math.round(37 * s)}px ${OAK_SANS}`; ctx.textBaseline = "middle";
  const yc = y + alto.cab / 2 - 4 * s;
  ctx.textAlign = "left"; ctx.fillText("ESTACIÓN", col.nombre, yc);
  ctx.textAlign = "center";
  [[col.periodo, periodo.trim().toLocaleUpperCase("es-AR")], [col.mes, "MES"], [col.media, "MEDIA"], [col.anom, "ANOMALÍA"]].forEach(([x, t]) => ctx.fillText(t, x, yc));
  ctx.fillStyle = AZUL; ctx.fillRect(px + 12 * s, y + alto.cab - 6 * s, pw - 24 * s, 3 * s);
  y += alto.cab;
  // Banda fija (no se edita): quién recopila los datos.
  const bg = ctx.createLinearGradient(px, 0, px + pw, 0); bg.addColorStop(0, "rgba(60,98,140,0.85)"); bg.addColorStop(0.5, "rgba(48,80,118,0.92)"); bg.addColorStop(1, "rgba(60,98,140,0.85)");
  ctx.fillStyle = bg; ctx.fillRect(px + 12 * s, y, pw - 24 * s, alto.banda);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = `bold ${Math.round(34 * s)}px ${OAK_SANS}`; ctx.fillText(BANDA, W / 2, y + alto.banda / 2);
  y += alto.banda;

  const fuenteFila = Math.round(Math.min(46 * s * h, filaH * 0.52));
  filas.forEach((f, i) => {
    const yy = y + i * filaH, cy = yy + filaH / 2;
    if (i % 2 === 1) { ctx.fillStyle = "rgba(255,255,255,0.13)"; ctx.fillRect(px + 12 * s, yy, pw - 24 * s, filaH); }
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    const nombre = f.nombre.trim(); ctx.font = `${fuenteFila}px ${OAK_SANS}`;
    ajustar(ctx, nombre, fuenteFila, W * 0.285, OAK_SANS, "normal");
    ctx.fillText(nombre, col.nombre, cy);
    if (f.nota) { const w = ctx.measureText(nombre).width; ctx.fillStyle = "#9db8d6"; ctx.font = `${Math.round(fuenteFila * 0.55)}px ${OAK_SANS}`; ctx.fillText(String(f.nota), col.nombre + w + 6 * s, cy - fuenteFila * 0.3); }
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff"; ctx.font = `bold ${fuenteFila}px ${OAK_SANS}`; ctx.fillText(coma(numero(f.periodo)), col.periodo, cy);
    ctx.font = `${fuenteFila}px ${OAK_SANS}`; ctx.fillText(coma(numero(f.mes)), col.mes, cy); ctx.fillText(coma(numero(f.media)), col.media, cy);
    const a = anomaliaDe(f);
    ctx.fillStyle = a == null ? "#fff" : a >= 0 ? AZUL : NARANJA; ctx.font = `bold ${fuenteFila}px ${OAK_SANS}`; ctx.fillText(conSigno(a), col.anom, cy);
  });
  y += filaH * n + 14 * s + alto.aireN;

  // 6) Notas (sólo las de las estaciones que hay) y emergencias.
  const usadas = [...new Set(filas.map((f) => Number(f.nota)).filter(Boolean))].sort();
  ctx.fillStyle = "#cfdceb"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.font = `${Math.round(34 * s)}px ${OAK_SANS}`;
  let x = W * 0.049;
  const yn1 = y + alto.notas * 0.27;
  for (const u of usadas) {
    ctx.font = `${Math.round(21 * s)}px ${OAK_SANS}`; ctx.fillText(String(u), x, yn1 - 8 * s); x += ctx.measureText(String(u)).width + 5 * s;
    ctx.font = `${Math.round(34 * s)}px ${OAK_SANS}`; const t = NOTAS[u]; ctx.fillText(t, x, yn1); x += ctx.measureText(t).width + 40 * s;
  }
  ctx.fillText("Anomalía: diferencia entre lo acumulado en el mes y el valor medio.", W * 0.049, y + alto.notas * 0.75);
  y += alto.notas + alto.aireE;
  // «Emergencias ☎ 911 o Defensa Civil 103», alineado a la derecha.
  const fe = Math.round(46 * s * Math.min(h, 1.1)), ico = Math.round(fe * 1.25);
  ctx.textBaseline = "middle";
  const partes = [[EMERGENCIAS.a + " ", false], [null], [EMERGENCIAS.b, true], [EMERGENCIAS.c, false], [EMERGENCIAS.d, true]];
  const medida = (p) => { if (!p[0] && p.length === 1) return ico + 14 * s; ctx.font = `${p[1] ? "bold" : ""} ${fe}px ${OAK_SANS}`; return ctx.measureText(p[0]).width + (p[0] === EMERGENCIAS.b ? 8 * s : 0); };
  let xe = W * 0.951 - partes.reduce((a, p) => a + medida(p), 0);
  for (const p of partes) {
    if (!p[0] && p.length === 1) { dibujarIcono(ctx, "emergencias", xe, y + alto.emerg / 2 - ico / 2, ico, "#fff"); xe += ico + 14 * s; continue; }
    ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.font = `${p[1] ? "bold" : ""} ${fe}px ${OAK_SANS}`; ctx.fillText(p[0], xe, y + alto.emerg / 2); xe += medida(p);
  }

  // 7) La marca de agua va al final, encima de todo el cuerpo: no se puede sacar.
  marcaDeAgua(ctx, W, pie);
  return canvas.toBuffer("image/png");
}

async function generarPlacaPrecipitacionesAmbos(opciones) {
  const [feedPng, historiasPng] = await Promise.all(["feed", "historias"].map((tamano) => generarPlacaPrecipitaciones({ ...opciones, tamano })));
  return { feedPng, historiasPng };
}

module.exports = { generarPlacaPrecipitaciones, generarPlacaPrecipitacionesAmbos, errorDePlacaPrecipitaciones, anomaliaDe, FONDOS, FONDO_POR_DEFECTO, NOTAS, LIMITES, TITULO, BANDA };
