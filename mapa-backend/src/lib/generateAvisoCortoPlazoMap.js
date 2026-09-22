const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');
const { ZONAS, dibujarMapaConPoligono } = require('./misionesVectorMap');
const { errorDePoligono } = require('./avisosCortoPlazo');

/**
 * Placa de "Aviso a muy corto plazo" (SMN, ~15 min de anticipación).
 *
 * Antes se usaba generateAlertaMap.generateRecomendaciones con una captura
 * de pantalla del mapa interactivo dibujado en el frontend. Ahora, igual
 * que la placa de Alerta Meteorológica, el mapa se dibuja entero en el
 * backend sobre "MAPA MISIONES.svg" (mismo mapa vectorial que usa
 * generateAlertaMap.js) — pero acá no hay departamentos coloreados por
 * nivel (todos van del mismo color neutro) y encima se traza el polígono
 * real del CAP del SMN, proyectado con el ajuste calibrado en
 * misionesVectorMap.js (dibujarMapaConPoligono). Sin caja "NIVEL DE
 * ALERTA" ni fila de fenómenos/íconos, y sin la pill blanca del período:
 * el texto del aviso va directo sobre el fondo, con sombra, ocupando todo
 * ese espacio en vez de una caja.
 *
 * El título "AVISO A MUY CORTO PLAZO" ya viene dibujado en los 4 fondos
 * (data/alertas/aviso-corto-plazo/*.png) — a diferencia de Alerta
 * Meteorológica, acá no es editable, así que no hace falta redibujarlo.
 */
const DIR = path.join(__dirname, '../../data/alertas');
const ASSETS_DIR = path.join(DIR, 'aviso-corto-plazo');
// Familia propia (mismo archivo .ttf que generateAlertaMap.js, registrado
// bajo otro nombre) para no depender de que ese módulo se haya cargado antes.
registerFont(path.join(DIR, 'OakSans-Bold.ttf'), { family: 'AvisoCortoPlazoPlaca', weight: 'bold' });

const TITULO = 'Aviso a muy corto plazo';
const FONDOS = {
  nubes: { feed: 'feed-nubes.png', historias: 'historias-nubes.png' },
  tormenta: { feed: 'feed-tormenta.png', historias: 'historias-tormenta.png' },
};
const TAMANOS = ['feed', 'historias'];

// Los 17 departamentos van todos del mismo color neutro (no hay "nivel" por
// depto acá, sólo el polígono del aviso) — una especie de tarjeta clara
// sobre la foto, como el recuadro del mapa en Alerta Meteorológica.
const COLOR_DEPARTAMENTO = '#eef1ec';
const COLORES_DEPARTAMENTOS = new Map(ZONAS.map(([, depto]) => [depto, COLOR_DEPARTAMENTO]));
// Mismo violeta que "Alertas automáticas (SMN)" usa para ACP (ver
// mapa-backend/src/lib/smn/cap.mjs `colores.ACP` y PolygonDrawMap en el
// frontend) — se repite acá porque es el color final que queda impreso en
// la placa, generada enteramente en el backend.
const COLOR_POLIGONO = '#8b3fc4';

// Zona de contenido calibrada a ojo sobre cada fondo: debajo del título
// ("AVISO A MUY CORTO PLAZO", ya impreso en la imagen, con aire de sobra)
// y arriba de "Emergencias 911… / Fuente Servicio Meteorológico Nacional"
// (texto fijo del fondo, que va SOBRE la foto, antes de la franja blanca
// de los 3 logos). Si se reemplazan los fondos por otros con el título o
// ese pie en otra posición, hay que volver a medir estos valores a mano.
//
// El mapa y el texto se reparten esa zona de forma dinámica (ver
// generateAvisoCortoPlazoMap): el texto mide primero cuánto necesita y el
// mapa ocupa lo que sobra, entre mapaMinH y mapaMaxH — con un aviso corto
// el mapa queda grande, con uno largo se achica para no pisar el texto.
const LAYOUTS = {
  feed: { contentTop: 260, contentBottom: 1100, x: 90, w: 942, gap: 40, mapaMinH: 380, mapaMaxH: 650 },
  historias: { contentTop: 320, contentBottom: 1400, x: 75, w: 791, gap: 50, mapaMinH: 500, mapaMaxH: 850 },
};

let fondosPromise;
function loadFondos() {
  if (!fondosPromise) {
    fondosPromise = Promise.all(
      TAMANOS.flatMap((tamano) => Object.keys(FONDOS).map(async (fondo) => [`${fondo}:${tamano}`, await loadImage(path.join(ASSETS_DIR, FONDOS[fondo][tamano]))]))
    ).then(Object.fromEntries);
  }
  return fondosPromise;
}

// Mismo criterio simple de ajuste de líneas que generateAlertaMap.js (corta
// palabra por palabra según el ancho disponible, con `ctx.font` ya seteado).
function ajustarLineas(ctx, texto, maxWidth) {
  const palabras = texto.split(' '), lineas = []; let actual = '';
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (ctx.measureText(prueba).width > maxWidth && actual) { lineas.push(actual); actual = palabra; }
    else actual = prueba;
  }
  if (actual) lineas.push(actual);
  return lineas;
}

const MAX_TEXTO = 2400;
function errorDeAvisoCortoPlazoMap(texto, fondo) {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > MAX_TEXTO) return `Escribí el aviso (hasta ${MAX_TEXTO} caracteres).`;
  if (!Object.hasOwn(FONDOS, fondo)) return 'Elegí un fondo válido.';
  return null;
}

// Letra grande por defecto (como el período de Alerta Meteorológica) que se
// va achicando sola hasta que el texto completo entra en la caja.
const FUENTE_TEXTO_MAX = { feed: 56, historias: 64 };
const FUENTE_TEXTO_MIN = 26;

async function generateAvisoCortoPlazoMap({ texto, fondo = 'tormenta', tamano = 'feed', poligono }) {
  const error = errorDeAvisoCortoPlazoMap(texto, fondo) || errorDePoligono(poligono);
  if (error || !TAMANOS.includes(tamano)) throw Object.assign(new Error(error || 'Tamaño inválido.'), { status: 400 });
  const fondos = await loadFondos();
  const fondoImg = fondos[`${fondo}:${tamano}`];
  const canvas = createCanvas(fondoImg.width, fondoImg.height), ctx = canvas.getContext('2d');
  ctx.drawImage(fondoImg, 0, 0);

  const L = LAYOUTS[tamano];
  const alturaDisponible = L.contentBottom - L.contentTop;

  // 1) El texto mide primero cuánto necesita: letra grande por defecto,
  // que se achica hasta entrar en lo que le queda al mapa en su tamaño
  // mínimo. Así el mapa (calculado después) se achica o se agranda según
  // el aviso sea largo o corto, en vez de pisarse con el texto.
  const parrafos = texto.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  let tamanoFuente = FUENTE_TEXTO_MAX[tamano], lineas, lineH, textoAltura;
  for (;;) {
    ctx.font = `bold ${tamanoFuente}px AvisoCortoPlazoPlaca`;
    lineas = parrafos.flatMap((p) => ajustarLineas(ctx, p, L.w));
    lineH = tamanoFuente * 1.35;
    textoAltura = lineas.length * lineH;
    if (textoAltura <= alturaDisponible - L.mapaMinH - L.gap || tamanoFuente <= FUENTE_TEXTO_MIN) break;
    tamanoFuente -= 2;
  }

  // 2) El mapa ocupa lo que sobra (más grande con avisos cortos, más chico
  // con avisos largos), sin pasarse de un rango prolijo.
  const mapaAltura = Math.max(L.mapaMinH, Math.min(L.mapaMaxH, alturaDisponible - textoAltura - L.gap));
  await dibujarMapaConPoligono(ctx, COLORES_DEPARTAMENTOS, poligono, COLOR_POLIGONO, { x: L.x, y: L.contentTop, w: L.w, h: mapaAltura });

  // Texto del aviso: sin caja, directo sobre la foto (sombra para que se
  // lea igual sobre cielo claro u oscuro), centrado en lo que le quedó
  // libre debajo del mapa.
  const textoY = L.contentTop + mapaAltura + L.gap, textoZonaH = L.contentBottom - textoY;
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const cx = L.x + L.w / 2, cy = textoY + textoZonaH / 2, offset = ((lineas.length - 1) * lineH) / 2;
  lineas.forEach((linea, i) => ctx.fillText(linea, cx, cy - offset + i * lineH, L.w));
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  return canvas.toBuffer('image/png');
}

module.exports = { generateAvisoCortoPlazoMap, errorDeAvisoCortoPlazoMap, TITULO, MAX_TEXTO, TAMANOS };
