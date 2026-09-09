/**
 * Normaliza la respuesta del sistema de alertas de incendio a una lista de
 * `{ lat, lon, intensidad, propiedades }`. El endpoint (ALERTAS_INCENDIOS_URL)
 * manda un array con un objeto por foco, shape confirmada:
 *
 *   {
 *     "latitud": -26.07103, "longitud": -54.31158,
 *     "fecha": "9/9/2026", "hora": "11:03 a. m.",
 *     "satelite": "PRUEBA", "frp": 5, "intensidad": 1,
 *     "municipio": "PUERTO ESPERANZA", "departamento": "IGUAZU",
 *     "vinculadoAANP": true, "anpNombre": "Buffer: Parque Provincial Esperanza"
 *   }
 *
 * `vinculadoAANP` (true/false) no filtra nada acá: vienen y se mapean todos
 * los focos de la provincia, estén o no en un área protegida. Se mantienen
 * también los nombres en inglés y variantes de mayúscula como respaldo, por
 * si el endpoint cambia de forma más adelante.
 */

const CAMPOS_LAT = ["latitud", "latitude", "lat"];
const CAMPOS_LON = ["longitud", "longitude", "lon", "lng"];
const CAMPOS_INTENSIDAD = ["intensidad", "Intensidad", "intensity", "Intensity", "frp", "brightness", "bright_ti4", "potencia", "confidence", "confianza"];

// DEMO TEMPORAL: se muestra hasta que llegue la primera tanda real del
// endpoint. Misma forma que el JSON confirmado, para ejercitar el mismo
// camino de código que los datos reales.
export const DATOS_DEMO_ALERTAS = [
  { latitud: -27.91, longitud: -55.75, fecha: "9/9/2026", hora: "09:15 a. m.", satelite: "DEMO", frp: 12, intensidad: 3, municipio: "APÓSTOLES", departamento: "APÓSTOLES", vinculadoAANP: false, anpNombre: null },
  { latitud: -27.77, longitud: -55.79, fecha: "9/9/2026", hora: "09:20 a. m.", satelite: "DEMO", frp: 8, intensidad: 2, municipio: "SAN JOSÉ", departamento: "APÓSTOLES", vinculadoAANP: false, anpNombre: null },
  { latitud: -26.41, longitud: -54.62, fecha: "9/9/2026", hora: "10:02 a. m.", satelite: "DEMO", frp: 15, intensidad: 3, municipio: "ELDORADO", departamento: "ELDORADO", vinculadoAANP: true, anpNombre: "Parque Provincial Piñalito" },
  { latitud: -25.60, longitud: -54.57, fecha: "9/9/2026", hora: "10:40 a. m.", satelite: "DEMO", frp: 5, intensidad: 1, municipio: "PUERTO IGUAZÚ", departamento: "IGUAZÚ", vinculadoAANP: false, anpNombre: null },
  { latitud: -27.36, longitud: -55.90, fecha: "9/9/2026", hora: "11:03 a. m.", satelite: "DEMO", frp: 3, intensidad: 1, municipio: "POSADAS", departamento: "CAPITAL", vinculadoAANP: false, anpNombre: null },
  { latitud: -27.49, longitud: -55.12, fecha: "9/9/2026", hora: "11:10 a. m.", satelite: "DEMO", frp: 20, intensidad: 4, municipio: "OBERÁ", departamento: "OBERÁ", vinculadoAANP: false, anpNombre: null },
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
