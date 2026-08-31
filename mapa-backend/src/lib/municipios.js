const fs = require("fs");
const path = require("path");
const { normalize } = require("./normalizeText");
const { ALIAS_ESTACION_A_MUNICIPIO } = require("../config/estacionAliases");

const MUNICIPIOS_PATH = path.join(__dirname, "..", "..", "data", "municipios.json");

let _municipios = null;
function loadMunicipios() {
  if (!_municipios) {
    _municipios = JSON.parse(fs.readFileSync(MUNICIPIOS_PATH, "utf-8"));
  }
  return _municipios;
}

/**
 * Distancia entre dos puntos lat/lng, en kilómetros (fórmula de haversine).
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Resuelve, para cada una de las 13 localidades que reporta el .docx, el
 * municipio del dataset (con lat/lng) que le corresponde, vía el mapa de
 * alias. Si alguna no matchea, se loguea y se descarta (no debería pasar
 * si el .docx tiene las 13 de siempre).
 */
function resolverEstacionesConCoordenadas(filasPronostico) {
  const municipios = loadMunicipios();
  const porNombreNormalizado = new Map(municipios.map((m) => [normalize(m.nombre), m]));

  const estaciones = [];
  for (const fila of filasPronostico) {
    const nombreMunicipio =
      ALIAS_ESTACION_A_MUNICIPIO[fila.LOCALIDAD] ||
      ALIAS_ESTACION_A_MUNICIPIO[fila.LOCALIDAD.trim()];
    const municipio = nombreMunicipio
      ? porNombreNormalizado.get(normalize(nombreMunicipio))
      : porNombreNormalizado.get(normalize(fila.LOCALIDAD));

    if (!municipio) {
      console.warn(
        `[municipios] No se pudo geolocalizar la localidad "${fila.LOCALIDAD}" del .docx (revisar estacionAliases.js)`
      );
      continue;
    }
    estaciones.push({ ...fila, municipioId: municipio.id, lat: municipio.lat, lng: municipio.lng });
  }
  return estaciones;
}

/**
 * Arma la lista completa de municipios para el mapa: los 79, cada uno con
 * su municipio.lat/lng real y, si hay un pronóstico publicado, los datos
 * de la estación (de las 13) más cercana.
 *
 * - `esOficial: true` → el municipio ES una de las 13 estaciones (dato
 *   directo del .docx).
 * - `esOficial: false` → se muestra el dato de la estación más cercana,
 *   con `estacionReferencia` y `distanciaKm` para dejarlo claro en el UI.
 */
function armarMunicipiosConPronostico(filasPronostico) {
  const municipios = loadMunicipios();
  const estaciones = filasPronostico ? resolverEstacionesConCoordenadas(filasPronostico) : [];

  return municipios.map((m) => {
    if (estaciones.length === 0) {
      return { ...m, esOficial: false, estacionReferencia: null, distanciaKm: null, pronostico: null };
    }

    let mejor = null;
    let mejorDist = Infinity;
    for (const est of estaciones) {
      const d = haversineKm(m.lat, m.lng, est.lat, est.lng);
      if (d < mejorDist) {
        mejorDist = d;
        mejor = est;
      }
    }

    const esOficial = mejorDist < 1; // el municipio ES la estación (mismas coordenadas)

    return {
      ...m,
      esOficial,
      estacionReferencia: mejor.LOCALIDAD,
      distanciaKm: Math.round(mejorDist * 10) / 10,
      pronostico: {
        TMIN: mejor.TMIN,
        TMAX: mejor.TMAX,
        CONDICION: mejor.CONDICION,
      },
    };
  });
}

module.exports = { loadMunicipios, haversineKm, armarMunicipiosConPronostico };
