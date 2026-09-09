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

module.exports = { loadDepartamentos, DEPARTAMENTOS_GEOJSON_PATH };
