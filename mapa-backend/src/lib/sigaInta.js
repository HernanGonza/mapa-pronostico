/**
 * Estaciones automáticas de la Red Agrometeorológica INTA en Misiones
 * (SIGA — https://siga.inta.gob.ar), vía el mismo endpoint que usa su
 * propio mapa (sin key, público). Dan temperatura y humedad reales
 * medidas en el lugar, y la lluvia diaria ya sumada por la estación
 * (`precDiaCrono`) — no dan viento (son estaciones "Nimbus THP", sin
 * anemómetro), así que para viento sigue haciendo falta Open-Meteo (ver
 * climaPorDepartamento.js, que arma el clima final de cada departamento).
 */
const BASE = "https://siga.inta.gob.ar/CdnaUV0iiERRpFQE.php";
const TIMEOUT_MS = 15000;

// Las 7 estaciones de Misiones (de las 182 que tiene la red en todo el
// país) — id = el que usa SIGA internamente, medido a mano consultando
// param_type=estacion. Coordenadas redondeadas, sólo para elegir "la más
// cercana" a cada departamento (ver riesgoIncendiosEstaciones.js).
const ESTACIONES = {
  andresito: { id: 403, nombre: "Andresito - EEA Montecarlo", lat: -25.62, lng: -54.07 },
  irigoyen: { id: 404, nombre: "Bernardo de Irigoyen - EEA Montecarlo", lat: -26.28, lng: -53.67 },
  montecarlo: { id: 409, nombre: "Montecarlo - EEA Montecarlo", lat: -26.57, lng: -54.73 },
  lanus: { id: 386, nombre: "Villa Miguel Lanús - EEA Cerro Azul", lat: -27.43, lng: -55.89 },
  cerroAzul: { id: 382, nombre: "Cerro Azul - EEA Cerro Azul", lat: -27.66, lng: -55.44 },
  sanVicente: { id: 412, nombre: "San Vicente - EEA Cerro Azul", lat: -26.92, lng: -54.42 },
  alem: { id: 58, nombre: "INTA Cerro Azul (EMC) - Leandro N. Alem", lat: -27.65, lng: -55.43 },
};

async function pedir(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error(`SIGA-INTA: HTTP ${r.status}.`);
    return await r.json();
  } catch (e) {
    throw e.name === "AbortError" ? new Error("SIGA-INTA: tiempo de espera agotado.") : e;
  } finally {
    clearTimeout(timer);
  }
}

const aFechaCorta = (fechaISO) => {
  const [y, m, d] = fechaISO.split("-");
  return `${d}-${m}-${y}`;
};

/**
 * Clima diario real de una estación entre dos fechas ("YYYY-MM-DD"), ambas
 * inclusive — un solo pedido HTTP para todo el rango. Sin viento (ver
 * arriba). Devuelve un Map fecha -> {temperatura,humedad,precipitacion},
 * salteando los días sin dato de temperatura u humedad (la estación
 * puede no haber reportado ese día).
 */
async function climaEnRango(estacionId, desdeISO, hastaISO) {
  const url = `${BASE}?param_type=diario&param_value=${estacionId}/${aFechaCorta(desdeISO)}/${aFechaCorta(hastaISO)}`;
  const filas = await pedir(url);
  const porFecha = new Map();
  for (const f of filas || []) {
    if (f.tempAbrigo150 == null || f.HMedia == null) continue;
    porFecha.set(String(f.fechaHora).slice(0, 10), {
      temperatura: f.tempAbrigo150,
      humedad: f.HMedia,
      precipitacion: f.precDiaCrono ?? 0,
    });
  }
  return porFecha;
}

/** Clima de un único día (o `null` si esa estación no lo reportó). */
async function climaDeUnDia(estacionId, fechaISO) {
  const serie = await climaEnRango(estacionId, fechaISO, fechaISO);
  return serie.get(fechaISO) || null;
}

module.exports = { ESTACIONES, climaEnRango, climaDeUnDia };
