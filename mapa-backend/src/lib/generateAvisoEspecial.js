const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

/**
 * Placa de "Aviso especial": aviso corto de texto libre (ej. "se están formando
 * tormentas en Paraguay en dirección a Misiones") con una captura de radar o
 * satélite que sube el operador. Es una placa aparte de Alerta Meteorológica y de
 * Aviso a muy corto plazo: no hay mapa ni polígono, la imagen subida ocupa ese lugar.
 *
 * De arriba hacia abajo: título fijo "AVISO" → tarjeta con la imagen (marco blanco,
 * esquinas redondeadas, sombra) → caja oscura con el texto y la línea "Aviso emitido
 * el …" → pie fijo (Emergencias 911 + logos), que ya viene en el fondo.
 *
 * Los fondos (data/alertas/aviso-especial/*.png) son los de rayos de Alerta
 * Meteorológica limpiados una sola vez, sin el título viejo ni la línea "Fuente
 * Servicio Meteorológico Nacional" (ver scripts/limpiar-fondos-aviso-especial.py).
 */
const ASSETS_DIR = path.join(__dirname, '../../data/alertas/aviso-especial');
// El texto usa la Oak Sans compartida (ver fuentes.js); el título, la ExtraBold, que es
// otro archivo y por eso puede tener nombre propio sin pisar a nadie.
const { OAK_SANS } = require('./fuentes');
registerFont(path.join(ASSETS_DIR, 'OakSans-ExtraBold.ttf'), { family: 'AvisoEspecialTitulo', weight: 'bold' });

const TITULO = 'AVISO';
const TAMANOS = ['feed', 'historias'];
const MAX_TEXTO = 500;

// Medidas en px sobre los fondos (2250×2813 feed, 2250×4000 historias).
//  tituloY / tituloAlto: borde superior y alto de las mayúsculas de "AVISO".
//  imagen: caja máxima de la captura (sin el marco) — se ajusta sin recortar.
//  pie: dónde empieza "Emergencias 911…" (impreso en el fondo): nada puede pasar de ahí.
// Si se cambian los fondos por otros con el pie en otra altura, hay que volver a medir `pie`.
const LAYOUTS = {
  feed: { tituloY: 200, tituloAlto: 165, imagen: { w: 1700, h: 950 }, pie: 2303, fuenteMax: 110 },
  historias: { tituloY: 280, tituloAlto: 165, imagen: { w: 1900, h: 1450 }, pie: 3458, fuenteMax: 120 },
};
const AIRE_TITULO = 90; // entre el título y la tarjeta (no se tienen que tocar)
const AIRE = 60; // entre tarjeta y caja de texto, y entre la caja y "Emergencias…"
const MARCO = 16, RADIO_TARJETA = 24;
const CAJA = { x: 150, padH: 80, padV: 64, radio: 32, color: 'rgba(10,14,22,0.745)' };
// Letra pensada para leerse en el celular (la placa se ve a ~400 px de ancho).
const FUENTE_MIN = 48, FUENTE_COMODA = 76;
const INTERLINEA = 1.3, GAP_EMISION = 40;
// Si el texto no entra con letra cómoda, la imagen se achica de a pasos (hasta 60 %).
const ESCALAS_IMAGEN = [1, 0.9, 0.8, 0.7, 0.6];

let fondosPromise;
function loadFondos() {
  if (!fondosPromise) {
    fondosPromise = Promise.all(TAMANOS.map(async (t) => [t, await loadImage(path.join(ASSETS_DIR, `${t}.png`))])).then(Object.fromEntries);
    fondosPromise.catch(() => { fondosPromise = null; });
  }
  return fondosPromise;
}

const RE_EMITIDO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
/** "AAAA-MM-DDTHH:mm" (hora de Misiones, como sale de <input type="datetime-local">). */
function lineaEmision(emitidoEn) {
  const [, a, m, d, hh, mm] = RE_EMITIDO.exec(emitidoEn);
  return `Aviso emitido el ${d}/${m}/${a} a las ${hh}:${mm}hs.`;
}

function errorDeAvisoEspecial({ texto, emitidoEn }) {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > MAX_TEXTO) return `Escribí el aviso (hasta ${MAX_TEXTO} caracteres).`;
  const f = typeof emitidoEn === 'string' && RE_EMITIDO.exec(emitidoEn);
  if (!f || Number.isNaN(Date.parse(`${emitidoEn}:00-03:00`)) || +f[2] < 1 || +f[2] > 12 || +f[3] < 1 || +f[3] > 31 || +f[4] > 23 || +f[5] > 59) return 'Elegí la fecha y hora de emisión.';
  return null;
}

/** Corta palabra por palabra según el ancho (con `ctx.font` ya seteado). Una palabra
 * sola más ancha que la caja queda en su renglón (se detecta después como "no entra"). */
function ajustarLineas(ctx, texto, maxWidth) {
  const palabras = texto.split(/\s+/).filter(Boolean), lineas = [];
  let actual = '';
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (ctx.measureText(prueba).width > maxWidth && actual) { lineas.push(actual); actual = palabra; }
    else actual = prueba;
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/** Tamaño de la imagen dentro de la caja, sin recortar (contain), agrandando si es chica. */
function contener(iw, ih, maxW, maxH) {
  const k = Math.min(maxW / iw, maxH / ih);
  return { w: Math.round(iw * k), h: Math.round(ih * k) };
}

function rectRedondeado(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Desenfoque de caja separable (horizontal + vertical) sobre un canal RGBA; tres
// pasadas se parecen a un gaussiano. Sólo para la máscara de enfoque de la captura.
function desenfocar(src, w, h, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src);
  const pasada = (entrada, salida, horizontal) => {
    const largo = horizontal ? w : h, filas = horizontal ? h : w, div = 2 * r + 1;
    for (let f = 0; f < filas; f++) {
      for (let c = 0; c < 3; c++) {
        const idx = (i) => ((horizontal ? f * w + i : i * w + f) << 2) + c;
        let suma = 0;
        for (let i = -r; i <= r; i++) suma += entrada[idx(Math.min(largo - 1, Math.max(0, i)))];
        for (let i = 0; i < largo; i++) {
          salida[idx(i)] = suma / div;
          suma += entrada[idx(Math.min(largo - 1, i + r + 1))] - entrada[idx(Math.max(0, i - r))];
        }
      }
    }
  };
  for (let k = 0; k < 3; k++) { pasada(out, tmp, true); pasada(tmp, out, false); }
  return out;
}

/**
 * Mejora la captura ya escalada: máscara de enfoque (radio 2, 130 %), +8 % contraste,
 * +10 % saturación, +2 % brillo. Las capturas de radar suelen venir chicas y lavadas.
 */
function mejorarImagen(ctx, w, h) {
  const datos = ctx.getImageData(0, 0, w, h), p = datos.data;
  const borroso = desenfocar(p, w, h, 1);
  for (let i = 0; i < p.length; i += 4) {
    let r = p[i] + 1.3 * (p[i] - borroso[i]);
    let g = p[i + 1] + 1.3 * (p[i + 1] - borroso[i + 1]);
    let b = p[i + 2] + 1.3 * (p[i + 2] - borroso[i + 2]);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    r = lum + (r - lum) * 1.1; g = lum + (g - lum) * 1.1; b = lum + (b - lum) * 1.1;
    p[i] = ((r - 128) * 1.08 + 128) * 1.02;
    p[i + 1] = ((g - 128) * 1.08 + 128) * 1.02;
    p[i + 2] = ((b - 128) * 1.08 + 128) * 1.02; // Uint8ClampedArray recorta a 0–255 solo
  }
  ctx.putImageData(datos, 0, 0);
}

function prepararCaptura(img, w, h) {
  const c = createCanvas(w, h), ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  mejorarImagen(ctx, w, h);
  return c;
}

/**
 * Busca el tamaño de letra más grande (≤ fuenteMax) con el que el texto + la línea de
 * emisión entran en `altoMax` usando a lo sumo el 80 % (el resto queda de aire).
 * Devuelve null si ni con la letra mínima entra.
 */
function ajustarTexto(ctx, parrafos, emision, anchoMax, altoMax, fuenteMax) {
  for (let fuente = fuenteMax; fuente >= FUENTE_MIN; fuente -= 2) {
    ctx.font = `bold ${fuente}px ${OAK_SANS}`;
    const lineas = parrafos.flatMap((p) => ajustarLineas(ctx, p, anchoMax));
    if (lineas.some((l) => ctx.measureText(l).width > anchoMax)) continue;
    // La línea de emisión va siempre en un renglón: arranca en 82 % del texto y se achica si hace falta.
    let fuenteEmision = Math.round(fuente * 0.82);
    for (;;) {
      ctx.font = `bold ${fuenteEmision}px ${OAK_SANS}`;
      if (ctx.measureText(emision).width <= anchoMax || fuenteEmision <= 16) break;
      fuenteEmision -= 1;
    }
    const alto = lineas.length * fuente * INTERLINEA + GAP_EMISION + fuenteEmision * INTERLINEA;
    if (alto <= altoMax * 0.8) return { fuente, lineas, fuenteEmision, alto };
  }
  return null;
}

/**
 * Genera la placa en un formato. `imagen`: Buffer (PNG/JPEG) o una imagen ya cargada
 * con loadImage (para no decodificarla dos veces al generar feed + historias).
 */
async function generateAvisoEspecial({ texto, emitidoEn, imagen, tamano = 'feed' }) {
  const error = errorDeAvisoEspecial({ texto, emitidoEn }) || (TAMANOS.includes(tamano) ? null : 'Tamaño inválido.');
  if (error) throw Object.assign(new Error(error), { status: 400 });
  const img = Buffer.isBuffer(imagen) ? await cargarCaptura(imagen) : imagen;
  const fondo = (await loadFondos())[tamano];
  const L = LAYOUTS[tamano];
  const W = fondo.width;
  const canvas = createCanvas(W, fondo.height), ctx = canvas.getContext('2d');
  ctx.drawImage(fondo, 0, 0);

  // 1) Título fijo, centrado: el tamaño se calcula para que las mayúsculas midan tituloAlto.
  ctx.font = 'bold 200px AvisoEspecialTitulo';
  const alto200 = ctx.measureText(TITULO).actualBoundingBoxAscent;
  ctx.font = `bold ${Math.round((200 * L.tituloAlto) / alto200)}px AvisoEspecialTitulo`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
  ctx.fillText(TITULO, W / 2, L.tituloY + L.tituloAlto);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  // 2) Reparto del espacio: la imagen lo más grande posible; si el texto no entra con
  // letra cómoda, se achica la imagen de a pasos antes de achicar más la letra.
  const parrafos = texto.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const emision = lineaEmision(emitidoEn);
  // Ningún renglón pasa del 92 % del ancho de la caja.
  const cajaW = W - 2 * CAJA.x, anchoTexto = Math.min(cajaW * 0.92, cajaW - 2 * CAJA.padH);
  const tarjetaY = L.tituloY + L.tituloAlto + AIRE_TITULO;
  let plan = null;
  for (const escala of ESCALAS_IMAGEN) {
    const tam = contener(img.width, img.height, L.imagen.w * escala, L.imagen.h * escala);
    const zonaY = tarjetaY + tam.h + 2 * MARCO + AIRE, zonaH = L.pie - AIRE - zonaY;
    const t = ajustarTexto(ctx, parrafos, emision, anchoTexto, zonaH - 2 * CAJA.padV, L.fuenteMax);
    if (t) plan = { tam, zonaY, zonaH, t };
    if (t && t.fuente >= FUENTE_COMODA) break;
  }
  if (!plan) throw Object.assign(new Error('El texto es demasiado largo para la placa: acortalo un poco.'), { status: 400 });
  const { tam, zonaY, zonaH, t } = plan;

  // 3) Tarjeta de la imagen: sombra, marco blanco redondeado y la captura mejorada adentro.
  const tw = tam.w + 2 * MARCO, th = tam.h + 2 * MARCO, tx = Math.round((W - tw) / 2);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.47)'; ctx.shadowBlur = 32; ctx.shadowOffsetY = 20;
  ctx.fillStyle = '#fff';
  rectRedondeado(ctx, tx, tarjetaY, tw, th, RADIO_TARJETA);
  ctx.fill();
  ctx.restore();
  ctx.save();
  rectRedondeado(ctx, tx + MARCO, tarjetaY + MARCO, tam.w, tam.h, Math.max(4, RADIO_TARJETA - MARCO));
  ctx.clip();
  ctx.drawImage(prepararCaptura(img, tam.w, tam.h), tx + MARCO, tarjetaY + MARCO);
  ctx.restore();

  // 4) Caja de texto, del alto justo del contenido, centrada en lo que queda hasta el pie.
  const cajaH = Math.round(t.alto + 2 * CAJA.padV), cajaY = Math.round(zonaY + (zonaH - cajaH) / 2);
  ctx.fillStyle = CAJA.color;
  rectRedondeado(ctx, CAJA.x, cajaY, cajaW, cajaH, CAJA.radio);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let y = cajaY + CAJA.padV;
  ctx.font = `bold ${t.fuente}px ${OAK_SANS}`;
  for (const linea of t.lineas) {
    ctx.fillText(linea, W / 2, y + (t.fuente * INTERLINEA) / 2);
    y += t.fuente * INTERLINEA;
  }
  y += GAP_EMISION;
  ctx.font = `bold ${t.fuenteEmision}px ${OAK_SANS}`;
  ctx.fillText(emision, W / 2, y + (t.fuenteEmision * INTERLINEA) / 2);

  return canvas.toBuffer('image/png');
}

/** Decodifica la captura subida; error 400 si no es una imagen válida o es diminuta. */
async function cargarCaptura(buffer) {
  let img;
  try { img = await loadImage(buffer); }
  catch { throw Object.assign(new Error('La imagen no se pudo leer: subí un JPG o PNG.'), { status: 400 }); }
  if (img.width < 50 || img.height < 50) throw Object.assign(new Error('La imagen es demasiado chica.'), { status: 400 });
  return img;
}

/** Feed + historias de una sola vez (la captura se decodifica una vez). */
async function generarAvisoEspecialAmbos({ texto, emitidoEn, imagen }) {
  const img = await cargarCaptura(imagen);
  const [feedPng, historiasPng] = await Promise.all(TAMANOS.map((tamano) => generateAvisoEspecial({ texto, emitidoEn, imagen: img, tamano })));
  return { feedPng, historiasPng };
}

module.exports = { generateAvisoEspecial, generarAvisoEspecialAmbos, errorDeAvisoEspecial, lineaEmision, contener, TITULO, MAX_TEXTO, TAMANOS };
