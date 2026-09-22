const fs = require("fs");
const path = require("path");

/**
 * Los 17 departamentos de Misiones — la unidad geográfica del mapa de
 * riesgo de incendios (a diferencia del pronóstico del tiempo, que trabaja
 * por municipio). `departamentos.geojson` sale de disolver
 * `municipios.geojson` por su propiedad `departamento` (ver
 * `mapa-backend/data/` — no hay script de build, se regeneró a mano una
 * vez con turf.dissolve y se commiteó el resultado).
 */

const DEPARTAMENTOS_JSON_PATH = path.join(__dirname, "..", "..", "data", "departamentos.json");
const DEPARTAMENTOS_GEOJSON_PATH = path.join(__dirname, "..", "..", "data", "departamentos.geojson");

let _departamentos = null;
function loadDepartamentos() {
  if (!_departamentos) {
    _departamentos = JSON.parse(fs.readFileSync(DEPARTAMENTOS_JSON_PATH, "utf-8"));
  }
  return _departamentos;
}

/** Centroide (shoelace, área-ponderado) de un anillo simple —
 * geometry.coordinates[0] de un Polygon GeoJSON, [lng,lat]. */
function centroideAnillo(anillo) {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < anillo.length - 1; i++) {
    const [x0, y0] = anillo[i], [x1, y1] = anillo[i + 1];
    const cruzado = x0 * y1 - x1 * y0;
    area += cruzado;
    cx += (x0 + x1) * cruzado;
    cy += (y0 + y1) * cruzado;
  }
  area /= 2;
  return area === 0 ? { lng: anillo[0][0], lat: anillo[0][1] } : { lng: cx / (6 * area), lat: cy / (6 * area) };
}

// El centroide real de cada departamento (no el ilustrado en ningún SVG):
// lo usan tanto el mapa vectorial de las placas (para proyectar un
// polígono geográfico cualquiera sobre "MAPA MISIONES.svg", ver
// misionesVectorMap.js) como el cálculo del índice de riesgo de incendios
// (para pedirle el clima a Open-Meteo justo en ese punto, ver
// riesgoIncendiosIndiceCalculo.js) — un único centroide, calculado una vez.
let _centroides = null;
function loadCentroides() {
  if (!_centroides) {
    const geojson = JSON.parse(fs.readFileSync(DEPARTAMENTOS_GEOJSON_PATH, "utf-8"));
    _centroides = new Map(geojson.features.map((f) => [String(f.properties.id), centroideAnillo(f.geometry.coordinates[0])]));
  }
  return _centroides;
}

module.exports = { loadDepartamentos, DEPARTAMENTOS_GEOJSON_PATH, loadCentroides };
