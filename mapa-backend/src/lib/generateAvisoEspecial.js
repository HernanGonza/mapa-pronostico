const { createCanvas, loadImage } = require('canvas');

/**
 * Placa de "Aviso especial": aviso corto de texto libre (ej. "se están formando
 * tormentas en Paraguay en dirección a Misiones") con una captura de radar o satélite que
 * sube el operador. Mismo estilo que las placas de las alertas (generatePlacasAlerta.js):
 *
 *  - Título de dos líneas editables: la 1.ª blanca ("AVISO ESPECIAL") y la 2.ª, opcional, del
 *    color del nivel ("POR TORMENTAS"), con la raya blanca debajo.
 *  - La captura en una tarjeta con marco blanco, lo más grande que deje el texto.
 *  - Debajo, las filas con ícono, sin caja (directo sobre la foto, como las otras placas): la
 *    nube con el texto y el reloj con "Aviso emitido el 04/10/2026 a las 10:30hs.".
 *  - Nivel opcional (amarillo / naranja / rojo): pinta la 2.ª línea del título; sin nivel, blanca.
 * Toda la letra es Oak Sans (ExtraBold en el título). Fondos: los de rayos limpios de
 * data/alertas/aviso-especial (los mismos de las placas de alertas).
 */
const { dibujarTitulo, planearFilas, dibujarFilas, loadFondos: fondosAlertas, LAYOUTS, COLOR } = require('./generatePlacasAlerta');

const TITULO = 'AVISO ESPECIAL';
const TAMANOS = ['feed', 'historias'];
const MAX_TEXTO = 500, MAX_TITULO = 40;
const NIVELES = ['Amarillo', 'Naranja', 'Rojo'];

// Caja máxima de la captura (sin el marco); se ajusta sin recortar y se achica si el texto no entra.
const IMAGEN = { feed: { w: 1750, h: 880 }, historias: { w: 1870, h: 1400 } };
const AIRE = 70; // entre la tarjeta de la captura y las filas
const MARCO = 16, RADIO_TARJETA = 24;
// Si el texto no entra con letra cómoda, la imagen se achica de a pasos (hasta la mitad).
const ESCALAS_IMAGEN = [1, 0.9, 0.8, 0.7, 0.6, 0.5];
const FUENTE_COMODA = { feed: 70, historias: 84 };

const loadFondos = fondosAlertas;

const RE_EMITIDO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
/** "AAAA-MM-DDTHH:mm" (hora de Misiones, como sale de <input type="datetime-local">). */
function lineaEmision(emitidoEn) {
  const [, a, m, d, hh, mm] = RE_EMITIDO.exec(emitidoEn);
  return `Aviso emitido el ${d}/${m}/${a} a las ${hh}:${mm}hs.`;
}

function errorDeAvisoEspecial({ texto, emitidoEn, titulo = TITULO, subtitulo = '', nivel = null }) {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > MAX_TEXTO) return `Escribí el aviso (hasta ${MAX_TEXTO} caracteres).`;
  const f = typeof emitidoEn === 'string' && RE_EMITIDO.exec(emitidoEn);
  if (!f || Number.isNaN(Date.parse(`${emitidoEn}:00-03:00`)) || +f[2] < 1 || +f[2] > 12 || +f[3] < 1 || +f[3] > 31 || +f[4] > 23 || +f[5] > 59) return 'Elegí la fecha y hora de emisión.';
  if (typeof titulo !== 'string' || !titulo.trim() || titulo.length > MAX_TITULO) return `Escribí el título (hasta ${MAX_TITULO} caracteres).`;
  if (typeof subtitulo !== 'string' || subtitulo.length > MAX_TITULO) return `La segunda línea del título admite hasta ${MAX_TITULO} caracteres.`;
  if (nivel != null && nivel !== '' && !NIVELES.includes(nivel)) return 'Nivel inválido.';
  return null;
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
 * Genera la placa en un formato. `imagen`: Buffer (PNG/JPEG) o una imagen ya cargada
 * con loadImage (para no decodificarla dos veces al generar feed + historias).
 */
async function generateAvisoEspecial({ texto, emitidoEn, imagen, titulo = TITULO, subtitulo = '', nivel = null, tamano = 'feed' }) {
  const error = errorDeAvisoEspecial({ texto, emitidoEn, titulo, subtitulo, nivel }) || (TAMANOS.includes(tamano) ? null : 'Tamaño inválido.');
  if (error) throw Object.assign(new Error(error), { status: 400 });
  const img = Buffer.isBuffer(imagen) ? await cargarCaptura(imagen) : imagen;
  const fondo = (await loadFondos())[tamano];
  const L = LAYOUTS[tamano], W = fondo.width;
  const canvas = createCanvas(W, fondo.height), ctx = canvas.getContext('2d');
  ctx.drawImage(fondo, 0, 0);
  const color = COLOR[nivel] || '#fff';

  // 1) Título (como las placas de alertas).
  const mayus = (t) => t.trim().toLocaleUpperCase('es-AR');
  const { zonaY, zonaH } = dibujarTitulo(ctx, W, L, [mayus(titulo), subtitulo.trim() ? mayus(subtitulo) : ''], color);

  // 2) Reparto: la captura lo más grande posible; si el texto no entra con letra cómoda, se
  // achica la captura de a pasos antes de achicar más la letra.
  const filas = [
    { icono: 'tormenta', texto: texto.trim() },
    { icono: 'reloj', texto: lineaEmision(emitidoEn) },
  ];
  let elegido = null;
  for (const escala of ESCALAS_IMAGEN) {
    const tam = contener(img.width, img.height, IMAGEN[tamano].w * escala, IMAGEN[tamano].h * escala);
    const alto = tam.h + 2 * MARCO + AIRE;
    const plan = planearFilas(ctx, W, L, filas, zonaH - alto);
    if (plan) elegido = { tam, alto, plan };
    if (plan && plan.f >= FUENTE_COMODA[tamano]) break;
  }
  if (!elegido) throw Object.assign(new Error('El texto es demasiado largo para la placa: acortalo un poco.'), { status: 400 });
  const { tam, alto, plan } = elegido;
  // El bloque (captura + filas) queda centrado en la zona libre.
  const libre = zonaH - alto - plan.total, arriba = zonaY + Math.max(0, libre * 0.35);

  // 3) Tarjeta de la captura: sombra, marco blanco redondeado y la captura mejorada adentro.
  const tw = tam.w + 2 * MARCO, th = tam.h + 2 * MARCO, tx = Math.round((W - tw) / 2), ty = Math.round(arriba);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.47)'; ctx.shadowBlur = 32; ctx.shadowOffsetY = 20;
  ctx.fillStyle = '#fff';
  rectRedondeado(ctx, tx, ty, tw, th, RADIO_TARJETA);
  ctx.fill();
  ctx.restore();
  ctx.save();
  rectRedondeado(ctx, tx + MARCO, ty + MARCO, tam.w, tam.h, Math.max(4, RADIO_TARJETA - MARCO));
  ctx.clip();
  ctx.drawImage(prepararCaptura(img, tam.w, tam.h), tx + MARCO, ty + MARCO);
  ctx.restore();

  // 4) Filas, sin caja, en lo que queda debajo de la captura.
  const filasY = ty + th + AIRE;
  await dibujarFilas(ctx, W, plan, filasY, zonaY + zonaH - filasY, color);
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
async function generarAvisoEspecialAmbos({ texto, emitidoEn, imagen, titulo, subtitulo, nivel }) {
  const img = await cargarCaptura(imagen);
  const [feedPng, historiasPng] = await Promise.all(TAMANOS.map((tamano) => generateAvisoEspecial({ texto, emitidoEn, imagen: img, titulo, subtitulo, nivel, tamano })));
  return { feedPng, historiasPng };
}

module.exports = { generateAvisoEspecial, generarAvisoEspecialAmbos, errorDeAvisoEspecial, lineaEmision, contener, TITULO, MAX_TEXTO, MAX_TITULO, TAMANOS };
