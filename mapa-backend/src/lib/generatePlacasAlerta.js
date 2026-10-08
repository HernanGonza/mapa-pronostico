const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const { OAK_SANS, OAK_SANS_TITULO } = require('./fuentes');
const { dibujarIcono, NOMBRES: ICONOS } = require('./iconosPlaca');
const { categorias } = require('./alertasMeteorologicas');

/**
 * Placas que acompañan a una alerta meteorológica ya publicada (las tarjetas de la
 * pila en el panel), calcadas de las que se armaban a mano:
 *  - vigencia:        "ACTUALIZACIÓN DE VIGENCIA / ALERTA NARANJA", zonas con su horario,
 *                     el texto del fenómeno y una nota ("Siguen vigentes las recomendaciones…").
 *  - recomendaciones: "RECOMENDACIONES ANTE / ALERTA POR TORMENTA" y la lista de
 *                     recomendaciones, cada una con su ícono (de los dibujados o uno subido).
 *  - aviso:           "AVISO DE ALERTA / POR TORMENTA": vigencia, zona, texto y nota.
 *  - nivel:           "ACTUALIZACIÓN DE NIVEL / ALERTA POR TORMENTA": "El nivel de alerta pasa de
 *                     AMARILLO a NARANJA." (flecha para arriba o para abajo), zona, vigencia y texto.
 * Lo que va en color (2.ª línea del título, nombres de zona, el ícono «!») es del color
 * del nivel de la alerta; el resto, blanco. Siempre feed + historias, sobre el fondo de
 * rayos limpio del aviso especial (con "Emergencias 911…" y los logos ya impresos).
 * Toda la letra es Oak Sans (ExtraBold en los títulos).
 */
const ASSETS_DIR = path.join(__dirname, '../../data/alertas/aviso-especial');
const TAMANOS = ['feed', 'historias'];
const TIPOS = ['vigencia', 'recomendaciones', 'aviso', 'nivel'];
const NIVELES = ['Amarillo', 'Naranja', 'Rojo'];
const COLOR = Object.fromEntries(categorias.map((c) => [c.nombre, c.color]));

// Medidas en px sobre los fondos (2250×2813 feed, 2250×4000 historias). `pie`: dónde empieza
// "Emergencias 911…" impreso en el fondo; nada puede pasar de ahí.
const LAYOUTS = {
  feed: { tituloY: 230, linea1: 92, linea2: 150, pie: 2303, fuenteMax: 80 },
  historias: { tituloY: 330, linea1: 105, linea2: 175, pie: 3458, fuenteMax: 96 },
};
const FUENTE_MIN = 40;
const INTERLINEA = 1.3;
const SOMBRA = 'rgba(0,0,0,.55)';

const LIMITES = { zonas: 4, nombreZona: 60, descripcion: 700, nota: 220, fenomeno: 40, items: 7, item: 140, linea: 160, imagen: 400_000 };
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/, RE_HORA = /^([01]?\d|2[0-4]):[0-5]\d$/;
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** "Vigencia: sábado 03/10/2026 de 12:00 a 24:00 horas" (con un 2.º rango: "de 00:00 a 06:00 y de 12:00 a 18:00 horas"). */
function lineaVigencia({ fecha, desde, hasta, desde2, hasta2 }) {
  const [a, m, d] = fecha.split('-').map(Number);
  const dia = DIAS[new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay()];
  const z = (n) => String(n).padStart(2, '0');
  const hora = (h) => h.padStart(5, '0');
  const rangos = [`de ${hora(desde)} a ${hora(hasta)}`];
  if (desde2 && hasta2) rangos.push(`de ${hora(desde2)} a ${hora(hasta2)}`);
  return `Vigencia: ${dia} ${z(d)}/${z(m)}/${a} ${rangos.join(' y ')} horas`;
}

/** "Vigencia: 04/10/2026 desde las 00:00 a 06:00 horas." (actualización de nivel). */
function lineaVigenciaNivel({ fecha, desde, hasta }) {
  const [a, m, d] = fecha.split('-');
  const hora = (h) => h.padStart(5, '0');
  return `Vigencia: ${d}/${m}/${a} desde las ${hora(desde)} a ${hora(hasta)} horas.`;
}
const ANTERIORES = ['Verde', ...NIVELES];

const texto = (v, max) => typeof v === 'string' && v.trim() && v.length <= max;

/** Error de lo que manda el panel, o null si se puede generar. */
function errorDePlacaAlerta({ tipo, nivel, datos } = {}) {
  if (!TIPOS.includes(tipo)) return 'Tipo de placa inválido.';
  if (!NIVELES.includes(nivel)) return 'Elegí el nivel de la alerta (amarillo, naranja o rojo).';
  const d = datos || {};
  if (tipo === 'vigencia') {
    if (!Array.isArray(d.zonas) || !d.zonas.length || d.zonas.length > LIMITES.zonas) return `Cargá entre 1 y ${LIMITES.zonas} zonas.`;
    for (const z of d.zonas) {
      if (!texto(z?.nombre, LIMITES.nombreZona)) return `Cada zona necesita un nombre (hasta ${LIMITES.nombreZona} caracteres).`;
      if (!RE_FECHA.test(z.fecha || '') || !RE_HORA.test(z.desde || '') || !RE_HORA.test(z.hasta || '')) return `Revisá el día y el horario de «${z.nombre}» (horas como 12:00 o 24:00).`;
      if ((z.desde2 || z.hasta2) && (!RE_HORA.test(z.desde2 || '') || !RE_HORA.test(z.hasta2 || ''))) return `Revisá el segundo horario de «${z.nombre}» (desde y hasta, como 12:00 o 24:00).`;
    }
    if (!texto(d.descripcion, LIMITES.descripcion)) return `Escribí el texto del fenómeno (hasta ${LIMITES.descripcion} caracteres).`;
    if (d.nota && !texto(d.nota, LIMITES.nota)) return `La nota admite hasta ${LIMITES.nota} caracteres.`;
  }
  if (tipo === 'recomendaciones') {
    if (!texto(d.fenomeno, LIMITES.fenomeno)) return `Escribí el fenómeno del título (hasta ${LIMITES.fenomeno} caracteres).`;
    if (!Array.isArray(d.items) || !d.items.length || d.items.length > LIMITES.items) return `Cargá entre 1 y ${LIMITES.items} recomendaciones.`;
    for (const i of d.items) {
      if (!texto(i?.texto, LIMITES.item)) return `Cada recomendación necesita texto (hasta ${LIMITES.item} caracteres).`;
      if (i.imagen != null && !(typeof i.imagen === 'string' && /^data:image\/(png|jpeg);base64,/.test(i.imagen) && i.imagen.length <= LIMITES.imagen)) return 'Un ícono subido no es válido (PNG o JPG, chico).';
      if (i.imagen == null && !ICONOS.includes(i.icono)) return 'Falta el ícono de alguna recomendación.';
    }
  }
  if (tipo === 'aviso') {
    if (!texto(d.fenomeno, LIMITES.fenomeno)) return `Escribí el fenómeno del título (hasta ${LIMITES.fenomeno} caracteres).`;
    if (!texto(d.vigencia, LIMITES.linea)) return 'Escribí la vigencia (ej.: «próximas 3 horas»).';
    if (!texto(d.zona, LIMITES.linea)) return 'Escribí la zona.';
    if (!texto(d.descripcion, LIMITES.descripcion)) return `Escribí el texto del fenómeno (hasta ${LIMITES.descripcion} caracteres).`;
    if (d.nota && !texto(d.nota, LIMITES.nota)) return `La nota admite hasta ${LIMITES.nota} caracteres.`;
  }
  if (tipo === 'nivel') {
    if (!texto(d.fenomeno, LIMITES.fenomeno)) return `Escribí el fenómeno del título (hasta ${LIMITES.fenomeno} caracteres).`;
    if (!ANTERIORES.includes(d.nivelAnterior)) return 'Elegí de qué nivel venía la alerta.';
    if (d.nivelAnterior === nivel) return 'El nivel nuevo tiene que ser distinto del anterior.';
    if (!texto(d.zona, LIMITES.linea)) return 'Escribí la zona.';
    const v = d.vigencia || {};
    if (!RE_FECHA.test(v.fecha || '') || !RE_HORA.test(v.desde || '') || !RE_HORA.test(v.hasta || '')) return 'Revisá el día y el horario de la vigencia (horas como 00:00 o 24:00).';
    if (!texto(d.descripcion, LIMITES.descripcion)) return `Escribí el texto del fenómeno (hasta ${LIMITES.descripcion} caracteres).`;
  }
  return null;
}

/** Sólo los campos que se usan, recortados (lo que se guarda en la base). */
function normalizarPlacaAlerta({ tipo, nivel, datos: d }) {
  const t = (v) => (typeof v === 'string' ? v.trim() : '');
  if (tipo === 'vigencia') return { tipo, nivel, datos: { zonas: d.zonas.map((z) => ({ nombre: t(z.nombre), fecha: z.fecha, desde: z.desde, hasta: z.hasta, ...(z.desde2 && z.hasta2 ? { desde2: z.desde2, hasta2: z.hasta2 } : {}) })), descripcion: t(d.descripcion), nota: t(d.nota) } };
  if (tipo === 'recomendaciones') return { tipo, nivel, datos: { fenomeno: t(d.fenomeno), items: d.items.map((i) => (i.imagen ? { texto: t(i.texto), imagen: i.imagen } : { texto: t(i.texto), icono: i.icono })) } };
  if (tipo === 'nivel') return { tipo, nivel, datos: { fenomeno: t(d.fenomeno), nivelAnterior: d.nivelAnterior, zona: t(d.zona), vigencia: { fecha: d.vigencia.fecha, desde: d.vigencia.desde, hasta: d.vigencia.hasta }, descripcion: t(d.descripcion) } };
  return { tipo, nivel, datos: { fenomeno: t(d.fenomeno), vigencia: t(d.vigencia), zona: t(d.zona), descripcion: t(d.descripcion), nota: t(d.nota) } };
}

/** Título (2 líneas) y filas { icono | imagen, colorIcono?, titulo?, texto } de cada tipo. */
function contenido({ tipo, nivel, datos: d }) {
  const color = COLOR[nivel];
  const conPunto = (s) => (/[.!?…)]$/.test(s) ? s : `${s}.`);
  if (tipo === 'vigencia') {
    return {
      titulo: ['ACTUALIZACIÓN DE VIGENCIA', `ALERTA ${nivel.replace(/o$/, 'a').toUpperCase()}`],
      filas: [
        ...d.zonas.map((z) => ({ icono: 'reloj', titulo: z.nombre.toUpperCase(), texto: lineaVigencia(z) })),
        { icono: 'tormenta', texto: d.descripcion },
        ...(d.nota ? [{ icono: 'alerta', colorIcono: color, texto: d.nota }] : []),
      ],
    };
  }
  if (tipo === 'recomendaciones') {
    return { titulo: ['RECOMENDACIONES ANTE', `ALERTA POR ${d.fenomeno.toUpperCase()}`], filas: d.items.map((i) => ({ icono: i.icono, imagen: i.imagen, texto: i.texto })), iconoGrande: true };
  }
  if (tipo === 'nivel') {
    const sube = ANTERIORES.indexOf(nivel) > ANTERIORES.indexOf(d.nivelAnterior);
    return {
      titulo: ['ACTUALIZACIÓN DE NIVEL', `ALERTA POR ${d.fenomeno.toUpperCase()}`],
      filas: [
        { icono: sube ? 'sube' : 'baja', colorIcono: color, texto: `El nivel de alerta pasa de ${d.nivelAnterior.toUpperCase()} a ${nivel.toUpperCase()}.` },
        { icono: 'ubicacion', texto: conPunto(d.zona) },
        { icono: 'reloj', texto: lineaVigenciaNivel(d.vigencia) },
        { icono: 'tormenta', texto: d.descripcion },
      ],
    };
  }
  return {
    titulo: ['AVISO DE ALERTA', `POR ${d.fenomeno.toUpperCase()}`],
    filas: [
      { icono: 'reloj', texto: conPunto(`Vigencia: ${d.vigencia}`) },
      { icono: 'ubicacion', texto: conPunto(d.zona) },
      { icono: 'tormenta', texto: d.descripcion },
      ...(d.nota ? [{ icono: 'alerta', colorIcono: color, texto: d.nota }] : []),
    ],
  };
}

function ajustarLineas(ctx, parrafo, ancho) {
  const lineas = [];
  for (const p of String(parrafo).split('\n')) {
    let actual = '';
    for (const palabra of p.split(/\s+/).filter(Boolean)) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (ctx.measureText(prueba).width > ancho && actual) { lineas.push(actual); actual = palabra; } else actual = prueba;
    }
    if (actual) lineas.push(actual);
  }
  return lineas;
}

let fondosPromise;
function loadFondos() {
  if (!fondosPromise) {
    fondosPromise = Promise.all(TAMANOS.map(async (t) => [t, await loadImage(path.join(ASSETS_DIR, `${t}.png`))])).then(Object.fromEntries);
    fondosPromise.catch(() => { fondosPromise = null; });
  }
  return fondosPromise;
}

/** Fija el tamaño de letra para que las mayúsculas midan `alto`, sin pasar de `anchoMax`. */
function fuenteTitulo(ctx, linea, alto, anchoMax) {
  ctx.font = `bold 200px ${OAK_SANS_TITULO}`;
  const m = ctx.measureText(linea);
  const px = Math.min((200 * alto) / m.actualBoundingBoxAscent, (200 * anchoMax) / m.width);
  ctx.font = `bold ${Math.floor(px)}px ${OAK_SANS_TITULO}`;
  return ctx.measureText(linea);
}

/** Mide las filas con letra `f`: alto de cada una (texto) y sus líneas. */
function medirFilas(ctx, filas, f, anchoTexto) {
  return filas.map((fila) => {
    ctx.font = `bold ${Math.round(f * 1.12)}px ${OAK_SANS}`;
    const tit = fila.titulo ? ajustarLineas(ctx, fila.titulo, anchoTexto) : [];
    ctx.font = `${f}px ${OAK_SANS}`;
    const lin = ajustarLineas(ctx, fila.texto, anchoTexto);
    const alto = tit.length * f * 1.12 * INTERLINEA + lin.length * f * INTERLINEA;
    return { ...fila, tit, lin, alto };
  });
}

/**
 * Título de dos líneas (la 1.ª blanca, la 2.ª del color; sin 2.ª línea, una sola) con la raya
 * blanca debajo. Devuelve dónde empieza y cuánto mide la zona libre hasta el pie del fondo.
 */
function dibujarTitulo(ctx, W, L, titulo, color) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = SOMBRA; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
  const anchoTitulo = W - 2 * 280;
  let y = L.tituloY + L.linea1;
  const m1 = fuenteTitulo(ctx, titulo[0], L.linea1, anchoTitulo);
  ctx.fillStyle = '#fff'; ctx.fillText(titulo[0], W / 2, y);
  let ancho = m1.width;
  if (titulo[1]) {
    y += Math.round(L.linea2 * 0.38) + L.linea2;
    const m2 = fuenteTitulo(ctx, titulo[1], L.linea2, anchoTitulo);
    ctx.fillStyle = color; ctx.fillText(titulo[1], W / 2, y);
    ancho = Math.max(ancho, m2.width);
  }
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  const raya = Math.min(W - 2 * 150, ancho + 120);
  y += Math.round(L.linea2 * 0.42);
  ctx.fillStyle = '#fff'; ctx.fillRect((W - raya) / 2, y, raya, 9);
  const zonaY = y + 9 + Math.round(L.linea2 * 0.55);
  return { zonaY, zonaH: L.pie - Math.round(L.linea2 * 0.45) - zonaY };
}

/** La letra más grande (≤ fuenteMax) con la que las filas entran en `zonaH`, o null si ni con la mínima. */
function planearFilas(ctx, W, L, filas, zonaH, iconoGrande = false, fuenteMax = L.fuenteMax) {
  const margen = iconoGrande ? 300 : 190;
  const escalaIcono = iconoGrande ? 2.6 : 1.55;
  for (let f = fuenteMax; f >= FUENTE_MIN; f -= 2) {
    const icono = Math.round(f * escalaIcono), gapIcono = Math.round(f * (iconoGrande ? 0.75 : 0.9));
    const anchoTexto = W - 2 * margen - icono - gapIcono;
    const medidas = medirFilas(ctx, filas, f, anchoTexto).map((m) => ({ ...m, alto: Math.max(m.alto, iconoGrande ? icono : 0) }));
    const aireMin = f * (iconoGrande ? 0.7 : 1.1);
    const total = medidas.reduce((s, m) => s + m.alto, 0) + aireMin * (medidas.length - 1);
    if (total <= zonaH) return { f, icono, gapIcono, medidas, total, margen, iconoGrande };
  }
  return null;
}

/** Dibuja las filas (ícono + texto) en la zona, repartiendo el aire que sobra y centradas en alto. */
async function dibujarFilas(ctx, W, plan, zonaY, zonaH, color) {
  const { f, icono, gapIcono, medidas, margen, iconoGrande } = plan;
  // El espacio que sobra se reparte entre las filas (hasta un tope) y el bloque queda centrado.
  const suma = medidas.reduce((s, m) => s + m.alto, 0);
  const aire = medidas.length > 1 ? Math.min((zonaH - suma) / (medidas.length - 1), f * (iconoGrande ? 1.4 : 2.6)) : 0;
  const bloque = suma + aire * (medidas.length - 1);
  // Las recomendaciones van centradas en el ancho (como bloque); las demás, contra el margen.
  const anchoUsado = iconoGrande ? Math.max(...medidas.map((m) => { ctx.font = `${f}px ${OAK_SANS}`; return Math.max(...m.lin.map((l) => ctx.measureText(l).width)); })) + icono + gapIcono : null;
  const x0 = iconoGrande ? Math.round((W - anchoUsado) / 2) : margen;
  let y = zonaY + (zonaH - bloque) / 2;

  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const m of medidas) {
    // Ícono: centrado con el texto si son 1-2 renglones; si no, a la altura del primero.
    const renglones = m.tit.length + m.lin.length;
    const altoRef = renglones <= 2 ? m.alto : f * INTERLINEA * 2;
    const iy = y + altoRef / 2 - icono / 2;
    if (m.imagen) {
      const img = await loadImage(m.imagen);
      const k = Math.min(icono / img.width, icono / img.height);
      ctx.drawImage(img, x0 + (icono - img.width * k) / 2, iy + (icono - img.height * k) / 2, img.width * k, img.height * k);
    } else dibujarIcono(ctx, m.icono, x0, iy, icono, m.colorIcono || '#fff');
    const xt = x0 + icono + gapIcono;
    ctx.shadowColor = SOMBRA; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
    // Si el texto es más bajo que el ícono (recomendaciones), se centra con él.
    let ty = y + Math.max(0, (m.alto - (m.tit.length * f * 1.12 + m.lin.length * f) * INTERLINEA) / 2);
    ctx.font = `bold ${Math.round(f * 1.12)}px ${OAK_SANS}`; ctx.fillStyle = color;
    for (const l of m.tit) { ctx.fillText(l, xt, ty + (f * 1.12 * INTERLINEA) / 2); ty += f * 1.12 * INTERLINEA; }
    ctx.font = `${f}px ${OAK_SANS}`; ctx.fillStyle = '#fff';
    for (const l of m.lin) { ctx.fillText(l, xt, ty + (f * INTERLINEA) / 2); ty += f * INTERLINEA; }
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    y += m.alto + aire;
  }
}

async function generatePlacaAlerta(placa, tamano = 'feed') {
  const error = errorDePlacaAlerta(placa) || (TAMANOS.includes(tamano) ? null : 'Tamaño inválido.');
  if (error) throw Object.assign(new Error(error), { status: 400 });
  const { titulo, filas, iconoGrande } = contenido(placa);
  const color = COLOR[placa.nivel];
  const fondo = (await loadFondos())[tamano];
  const L = LAYOUTS[tamano], W = fondo.width;
  const canvas = createCanvas(W, fondo.height), ctx = canvas.getContext('2d');
  ctx.drawImage(fondo, 0, 0);
  const { zonaY, zonaH } = dibujarTitulo(ctx, W, L, titulo, color);
  const plan = planearFilas(ctx, W, L, filas, zonaH, iconoGrande);
  if (!plan) throw Object.assign(new Error('El texto es demasiado largo para la placa: acortalo un poco.'), { status: 400 });
  await dibujarFilas(ctx, W, plan, zonaY, zonaH, color);
  return canvas.toBuffer('image/png');
}

async function generarPlacaAlertaAmbos(placa) {
  const [feedPng, historiasPng] = await Promise.all(TAMANOS.map((t) => generatePlacaAlerta(placa, t)));
  return { feedPng, historiasPng };
}

/** Recomendaciones de siempre (las de la placa armada a mano); el panel las deja editar. */
const RECOMENDACIONES_PREDETERMINADAS = [
  { icono: 'objetos', texto: 'Asegurá objetos que puedan volarse' },
  { icono: 'arroyos', texto: 'Evitá cruzar arroyos o zonas inundadas' },
  { icono: 'resguardo', texto: 'Resguardate en un lugar seguro y evitá circular' },
  { icono: 'informado', texto: 'Mantente informado por canales oficiales' },
  { icono: 'emergencias', texto: 'Ante Emergencias llamá a 911 o Defensa Civil 103' },
];

module.exports = { generatePlacaAlerta, generarPlacaAlertaAmbos, dibujarTitulo, planearFilas, dibujarFilas, loadFondos, LAYOUTS, COLOR, errorDePlacaAlerta, normalizarPlacaAlerta, lineaVigencia, lineaVigenciaNivel, RECOMENDACIONES_PREDETERMINADAS, ICONOS, TIPOS, NIVELES, LIMITES };
