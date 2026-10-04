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

/** Mismo criterio que el mapa interactivo: color por condición, o SIN_DATO. */
function colorPorCondicion(condicion) {
  if (!condicion) return SIN_DATO;
  const c = POR_NOMBRE.get(normalize(condicion));
  return c ? GRUPOS[c.grupo] : SIN_DATO;
}

module.exports = { colorPorCondicion, SIN_DATO };
