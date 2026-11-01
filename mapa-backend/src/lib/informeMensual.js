/**
 * Informe mensual «BALANCE HIDROMETEOROLÓGICO DEL MES DE …» (módulo «Informe mensual»). Se carga todo a mano (todavía no hay datos
 * suficientes, ordenados y validados para calcular las medias solas) y sigue la estructura del modelo de la DGAT (.docx):
 *   1. Título con el mes y el año.
 *   2. «Valores medios del mes»: tabla por estación (temperatura media, mínima media y máxima media, eventos hidrometeorológicos y
 *      precipitación acumulada) y las referencias de las unidades.
 *   3. «Resumen meteorológico del mes»: texto libre.
 *   4. «Pronóstico climático trimestral»: mapas (una imagen) y el texto con su análisis.
 *   5. «Estado actual y proyección del fenómeno del Niño»: mapas (una imagen) y el texto.
 *
 * Borrador (`b`):
 * {
 *   version: 1, anio: 2026, mes: 10,
 *   estaciones: [{ estacion, tmedia, tmin, tmax, eventos, precipitacion }],   // todo texto: los números con coma o punto
 *   resumen: "",
 *   trimestral: { imagenes: ["data:image/png;base64,…", …], texto: "" },   // hasta 6 imágenes: van en una sola fila, en ese orden
 *   nino:       { imagenes: ["data:image/jpeg;base64,…", …], texto: "" },
 * }
 */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const ESTACIONES_PREDETERMINADAS = ["Posadas", "Valle Hermoso", "San Pedro", "Andresito", "Campo Grande"];
const LIMITES = { estaciones: 20, nombre: 60, celda: 12, texto: 8000, imagen: 4_800_000, imagenes: 6, imagenesTotal: 12_000_000 };
const RE_NUMERO = /^-?\d+([.,]\d+)?$/;
const RE_IMAGEN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;

/** Las imágenes de una sección (los informes guardados antes traían una sola, en `imagen`). */
const imagenesDe = (s) => (Array.isArray(s?.imagenes) ? s.imagenes : s?.imagen ? [s.imagen] : []);
const vacio = (v) => v == null || String(v).trim() === "";

/** Qué está mal del borrador (los textos y las celdas pueden venir vacíos: el PDF se puede bajar incompleto), o null. */
function errorDeInformeMensual(b) {
  if (!b || typeof b !== "object") return "Falta el informe.";
  if (!Number.isInteger(b.anio) || b.anio < 2000 || b.anio > 2100) return "El año no es válido.";
  if (!Number.isInteger(b.mes) || b.mes < 1 || b.mes > 12) return "El mes no es válido.";
  if (!Array.isArray(b.estaciones) || b.estaciones.length > LIMITES.estaciones) return `Cargá hasta ${LIMITES.estaciones} estaciones.`;
  for (const e of b.estaciones) {
    if (!e || typeof e !== "object" || typeof e.estacion !== "string" || e.estacion.length > LIMITES.nombre) return `El nombre de una estación no es válido (hasta ${LIMITES.nombre} caracteres).`;
    for (const [campo, rotulo] of [["tmedia", "temperatura media"], ["tmin", "temperatura mínima media"], ["tmax", "temperatura máxima media"], ["eventos", "eventos"], ["precipitacion", "precipitación acumulada"]]) {
      const v = e[campo];
      if (vacio(v)) continue;
      if (typeof v !== "string" && typeof v !== "number") return `«${e.estacion || "Estación"}»: ${rotulo} no es un número.`;
      if (!RE_NUMERO.test(String(v).trim()) || String(v).length > LIMITES.celda) return `«${e.estacion || "Estación"}»: ${rotulo} tiene que ser un número (ej.: 24,5).`;
      if (campo === "eventos" && !/^\d+$/.test(String(v).trim())) return `«${e.estacion || "Estación"}»: los eventos son un número entero.`;
      if (campo === "precipitacion" && String(v).trim().startsWith("-")) return `«${e.estacion || "Estación"}»: la precipitación no puede ser negativa.`;
    }
  }
  if (b.resumen != null && (typeof b.resumen !== "string" || b.resumen.length > LIMITES.texto)) return `El resumen del mes admite hasta ${LIMITES.texto} caracteres.`;
  for (const [clave, nombre] of [["trimestral", "pronóstico climático trimestral"], ["nino", "fenómeno del Niño"]]) {
    const s = b[clave];
    if (s == null) continue;
    if (typeof s !== "object") return `La sección de ${nombre} no es válida.`;
    if (s.texto != null && (typeof s.texto !== "string" || s.texto.length > LIMITES.texto)) return `El texto de ${nombre} admite hasta ${LIMITES.texto} caracteres.`;
    const imgs = imagenesDe(s);
    if (imgs.length > LIMITES.imagenes) return `En ${nombre} entran hasta ${LIMITES.imagenes} imágenes.`;
    if (imgs.some((i) => !(typeof i === "string" && i.length <= LIMITES.imagen && RE_IMAGEN.test(i)))) return `Una imagen de ${nombre} no es válida (PNG o JPG, de hasta unos 3,5 MB).`;
    if (imgs.reduce((n, i) => n + i.length, 0) > LIMITES.imagenesTotal) return `Las imágenes de ${nombre} pesan demasiado juntas: usá menos o más chicas.`;
  }
  return null;
}

/** Sólo lo que se usa, recortado (lo que se guarda en la base). */
function normalizarInformeMensual(b) {
  const t = (v) => (typeof v === "string" ? v.trim() : "");
  const n = (v) => (vacio(v) ? "" : String(v).trim().replace(".", ","));
  const seccion = (s) => ({ imagenes: imagenesDe(s).filter(Boolean), texto: t(s?.texto) });
  return {
    version: 1, anio: b.anio, mes: b.mes,
    estaciones: b.estaciones.map((e) => ({ estacion: t(e.estacion), tmedia: n(e.tmedia), tmin: n(e.tmin), tmax: n(e.tmax), eventos: n(e.eventos), precipitacion: n(e.precipitacion) })),
    resumen: t(b.resumen), trimestral: seccion(b.trimestral), nino: seccion(b.nino),
  };
}

const tituloDe = (b) => `BALANCE HIDROMETEOROLÓGICO DEL MES DE ${MESES[b.mes - 1].toUpperCase()} DE ${b.anio}`;

module.exports = { imagenesDe, MESES, ESTACIONES_PREDETERMINADAS, LIMITES, errorDeInformeMensual, normalizarInformeMensual, tituloDe };
