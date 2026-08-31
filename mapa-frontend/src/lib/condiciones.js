import { normalize } from "./normalizeText";

/**
 * Catálogo canónico de condiciones climáticas.
 *
 * Las claves (`nombre`) coinciden con los nombres de archivo de los íconos
 * del backend (data/materiales/imgs/*.png) para que el ícono resuelva
 * siempre. El operador elige de esta lista en el panel — no se escribe a
 * mano — así nunca hay un typo que rompa color/ícono.
 *
 * `grupo` agrupa condiciones parecidas para la leyenda del mapa (que
 * muestra ~8 entradas, no 19). `color` sale de la paleta del brandbook:
 * amarillo/verde = tiempo estable, azules = lluvia (más oscuro = más
 * intensa), periwinkle = chaparrones, rosa Lapacho = tormenta (el evento
 * "de alerta" se lleva el color emblema de la marca).
 */

export const GRUPOS = {
  despejado: { label: "Despejado", color: "#efd44e" },
  parcial: { label: "Parcialmente nublado", color: "#c7d3a1" },
  nublado: { label: "Nublado / cubierto", color: "#9aa89d" },
  lloviznas: { label: "Lloviznas", color: "#a7c7e7" },
  lluvias: { label: "Lluvias", color: "#3371c6" },
  intensas: { label: "Lluvias intensas", color: "#10234b" },
  chaparrones: { label: "Chaparrones", color: "#7283c8" },
  tormentas: { label: "Tormentas", color: "#c9346c" },
};

export const SIN_DATO = { label: "Sin dato", color: "#c9d3a3" };

const CONDICIONES = [
  { nombre: "despejado", grupo: "despejado" },
  { nombre: "algo nublado", grupo: "parcial" },
  { nombre: "parcialmente nublado", grupo: "parcial" },
  { nombre: "nublado", grupo: "nublado" },
  { nombre: "cubierto", grupo: "nublado" },
  { nombre: "lloviznas", grupo: "lloviznas" },
  { nombre: "lluvia leve", grupo: "lloviznas" },
  { nombre: "lluvias debiles", grupo: "lloviznas" },
  { nombre: "lluvias leves", grupo: "lloviznas" },
  { nombre: "lluvias aisladas", grupo: "lluvias" },
  { nombre: "lluvias y lloviznas", grupo: "lluvias" },
  { nombre: "lluvias", grupo: "lluvias" },
  { nombre: "lluvias intensas", grupo: "intensas" },
  { nombre: "chaparrones aislados", grupo: "chaparrones" },
  { nombre: "chaparrones", grupo: "chaparrones" },
  { nombre: "tormentas aisladas", grupo: "tormentas" },
  { nombre: "chaparrones y tormentas", grupo: "tormentas" },
  { nombre: "lluvias y tormentas aisladas", grupo: "tormentas" },
  { nombre: "lluvias y tormentas", grupo: "tormentas" },
];

const POR_NOMBRE = new Map(CONDICIONES.map((c) => [normalize(c.nombre), c]));

/** Lista para poblar el <select> del panel, en orden de "severidad". */
export const CONDICIONES_CANONICAS = CONDICIONES.map((c) => c.nombre);

/** Grupos en el orden en que se muestran en la leyenda del mapa. */
export const LEYENDA = Object.entries(GRUPOS).map(([id, g]) => ({ id, ...g }));

/**
 * Color con el que se pinta el municipio en el mapa. Cae a `SIN_DATO` si
 * la condición no está en el catálogo (no debería pasar si viene del
 * <select>, pero el .docx podría traer texto inesperado).
 */
export function colorPorCondicion(condicion) {
  if (!condicion) return SIN_DATO.color;
  const c = POR_NOMBRE.get(normalize(condicion));
  return c ? GRUPOS[c.grupo].color : SIN_DATO.color;
}

export function grupoDeCondicion(condicion) {
  if (!condicion) return null;
  const c = POR_NOMBRE.get(normalize(condicion));
  return c ? GRUPOS[c.grupo] : null;
}

/** `true` si la condición está en el catálogo canónico. */
export function esCondicionConocida(condicion) {
  return POR_NOMBRE.has(normalize(condicion));
}

/**
 * Devuelve el nombre canónico exacto (el que usan los <option> del
 * <select> y los archivos de ícono) para una condición escrita de
 * cualquier forma — o null si no está en el catálogo.
 */
export function condicionCanonica(condicion) {
  const c = condicion ? POR_NOMBRE.get(normalize(condicion)) : null;
  return c ? c.nombre : null;
}

/** `true` si la condición corresponde a tormenta (para resaltar en el UI). */
export function esTormenta(condicion) {
  const c = POR_NOMBRE.get(normalize(condicion));
  return !!c && c.grupo === "tormentas";
}

/**
 * Descriptor del efecto visual (modo águila) por condición:
 *   { tipo, intensidad 0..1, nubosidad 0..1, lluvia 0..1, rayos }
 * `tipo` ∈ "sol" · "nublado" · "llovizna" · "lluvia" · "tormenta" · "granizo".
 * Sirve para que la animación de primer plano cambie según el municipio que
 * la cámara está sobrevolando.
 */
const FX_POR_GRUPO = {
  despejado: { tipo: "sol", intensidad: 1, nubosidad: 0.03, lluvia: 0, rayos: false },
  parcial: { tipo: "sol", intensidad: 0.55, nubosidad: 0.35, lluvia: 0, rayos: false },
  nublado: { tipo: "nublado", intensidad: 0.65, nubosidad: 0.82, lluvia: 0, rayos: false },
  lloviznas: { tipo: "llovizna", intensidad: 0.3, nubosidad: 0.72, lluvia: 0.3, rayos: false },
  lluvias: { tipo: "lluvia", intensidad: 0.6, nubosidad: 0.82, lluvia: 0.6, rayos: false },
  intensas: { tipo: "lluvia", intensidad: 1, nubosidad: 0.98, lluvia: 0.95, rayos: false },
  chaparrones: { tipo: "lluvia", intensidad: 0.72, nubosidad: 0.72, lluvia: 0.7, rayos: false },
  tormentas: { tipo: "tormenta", intensidad: 0.9, nubosidad: 1, lluvia: 0.9, rayos: true },
};

const FX_NEUTRO = { tipo: "nublado", intensidad: 0, nubosidad: 0, lluvia: 0, rayos: false };

export function fxDeCondicion(condicion) {
  if (condicion && /granizo/i.test(condicion)) {
    return { tipo: "granizo", intensidad: 0.8, nubosidad: 0.95, lluvia: 0.85, rayos: false };
  }
  const c = condicion ? POR_NOMBRE.get(normalize(condicion)) : null;
  return c ? FX_POR_GRUPO[c.grupo] : FX_NEUTRO;
}
