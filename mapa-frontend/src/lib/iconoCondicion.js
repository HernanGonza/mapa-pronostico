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

/**
 * Si el texto no está tal cual en MAPA (el .docx del extendido trae
 * variantes: "chaparrones y tormentas aisladas", "tormentas y chaparrones
 * aislados"…), se resuelve por palabras clave.
 */
function porPalabrasClave(condicion) {
  const t = normalize(condicion);
  const tormenta = /TORMENT/.test(t);
  const lluvia = /LLUVI|CHAPARR/.test(t);
  if (tormenta && lluvia) return /AISLAD/.test(t) ? "thunderstorms-day-rain" : "thunderstorms-rain";
  if (tormenta) return "thunderstorms-day";
  if (/CHAPARR|LLUVI/.test(t)) return /AISLAD/.test(t) ? "partly-cloudy-day-rain" : "rain";
  if (/LLOVIZN/.test(t)) return "drizzle";
  return null;
}

/** Devuelve la URL del SVG animado para una condición. */
export function iconoCondicionUrl(condicion) {
  const key = condicion
    ? POR_NOMBRE.get(normalize(condicion)) || porPalabrasClave(condicion)
    : null;
  return `/iconos/${key || FALLBACK}.svg`;
}
