/**
 * A qué punto del ensamble (el centroide de cada uno de los 17 departamentos y las 13 ciudades del informe) le corresponde cada estación:
 *  - departamento: las estaciones que están DENTRO de su polígono (el valor del departamento es el promedio de ellas);
 *  - ciudad: las estaciones a no más de `RADIO_CIUDAD_KM` de la ciudad.
 * Un punto sin estaciones queda sin dato (no se le inventa uno con una estación lejana).
 */
const fs = require("fs");
const path = require("path");

const RADIO_CIUDAD_KM = 25;
let poligonos = null; // id de departamento → [anillos exteriores]
function cargarPoligonos() {
  if (poligonos) return poligonos;
  const g = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "data", "departamentos.geojson"), "utf8"));
  poligonos = new Map(g.features.map((f) => [String(f.properties.id), (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => p[0])]));
  return poligonos;
}

/** ¿El punto (lng, lat) está dentro del anillo? (trazado de rayos) */
function dentro(anillo, lng, lat) {
  let c = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/**
 * `puntos`: [{ id, lat, lng }] (los del ensamble); `estaciones`: [{ lat, lng }].
 * → arreglo (uno por punto) con los índices de las estaciones que le corresponden.
 */
function asignar(puntos, estaciones) {
  const polis = cargarPoligonos();
  return puntos.map((p) => {
    const anillos = polis.get(String(p.id));
    return estaciones.map((e, i) => [e, i]).filter(([e]) => (anillos ? anillos.some((a) => dentro(a, e.lng, e.lat)) : km(p, e) <= RADIO_CIUDAD_KM)).map(([, i]) => i);
  });
}

module.exports = { asignar, dentro, km, RADIO_CIUDAD_KM };
