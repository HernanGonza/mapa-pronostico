const { normalize } = require("./normalizeText");

/**
 * Catálogo de condiciones del tiempo (lista fija, la del cuadro de íconos del informe). Una localidad o un día puede
 * llevar VARIAS: se guardan como un solo texto unido con « + » («Parcialmente nublado + Chaparrones»), que es lo que
 * viaja por todo el sistema (mapa, tarjetas, placas, PDF).
 *
 * Cada condición tiene su ícono de día y de noche: son los del Servicio Meteorológico Nacional (cuadro «Referencias» de
 * smn.gob.ar/pronostico), en public/iconos/smn y copiados en mapa-backend/data/iconos-smn para el PDF y las placas. El orden del catálogo es de menor a mayor severidad: con varias
 * condiciones, el color del mapa de la placa sale de la más severa.
 *
 * Copia en CommonJS de mapa-frontend/src/lib/condiciones.js (se usa para el PDF y la placa): si se cambia algo allá, cambiarlo acá.
 */

const GRUPOS = {
  // Paleta del 04/10/2026: cielo (sin lluvia) y después de menor a mayor intensidad. El orden es el de la leyenda.
  despejado: { label: "Despejado", color: "#FFD000" },
  parcial: { label: "Parcialmente nublado", color: "#A2C2D6" },
  nublado: { label: "Nublado / cubierto", color: "#B0B5B8" },
  niebla: { label: "Niebla y viento", color: "#9AA9B5" },
  lloviznas: { label: "Lloviznas", color: "#4CAF50" },
  lluvias: { label: "Lluvias", color: "#2196F3" },
  chaparrones: { label: "Chaparrones", color: "#1565C0" },
  intensas: { label: "Lluvias intensas", color: "#FF9800" },
  tormentas: { label: "Tormentas", color: "#9C27B0" },
  nieve: { label: "Nieve y ventisca", color: "#7FD1E8" },
};

/** Las categorías con las que se agrupan en el selector (no son los grupos de color). */
const CATEGORIAS = [
  { id: "cielo", titulo: "Cielo" }, { id: "viento", titulo: "Viento y niebla" }, { id: "lluvia", titulo: "Lluvia" },
  { id: "tormenta", titulo: "Tormentas" }, { id: "nieve", titulo: "Nieve y ventisca" },
];

const CATALOGO = [
  { id: "despejado", nombre: "Despejado", cat: "cielo", grupo: "despejado", dia: "smn/3.png", noche: "smn/5.png" },
  { id: "ligeramente-nublado", nombre: "Ligeramente nublado", cat: "cielo", grupo: "parcial", dia: "smn/13.png", noche: "smn/14.png" },
  { id: "algo-nublado", nombre: "Algo nublado", cat: "cielo", grupo: "parcial", dia: "smn/19.png", noche: "smn/20.png" },
  { id: "parcialmente-nublado", nombre: "Parcialmente nublado", cat: "cielo", grupo: "parcial", dia: "smn/25.png", noche: "smn/26.png" },
  { id: "mayormente-nublado", nombre: "Mayormente nublado", cat: "cielo", grupo: "nublado", dia: "smn/37.png", noche: "smn/38.png" },
  { id: "nublado", nombre: "Nublado", cat: "cielo", grupo: "nublado", dia: "smn/43.png", noche: "smn/43.png" },
  { id: "ventoso", nombre: "Ventoso", cat: "viento", grupo: "niebla", dia: "smn/51.png", noche: "smn/51.png" },
  { id: "neblina", nombre: "Neblina", cat: "viento", grupo: "niebla", dia: "smn/61.png", noche: "smn/61.png" },
  { id: "niebla", nombre: "Niebla", cat: "viento", grupo: "niebla", dia: "smn/67.png", noche: "smn/67.png" },
  { id: "niebla-helada", nombre: "Niebla helada", cat: "viento", grupo: "niebla", dia: "smn/69.png", noche: "smn/69.png" },
  { id: "llovizna", nombre: "Llovizna", cat: "lluvia", grupo: "lloviznas", dia: "smn/71.png", noche: "smn/71.png" },
  { id: "lluvias-aisladas", nombre: "Lluvias aisladas", cat: "lluvia", grupo: "lluvias", dia: "smn/72.png", noche: "smn/72.png" },
  { id: "lluvias", nombre: "Lluvias", cat: "lluvia", grupo: "lluvias", dia: "smn/73.png", noche: "smn/73.png" },
  { id: "chaparrones", nombre: "Chaparrones", cat: "lluvia", grupo: "chaparrones", dia: "smn/74.png", noche: "smn/75.png" },
  { id: "lluvias-fuertes", nombre: "Lluvias fuertes", cat: "lluvia", grupo: "intensas", dia: "smn/83.png", noche: "smn/83.png" },
  { id: "tormentas-aisladas", nombre: "Tormentas aisladas", cat: "tormenta", grupo: "tormentas", dia: "smn/76.png", noche: "smn/76.png" },
  { id: "tormentas", nombre: "Tormentas", cat: "tormenta", grupo: "tormentas", dia: "smn/81.png", noche: "smn/81.png" },
  { id: "tormentas-fuertes", nombre: "Tormentas fuertes", cat: "tormenta", grupo: "tormentas", dia: "smn/89.png", noche: "smn/89.png" },
  { id: "lluvias-y-nevadas", nombre: "Lluvias y nevadas", cat: "nieve", grupo: "nieve", dia: "smn/77.png", noche: "smn/77.png" },
  { id: "nevadas", nombre: "Nevadas", cat: "nieve", grupo: "nieve", dia: "smn/79.png", noche: "smn/79.png" },
  { id: "nevadas-fuertes", nombre: "Nevadas fuertes", cat: "nieve", grupo: "nieve", dia: "smn/85.png", noche: "smn/85.png" },
  { id: "ventisca-baja", nombre: "Ventisca baja", cat: "nieve", grupo: "nieve", dia: "smn/96.png", noche: "smn/96.png" },
  { id: "ventisca", nombre: "Ventisca", cat: "nieve", grupo: "nieve", dia: "smn/94.png", noche: "smn/94.png" },
  { id: "ventisca-alta", nombre: "Ventisca alta", cat: "nieve", grupo: "nieve", dia: "smn/92.png", noche: "smn/92.png" },
];
const SIN_DATO = { label: "Sin dato", color: "#c9d3a3" };

const POR_ID = new Map(CATALOGO.map((c) => [c.id, c]));
const POR_NOMBRE = new Map(CATALOGO.map((c) => [normalize(c.nombre), c]));
// Nombres de antes (y de los .docx viejos) → condiciones del catálogo nuevo.
const ALIAS = {
  lloviznas: ["llovizna"], "lluvia leve": ["llovizna"], "lluvias debiles": ["llovizna"], "lluvias leves": ["llovizna"],
  cubierto: ["nublado"], "lluvias y lloviznas": ["lluvias", "llovizna"], "lluvias intensas": ["lluvias-fuertes"],
  "chaparrones aislados": ["chaparrones"], "chaparrones y tormentas": ["chaparrones", "tormentas"],
  "lluvias y tormentas aisladas": ["lluvias", "tormentas-aisladas"], "lluvias y tormentas": ["lluvias", "tormentas"],
  "lluvia": ["lluvias"], "tormenta": ["tormentas"], "chaparron": ["chaparrones"],
};
const POR_ALIAS = new Map(Object.entries(ALIAS).map(([k, v]) => [normalize(k), v.map((id) => POR_ID.get(id))]));

/** Las condiciones del catálogo que nombra un texto («Nublado + Chaparrones», «NUBLADO,CHAPARRONES AISLADOS»), sin repetir y en el orden escrito. */
function partesCondicion(texto) {
  const t = String(texto ?? "").trim();
  if (!t) return [];
  const entero = POR_NOMBRE.get(normalize(t)) || null;
  const vistos = new Set(), salida = [];
  const agregar = (lista) => lista.forEach((c) => { if (c && !vistos.has(c.id)) { vistos.add(c.id); salida.push(c); } });
  if (entero) { agregar([entero]); return salida; }
  if (POR_ALIAS.has(normalize(t))) { agregar(POR_ALIAS.get(normalize(t))); return salida; }
  for (const parte of t.split(/\s*[+,;/]\s*|\s+con\s+|\s+y\s+/i)) {
    const n = normalize(parte);
    if (!n) continue;
    agregar(POR_NOMBRE.has(n) ? [POR_NOMBRE.get(n)] : POR_ALIAS.get(n) || []);
  }
  return salida;
}

/** El texto que se guarda para una lista de condiciones (ids o entradas del catálogo): «A + B». */
const unirCondiciones = (lista) => (lista || []).map((c) => (typeof c === "string" ? POR_ID.get(c) : c)).filter(Boolean).map((c) => c.nombre).join(" + ");

/** `true` si hay algo elegido o escrito. */
const hayCondicion = (condicion) => String(condicion ?? "").trim() !== "";
/** `true` si el texto se entiende con el catálogo (aunque venga escrito de otra forma). */
const esCondicionConocida = (condicion) => partesCondicion(condicion).length > 0;
/** El texto normalizado al catálogo («NUBLADO,CHAPARRONES AISLADOS» → «Nublado + Chaparrones»), o null si no se reconoce nada. */
const condicionCanonica = (condicion) => { const p = partesCondicion(condicion); return p.length ? unirCondiciones(p) : null; };

/** La más severa de las condiciones (la que manda para el color). */
const masSevera = (texto) => partesCondicion(texto).reduce((a, b) => (!a || CATALOGO.indexOf(b) > CATALOGO.indexOf(a) ? b : a), null);

/** Gravedad de un texto de condición: 0 = la primera del catálogo (Despejado) y sube con la severidad; -1 si no se reconoce ninguna. */
const gravedad = (texto) => { const c = masSevera(texto); return c ? CATALOGO.indexOf(c) : -1; };
/** El texto más grave de la lista (si empatan, el primero); "" si no hay ninguno. */
const masGraveDe = (textos) => textos.reduce((a, t) => (a === undefined || gravedad(t) > gravedad(a) ? t : a), undefined) ?? "";

/** Color de la placa / del mapa de administración: el de la condición más severa; `SIN_DATO` si no se reconoce ninguna. */
function colorPorCondicion(condicion) {
  const c = masSevera(condicion);
  return c ? GRUPOS[c.grupo].color : SIN_DATO.color;
}
function grupoDeCondicion(condicion) {
  const c = masSevera(condicion);
  return c ? GRUPOS[c.grupo] : null;
}
/** `true` si alguna de las condiciones es una tormenta. */
const esTormenta = (condicion) => partesCondicion(condicion).some((c) => c.cat === "tormenta");

/** Íconos de cada condición: [{ id, nombre, dia, noche }] (nombres de archivo de public/iconos, sin .svg). */
const iconosDeCondicion = (condicion) => partesCondicion(condicion).map(({ id, nombre, dia, noche }) => ({ id, nombre, dia, noche }));

/** Grupos en el orden en que se muestran en la leyenda del mapa de administración. */
const LEYENDA = Object.entries(GRUPOS).map(([id, g]) => ({ id, ...g }));

/** Nombres para sugerencias / listas simples. */
const CONDICIONES_CANONICAS = CATALOGO.map((c) => c.nombre);
const etiquetaCondicion = (nombre) => nombre;

/** El catálogo agrupado por categoría para el selector: [{ id, titulo, condiciones }]. */
const CONDICIONES_POR_CATEGORIA = CATEGORIAS.map((k) => ({ ...k, condiciones: CATALOGO.filter((c) => c.cat === k.id) }));

module.exports = { masSevera, gravedad, masGraveDe, GRUPOS, CATEGORIAS, CATALOGO, SIN_DATO, partesCondicion, unirCondiciones, hayCondicion, esCondicionConocida, condicionCanonica, colorPorCondicion, grupoDeCondicion, esTormenta, iconosDeCondicion, LEYENDA, CONDICIONES_CANONICAS, etiquetaCondicion, CONDICIONES_POR_CATEGORIA };
