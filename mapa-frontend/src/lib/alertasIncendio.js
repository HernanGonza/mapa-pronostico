/**
 * Normaliza la respuesta de nuestro sistema de alertas (que a su vez lee
 * NASA FIRMS) a una lista de `{ lat, lon, propiedades }`. Probamos varios
 * nombres de campo en vez de asumir uno solo — todavía no tenemos una
 * muestra real del endpoint (falta ALERTAS_INCENDIOS_URL), así que hasta
 * confirmarla esto evita romperse en silencio si el shape es otro.
 */

const CAMPOS_LAT = ["latitude", "lat", "latitud"];
const CAMPOS_LON = ["longitude", "lon", "lng", "longitud"];

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
    : datos?.alertas || datos?.focos || datos?.features || [];
  const focos = [];
  for (const item of lista) {
    const props = item?.properties || item; // por si ya viene como GeoJSON
    const lat = buscarCampo(props, CAMPOS_LAT);
    const lon = buscarCampo(props, CAMPOS_LON);
    if (lat == null || lon == null) continue;
    focos.push({ lat, lon, propiedades: props });
  }
  return focos;
}

export function focosAGeojson(focos) {
  return {
    type: "FeatureCollection",
    features: focos.map((f) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [f.lon, f.lat] },
      properties: f.propiedades,
    })),
  };
}
