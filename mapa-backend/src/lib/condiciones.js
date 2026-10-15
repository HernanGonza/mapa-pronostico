const { normalize } = require("./normalizeText");

/**
 * Paleta de colores por condición climática — copia en CommonJS de
 * mapa-frontend/src/lib/condiciones.js (mismos GRUPOS/CONDICIONES, mismo
 * criterio de normalización). Se usa para pintar los municipios del PNG
 * cuadrado (generateMap.js) con los mismos colores que el mapa interactivo
 * pinta vía colorPorCondicion(). Si se agrega/cambia una condición allá,
 * replicar acá.
 */

const GRUPOS = {
  // Paleta del 04/10/2026 (igual que mapa-frontend/src/lib/condiciones.js).
  despejado: "#FFD000",
  parcial: "#A2C2D6",
  nublado: "#B0B5B8",
  lloviznas: "#4CAF50",
  lluvias: "#2196F3",
  intensas: "#FF9800",
  chaparrones: "#1565C0",
  tormentas: "#9C27B0",
};

const SIN_DATO = "#c9d3a3";

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

/**
 * Resuelve una condición escrita de cualquier forma. Primero busca el nombre exacto; si no está, y el texto junta varias
 * condiciones («NUBLADO,CHAPARRONES AISLADOS», «nublado con lluvias»), toma la más severa de las que reconoce (la que
 * está más abajo en el catálogo), que es la que define el color del mapa.
 */
function resolver(condicion) {
  if (!condicion) return null;
  const exacta = POR_NOMBRE.get(normalize(condicion));
  if (exacta) return exacta;
  const partes = String(condicion).split(/[,;/+]|\s+con\s+|\s+e\s+/i).map((p) => POR_NOMBRE.get(normalize(p))).filter(Boolean);
  return partes.length ? partes.reduce((a, b) => (CONDICIONES.indexOf(b) > CONDICIONES.indexOf(a) ? b : a)) : null;
}

/** Mismo criterio que el mapa interactivo: color por condición, o SIN_DATO. */
function colorPorCondicion(condicion) {
  if (!condicion) return SIN_DATO;
  const c = resolver(condicion);
  return c ? GRUPOS[c.grupo] : SIN_DATO;
}

/** Nombre canónico exacto (el de los íconos) de una condición escrita de cualquier forma, o null si no está en el catálogo. */
function condicionCanonica(condicion) {
  const c = resolver(condicion);
  return c ? c.nombre : null;
}

module.exports = { colorPorCondicion, condicionCanonica, SIN_DATO };
