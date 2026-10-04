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
  // Paleta del 04/10/2026: cielo (sin lluvia) y después de menor a mayor intensidad. El orden es
  // el de la leyenda. Tiene que coincidir con mapa-backend/src/lib/condiciones.js (la placa).
  despejado: { label: "Despejado", color: "#FFD000" },
  parcial: { label: "Parcialmente nublado", color: "#A2C2D6" },
  nublado: { label: "Nublado / cubierto", color: "#B0B5B8" },
  lloviznas: { label: "Lloviznas", color: "#4CAF50" },
  lluvias: { label: "Lluvias", color: "#2196F3" },
  chaparrones: { label: "Chaparrones", color: "#1565C0" },
  intensas: { label: "Lluvias intensas", color: "#FF9800" },
  tormentas: { label: "Tormentas", color: "#9C27B0" },
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

// Cómo se lee cada condición en el <select> (los nombres canónicos son los de los archivos de
// ícono, sin tildes). Sólo para mostrar: el valor que se guarda sigue siendo el canónico.
const TILDES = { debiles: "débiles" };
export const etiquetaCondicion = (nombre) => {
  const t = String(nombre).split(" ").map((p) => TILDES[p] || p).join(" ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * Las condiciones agrupadas por color, en el orden de la leyenda: para el <select> con <optgroup>,
 * así se ve en qué color del mapa cae cada una.
 *   [{ id, label, color, condiciones: [{ nombre, etiqueta }] }]
 */
export const CONDICIONES_POR_GRUPO = LEYENDA.map((g) => ({
  ...g, condiciones: CONDICIONES.filter((c) => c.grupo === g.id).map((c) => ({ nombre: c.nombre, etiqueta: etiquetaCondicion(c.nombre) })),
}));

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
