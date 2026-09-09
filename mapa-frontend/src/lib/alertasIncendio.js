/**
 * Normaliza la respuesta de nuestro sistema de alertas (que a su vez lee
 * NASA FIRMS) a una lista de `{ lat, lon, propiedades }`. Probamos varios
 * nombres de campo en vez de asumir uno solo — todavía no tenemos una
 * muestra real del endpoint (falta ALERTAS_INCENDIOS_URL), así que hasta
 * confirmarla esto evita romperse en silencio si el shape es otro.
 */

const CAMPOS_LAT = ["latitude", "lat", "latitud"];
const CAMPOS_LON = ["longitude", "lon", "lng", "longitud"];
const CAMPOS_INTENSIDAD = ["intensity", "Intensity", "intensidad", "Intensidad", "brightness", "bright_ti4", "frp", "potencia", "confidence", "confianza"];

// DEMO TEMPORAL: retirar cuando llegue el primer JSON real.
export const DATOS_DEMO_ALERTAS = [
  { lat: -27.91, lon: -55.75, intensity: 92, localidad: "Apóstoles" },
  { lat: -27.77, lon: -55.79, intensity: 58, localidad: "San José" },
  { lat: -26.41, lon: -54.62, intensity: 76, localidad: "Eldorado" },
  { lat: -25.60, lon: -54.57, intensity: 34, localidad: "Puerto Iguazú" },
  { lat: -27.36, lon: -55.90, intensity: 18, localidad: "Posadas" },
  { lat: -27.49, lon: -55.12, intensity: 5, localidad: "Oberá" },
];

function buscarCampo(obj, candidatos) {
  for (const c of candidatos) {
    if (obj?.[c] != null && obj[c] !== "") {
      const n = Number(obj[c]);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

export function extraerFocos(datos) {
  const lista = Array.isArray(datos)
    ? datos
    : datos?.alertas || datos?.focos || datos?.features || datos?.data || [];
  const focos = [];
  for (const item of lista) {
    const props = item?.properties || item; // por si ya viene como GeoJSON
    let lat = buscarCampo(props, CAMPOS_LAT);
    let lon = buscarCampo(props, CAMPOS_LON);
    // También aceptamos FeatureCollection GeoJSON (coordinates = [lon, lat]).
    if ((lat == null || lon == null) && item?.geometry?.type === "Point") {
      const [x, y] = item.geometry.coordinates || [];
      if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
        lon = Number(x); lat = Number(y);
      }
    }
    if (lat == null || lon == null) continue;
    const intensidad = buscarCampo(props, CAMPOS_INTENSIDAD);
    focos.push({ lat, lon, intensidad: intensidad == null ? 1 : Math.max(0, intensidad), propiedades: props });
  }
  return focos;
}

export function focosAGeojson(focos) {
  return {
    type: "FeatureCollection",
    features: focos.map((f) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [f.lon, f.lat] },
      // La ficha usa nombres claros y no duplica `intensity`/`intensidad`.
      properties: {
        ...Object.fromEntries(Object.entries(f.propiedades || {}).filter(([key]) =>
          !["intensity", "Intensity", "intensidad", "Intensidad", "lat", "latitude", "latitud", "lon", "lng", "longitude", "longitud"].includes(key)
        )),
        Intensidad: f.intensidad,
      },
    })),
  };
}
