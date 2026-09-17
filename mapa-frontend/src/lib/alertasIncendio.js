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
const CAMPOS_INTENSIDAD = ["intensidad", "Intensidad", "intensity", "Intensity"];
const FORMATO_ARGENTINA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function fechaHoraArgentina(fecha, hora) {
  const hhmm = String(hora).padStart(4, "0");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^([01]\d|2[0-3])[0-5]\d$/.test(hhmm)) return null;
  const instante = new Date(`${fecha}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
  if (Number.isNaN(instante.getTime())) return null;
  const partes = Object.fromEntries(FORMATO_ARGENTINA.formatToParts(instante).map(({ type, value }) => [type, value]));
  return { fecha: `${partes.day}/${partes.month}/${partes.year}`, horaArgentina: `${partes.hour}:${partes.minute}` };
}

function buscarCampo(obj, candidatos) {
  for (const c of candidatos) {
    if (obj?.[c] != null && obj[c] !== "") {
      const n = Number(obj[c]);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

export function intensidadDeFrp(frp) {
  const valor = Number(frp);
  if (!Number.isFinite(valor) || valor < 0) return null;
  if (valor < 20) return 1;
  if (valor < 40) return 2;
  if (valor < 60) return 3;
  if (valor <= 80) return 4;
  return 5;
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
    const frp = buscarCampo(props, ["frp"]);
    const intensidad = frp == null ? buscarCampo(props, CAMPOS_INTENSIDAD) : intensidadDeFrp(frp);
    focos.push({ lat, lon, intensidad, propiedades: props });
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
        ...(f.propiedades?.acq_date && f.propiedades?.acq_time != null
          ? fechaHoraArgentina(f.propiedades.acq_date, f.propiedades.acq_time) : {}),
        ...(f.intensidad != null ? { Intensidad: f.intensidad } : {}),
      },
    })),
  };
}

function puntoEnAnillo([x, y], anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

export function crearIndiceMunicipios(geo) {
  return (geo?.features || []).map(({ properties, geometry }) => {
    const poligonos = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const exteriores = poligonos.map(anillos => anillos[0]);
    const xs = exteriores.flatMap(anillo => anillo.map(punto => punto[0]));
    const ys = exteriores.flatMap(anillo => anillo.map(punto => punto[1]));
    return { nombre: properties.nombre, poligonos,
      minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });
}

export function agregarMunicipios(puntos, indice) {
  if (!indice || !puntos) return puntos;
  return { ...puntos, features: puntos.features.map(foco => {
    const [x, y] = foco.geometry.coordinates;
    const municipio = indice.find(m => x >= m.minX && x <= m.maxX && y >= m.minY && y <= m.maxY &&
      m.poligonos.some(anillos => puntoEnAnillo([x, y], anillos[0]) &&
        !anillos.slice(1).some(hueco => puntoEnAnillo([x, y], hueco))));
    return { ...foco, properties: { ...foco.properties,
      municipio: municipio?.nombre || "Fuera de los municipios de Misiones" } };
  }) };
}
