/**
 * Normaliza la respuesta del sistema de alertas de incendio a una lista de
 * `{ lat, lon, intensidad, propiedades }`. El webhook recibe un array
 * con un objeto por foco, con el formato de NASA FIRMS:
 *
 *   {
 *     "latitude": -26.08404, "longitude": -54.46181,
 *     "acq_date": "2026-09-17", "acq_time": "446",
 *     "frp": 0.47, "confidence": "n"
 *   }
 *
 * `vinculadoAANP` (true/false) no filtra nada acá: vienen y se mapean todos
 * los focos de la provincia, estén o no en un área protegida. Se mantienen
 * también los nombres en inglés y variantes de mayúscula como respaldo, por
 * si el endpoint cambia de forma más adelante.
 */

const CAMPOS_LAT = ["latitud", "latitude", "lat"];
const CAMPOS_LON = ["longitud", "longitude", "lon", "lng"];
const CAMPOS_INTENSIDAD = ["frp", "intensidad", "Intensidad", "intensity", "Intensity", "brightness", "bright_ti4", "potencia"];

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
          !["intensity", "Intensity", "intensidad", "Intensidad", "lat", "latitude", "latitud", "lon", "lng", "longitude", "longitud", "acq_date", "acq_time"].includes(key)
        )),
        ...(f.propiedades?.acq_date ? { fecha: f.propiedades.acq_date } : {}),
        ...(f.propiedades?.acq_time != null ? { hora: `${String(f.propiedades.acq_time).padStart(4, "0").slice(0, 2)}:${String(f.propiedades.acq_time).padStart(4, "0").slice(2)} UTC` } : {}),
        Intensidad: f.intensidad,
      },
    })),
  };
}
