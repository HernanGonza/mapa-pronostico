import { normalize } from "./normalizeText";

/**
 * Condición climática → ícono animado (Meteocons de Bas Milius, MIT —
 * ver public/iconos/LICENSE-meteocons.txt). Los SVG están en
 * public/iconos/ y animan solos (SMIL) incluso embebidos como <img>.
 *
 * Esto es SOLO para el mapa interactivo / la web. El PNG cuadrado para
 * redes sigue usando los íconos propios del backend (data/materiales/imgs),
 * no se toca.
 */

const MAPA = {
  despejado: "clear-day",
  "algo nublado": "partly-cloudy-day",
  "parcialmente nublado": "partly-cloudy-day",
  nublado: "cloudy",
  cubierto: "overcast",
  lloviznas: "drizzle",
  "lluvia leve": "drizzle",
  "lluvias debiles": "drizzle",
  "lluvias leves": "rain",
  "lluvias aisladas": "partly-cloudy-day-rain",
  "lluvias y lloviznas": "rain",
  lluvias: "rain",
  "lluvias intensas": "rain",
  "chaparrones aislados": "partly-cloudy-day-rain",
  chaparrones: "rain",
  "tormentas aisladas": "thunderstorms-day",
  "chaparrones y tormentas": "thunderstorms-rain",
  "lluvias y tormentas aisladas": "thunderstorms-day-rain",
  "lluvias y tormentas": "thunderstorms-rain",
};

const POR_NOMBRE = new Map(
  Object.entries(MAPA).map(([k, v]) => [normalize(k), v])
);

const FALLBACK = "not-available";

/** Devuelve la URL del SVG animado para una condición. */
export function iconoCondicionUrl(condicion) {
  const key = condicion ? POR_NOMBRE.get(normalize(condicion)) : null;
  return `/iconos/${key || FALLBACK}.svg`;
}
