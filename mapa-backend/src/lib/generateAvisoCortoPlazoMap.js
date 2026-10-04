const path = require('path');
const { createCanvas, loadImage } = require('canvas');
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
const { OAK_SANS } = require('./fuentes');

const TITULO = 'Aviso a muy corto plazo';
const FONDOS = {
  nubes: { feed: 'feed-nubes.png', historias: 'historias-nubes.png' },
  tormenta: { feed: 'feed-tormenta.png', historias: 'historias-tormenta.png' },
};
const TAMANOS = ['feed', 'historias'];

// Recuadro del título "AVISO A MUY CORTO PLAZO" impreso en cada fondo (x0, y0, x1, y1, medido
// buscando sus píxeles blancos, con unos px de margen). Ahí se recolorea el título con el color
// del nivel (ver recolorearTitulo). Si se cambian los fondos, hay que volver a medirlos.
const CAJA_TITULO = {
  'tormenta:feed': [88, 87, 712, 156], 'nubes:feed': [92, 97, 771, 169],
  'tormenta:historias': [129, 99, 810, 172], 'nubes:historias': [168, 101, 776, 170],
};

/**
 * Pinta del color del nivel las letras blancas del título que ya trae el fondo. Es un
 * "multiplicar" pesado por la luminancia: lo blanco pasa a ser el color, el borde suavizado
 * de las letras se tiñe en proporción y el cielo oscuro de atrás casi no cambia.
 */
function recolorearTitulo(ctx, [x0, y0, x1, y1], color) {
  const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0), d = img.data;
  for (let k = 0; k < d.length; k += 4) {
    const r = d[k], g = d[k + 1], b = d[k + 2], mx = Math.max(r, g, b);
    if (mx - Math.min(r, g, b) > 45) continue; // sólo grises/blancos (las letras), no lo que ya tiene color
    const w = Math.min(1, Math.max(0, (mx - 90) / 130));
    if (!w) continue;
    d[k] = r + (r * cr / 255 - r) * w; d[k + 1] = g + (g * cg / 255 - g) * w; d[k + 2] = b + (b * cb / 255 - b) * w;
  }
  ctx.putImageData(img, x0, y0);
}

// Los 17 departamentos van todos del mismo color neutro (no hay "nivel" por
// depto acá, sólo el polígono del aviso) — una especie de tarjeta clara
// sobre la foto, como el recuadro del mapa en Alerta Meteorológica.
const COLOR_DEPARTAMENTO = '#eef1ec';
const COLORES_DEPARTAMENTOS = new Map(ZONAS.map(([, depto]) => [depto, COLOR_DEPARTAMENTO]));
// Color del polígono: el de la alerta vigente cuando se genera la placa (lo
// calcula la ruta con colorAcp.js); sin alerta, el violeta de siempre.
const { VIOLETA } = require('./colorAcp');

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

/**
 * El aviso por partes, como lo arma el asistente del panel (cada una en su paso):
 *   { fenomeno, emision: "AAAA-MM-DDTHH:mm" (hora de Misiones), validez, zonas }
 * En la placa va, en este orden: el fenómeno en mayúsculas y del color del nivel, "03/10/2026 a
 * las 18:04hs", "Validez hasta: <validez>" y las zonas. Los avisos de antes (texto libre) siguen
 * funcionando: sin `partes`, se dibuja `texto` tal cual, en blanco.
 */
const MAX_PARTE = { fenomeno: 300, validez: 120, zonas: 400 };
const RE_EMISION = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
function errorDePartes(partes) {
  if (!partes || typeof partes !== 'object') return 'Faltan los textos del aviso.';
  const { fenomeno, emision, validez, zonas = '' } = partes;
  if (typeof fenomeno !== 'string' || !fenomeno.trim() || fenomeno.length > MAX_PARTE.fenomeno) return `Escribí el fenómeno (hasta ${MAX_PARTE.fenomeno} caracteres).`;
  if (typeof emision !== 'string' || !RE_EMISION.test(emision)) return 'Elegí la fecha y la hora de emisión.';
  if (typeof validez !== 'string' || !validez.trim() || validez.length > MAX_PARTE.validez) return `Escribí la validez (hasta ${MAX_PARTE.validez} caracteres).`;
  if (typeof zonas !== 'string' || zonas.length > MAX_PARTE.zonas) return `Las zonas admiten hasta ${MAX_PARTE.zonas} caracteres.`;
  return null;
}
const normalizarPartes = ({ fenomeno, emision, validez, zonas = '' }) => ({ fenomeno: fenomeno.trim(), emision, validez: validez.trim(), zonas: zonas.trim() });
/** Renglones de la placa (y del texto guardado): [{ texto, destacado }]. */
function renglonesDePartes({ fenomeno, emision, validez, zonas }) {
  const [, a, m, d, hh, mm] = RE_EMISION.exec(emision);
  return [
    { texto: fenomeno.toLocaleUpperCase('es-AR'), destacado: true },
    { texto: `${d}/${m}/${a} a las ${hh}:${mm}hs` },
    { texto: `Validez hasta: ${validez}` },
    ...(zonas ? [{ texto: zonas }] : []),
  ];
}
/** El texto plano equivalente (lo que se guarda, el epígrafe y el cartel del mapa público). */
const textoDePartes = (partes) => renglonesDePartes(partes).map((r) => r.texto).join('\n');

function errorDeAvisoCortoPlazoMap(texto, fondo) {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > MAX_TEXTO) return `Escribí el aviso (hasta ${MAX_TEXTO} caracteres).`;
  if (!Object.hasOwn(FONDOS, fondo)) return 'Elegí un fondo válido.';
  return null;
}

// Letra grande por defecto (como el período de Alerta Meteorológica) que se
// va achicando sola hasta que el texto completo entra en la caja.
const FUENTE_TEXTO_MAX = { feed: 56, historias: 64 };
const FUENTE_TEXTO_MIN = 26;

async function generateAvisoCortoPlazoMap({ texto, partes = null, fondo = 'tormenta', tamano = 'feed', poligono, color = VIOLETA }) {
  if (partes) texto = textoDePartes(partes);
  const error = (partes && errorDePartes(partes)) || errorDeAvisoCortoPlazoMap(texto, fondo) || errorDePoligono(poligono);
  if (error || !TAMANOS.includes(tamano)) throw Object.assign(new Error(error || 'Tamaño inválido.'), { status: 400 });
  const fondos = await loadFondos();
  const fondoImg = fondos[`${fondo}:${tamano}`];
  const canvas = createCanvas(fondoImg.width, fondoImg.height), ctx = canvas.getContext('2d');
  ctx.drawImage(fondoImg, 0, 0);
  // Con nivel (amarillo/naranja/rojo), el título va de ese color; sin alerta queda blanco.
  if (color !== VIOLETA) recolorearTitulo(ctx, CAJA_TITULO[`${fondo}:${tamano}`], color);

  const L = LAYOUTS[tamano];
  const alturaDisponible = L.contentBottom - L.contentTop;

  // 1) El texto mide primero cuánto necesita: letra grande por defecto,
  // que se achica hasta entrar en lo que le queda al mapa en su tamaño
  // mínimo. Así el mapa (calculado después) se achica o se agranda según
  // el aviso sea largo o corto, en vez de pisarse con el texto.
  // Por partes, el fenómeno va del color del nivel (sin alerta, blanco como el resto).
  const colorDestacado = color === VIOLETA ? '#fff' : color;
  const parrafos = partes
    ? renglonesDePartes(partes).map((r) => ({ texto: r.texto, color: r.destacado ? colorDestacado : '#fff' }))
    : texto.trim().split('\n').map((l) => l.trim()).filter(Boolean).map((t) => ({ texto: t, color: '#fff' }));
  let tamanoFuente = FUENTE_TEXTO_MAX[tamano], lineas, lineH, textoAltura;
  for (;;) {
    ctx.font = `bold ${tamanoFuente}px ${OAK_SANS}`;
    lineas = parrafos.flatMap((p) => ajustarLineas(ctx, p.texto, L.w).map((linea) => ({ linea, color: p.color })));
    lineH = tamanoFuente * 1.35;
    textoAltura = lineas.length * lineH;
    if (textoAltura <= alturaDisponible - L.mapaMinH - L.gap || tamanoFuente <= FUENTE_TEXTO_MIN) break;
    tamanoFuente -= 2;
  }

  // 2) El mapa ocupa lo que sobra (más grande con avisos cortos, más chico
  // con avisos largos), sin pasarse de un rango prolijo.
  const mapaAltura = Math.max(L.mapaMinH, Math.min(L.mapaMaxH, alturaDisponible - textoAltura - L.gap));
  await dibujarMapaConPoligono(ctx, COLORES_DEPARTAMENTOS, poligono, color, { x: L.x, y: L.contentTop, w: L.w, h: mapaAltura });

  // Texto del aviso: sin caja, directo sobre la foto (sombra para que se
  // lea igual sobre cielo claro u oscuro), centrado en lo que le quedó
  // libre debajo del mapa.
  const textoY = L.contentTop + mapaAltura + L.gap, textoZonaH = L.contentBottom - textoY;
  ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const cx = L.x + L.w / 2, cy = textoY + textoZonaH / 2, offset = ((lineas.length - 1) * lineH) / 2;
  lineas.forEach(({ linea, color: c }, i) => { ctx.fillStyle = c; ctx.fillText(linea, cx, cy - offset + i * lineH, L.w); });
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  return canvas.toBuffer('image/png');
}

module.exports = { generateAvisoCortoPlazoMap, errorDeAvisoCortoPlazoMap, errorDePartes, normalizarPartes, textoDePartes, TITULO, MAX_TEXTO, MAX_PARTE, TAMANOS };
