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
const LIMITES = { estaciones: 20, nombre: 60, titulo: 90, rotulo: 160, dias: 31, celda: 12, texto: 8000, imagen: 4_800_000, imagenes: 6, imagenesTotal: 12_000_000 };
const RE_NUMERO = /^-?\d+([.,]\d+)?$/;
const RE_IMAGEN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;

/** Las imágenes de una sección (los informes guardados antes traían una sola, en `imagen`). */
const imagenesDe = (s) => (Array.isArray(s?.imagenes) ? s.imagenes : s?.imagen ? [s.imagen] : []);
const CAMPOS_COLUMNA = ["tmedia", "tmin", "tmax", "eventos", "precipitacion"];
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Títulos editables del informe (los semanales los usan todos; vacío = el de siempre). */
const CLAVES_ROTULO = ["valores", "resumen", "trimestral", "nino", "estacion", "tmedia", "tmin", "tmax", "eventos", "precipitacion", "referencias", "elaborado"];
const vacio = (v) => v == null || String(v).trim() === "";

/** Qué está mal del borrador (los textos y las celdas pueden venir vacíos: el PDF se puede bajar incompleto), o null. */
function errorDeInformeMensual(b) {
  if (!b || typeof b !== "object") return "Falta el informe.";
  if (b.tipo === "semanal") {
    if (!RE_FECHA.test(b.desde || "") || !RE_FECHA.test(b.hasta || "") || Number.isNaN(Date.parse(b.desde)) || Number.isNaN(Date.parse(b.hasta))) return "Las fechas de la semana no son válidas.";
    if (b.hasta < b.desde) return "La semana termina antes de empezar.";
    if ((Date.parse(b.hasta) - Date.parse(b.desde)) / 86400000 >= LIMITES.dias) return `El período no puede pasar de ${LIMITES.dias} días.`;
  } else {
    if (!Number.isInteger(b.anio) || b.anio < 2000 || b.anio > 2100) return "El año no es válido.";
    if (!Number.isInteger(b.mes) || b.mes < 1 || b.mes > 12) return "El mes no es válido.";
  }
  if (b.rotulos != null && (typeof b.rotulos !== "object" || Object.entries(b.rotulos).some(([k, v]) => !CLAVES_ROTULO.includes(k) || (v != null && (typeof v !== "string" || v.length > LIMITES.rotulo))))) return `Los títulos admiten hasta ${LIMITES.rotulo} caracteres.`;
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
  if (b.columnasOcultas != null && (!Array.isArray(b.columnasOcultas) || b.columnasOcultas.some((c) => !CAMPOS_COLUMNA.includes(c)))) return "Las columnas ocultas no son válidas.";
  for (const c of ["titulo", "subtitulo"]) if (b[c] != null && (typeof b[c] !== "string" || b[c].length > LIMITES.titulo)) return `El título admite hasta ${LIMITES.titulo} caracteres.`;
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
  const rotulos = {};
  if (b.rotulos && typeof b.rotulos === "object") for (const k of CLAVES_ROTULO) if (t(b.rotulos[k])) rotulos[k] = t(b.rotulos[k]);
  return {
    version: 1, ...(b.tipo === "semanal" ? { tipo: "semanal", desde: b.desde, hasta: b.hasta } : { anio: b.anio, mes: b.mes }), rotulos,
    columnasOcultas: CAMPOS_COLUMNA.filter((c) => Array.isArray(b.columnasOcultas) && b.columnasOcultas.includes(c)),
    estaciones: b.estaciones.map((e) => ({ oculta: e.oculta === true, estacion: t(e.estacion), tmedia: n(e.tmedia), tmin: n(e.tmin), tmax: n(e.tmax), eventos: n(e.eventos), precipitacion: n(e.precipitacion) })),
    titulo: t(b.titulo), subtitulo: t(b.subtitulo), resumen: t(b.resumen), trimestral: seccion(b.trimestral), nino: seccion(b.nino),
  };
}

/** Título en dos renglones; lo que se dejó vacío (o no se tocó) sale con el texto de siempre. */
const TITULO_BASE = "BALANCE HIDROMETEOROLÓGICO";
const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const subtituloBase = (b) => (b.tipo === "semanal" ? `DE LA SEMANA DEL ${dm(b.desde)} AL ${dm(b.hasta)} DE ${b.hasta.slice(0, 4)}` : `DEL MES DE ${MESES[b.mes - 1].toUpperCase()} DE ${b.anio}`);
/** «octubre de 2026» o «26/10 al 01/11 de 2026»: para el título del archivo y el encabezado de las páginas. */
const etiquetaDe = (b) => (b.tipo === "semanal" ? `${dm(b.desde)} al ${dm(b.hasta)} de ${b.hasta.slice(0, 4)}` : `${MESES[b.mes - 1]} de ${b.anio}`);
const ROTULOS_BASE = {
  mensual: { valores: "Valores medios del mes", resumen: "Resumen meteorológico del mes", trimestral: "Pronóstico climático trimestral", nino: "Estado actual y proyección del fenómeno del Niño" },
  semanal: { valores: "Valores medios de la semana", resumen: "Resumen meteorológico de la semana", trimestral: "Pronóstico climático trimestral", nino: "Estado actual y proyección del fenómeno del Niño" },
};
const COLUMNAS_BASE = { estacion: "ESTACIÓN", tmedia: "TEMPERATURA MEDIA (°C)", tmin: "TEMPERATURA MÍNIMA MEDIA (°C)", tmax: "TEMPERATURA MÁXIMA MEDIA (°C)", eventos: "EVENTOS HIDROMETEOROLÓGICOS (N°)", precipitacion: "PRECIPITACIÓN ACUMULADA (mm)" };
const REFERENCIAS_BASE = "° C  Grados Celsius      N°  Número de eventos      mm  Milímetros de precipitación";
const ELABORADO_BASE = "INFORME ELABORADO POR";
/** Los títulos con los que sale el PDF: los editados, o los de siempre. */
const rotulosDe = (b) => ({ ...ROTULOS_BASE[b.tipo === "semanal" ? "semanal" : "mensual"], ...COLUMNAS_BASE, referencias: null, elaborado: ELABORADO_BASE, ...Object.fromEntries(Object.entries(b.rotulos || {}).filter(([, v]) => v)) });
const titulosDe = (b) => ({ titulo: (b.titulo || "").trim() || TITULO_BASE, subtitulo: (b.subtitulo || "").trim() || subtituloBase(b) });
const tituloDe = (b) => { const t = titulosDe(b); return `${t.titulo} ${t.subtitulo}`; };

module.exports = { REFERENCIAS_BASE, rotulosDe, etiquetaDe, CLAVES_ROTULO, TITULO_BASE, subtituloBase, titulosDe, CAMPOS_COLUMNA, imagenesDe, MESES, ESTACIONES_PREDETERMINADAS, LIMITES, errorDeInformeMensual, normalizarInformeMensual, tituloDe };
