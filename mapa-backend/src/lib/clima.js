/**
 * Grilla de clima real para las capas del mapa (nubosidad, lluvia,
 * temperatura, viento). Todo sale de Open-Meteo (modelo numérico, gratis,
 * sin key). Un solo request trae las 24 horas del día para ~144 puntos.
 *
 * Cache en memoria 30 min — el modelo no se actualiza más seguido.
 */

const fs = require("fs");
const path = require("path");

// 40 min: el modelo no se actualiza más seguido y así quedamos holgados
// dentro del límite gratis de Open-Meteo (10k llamadas/día ≈ 1 por punto).
const CACHE_MS = 40 * 60 * 1000;

// Copia en disco de la última grilla buena: si Open-Meteo se cae o se agota
// la cuota, el mapa igual arranca (con datos algo viejos, pero arranca).
const RESPALDO = path.join(__dirname, "..", "..", "data", "store", "clima-ultimo.json");

// Recuadro amplio alrededor de Misiones: abarca Paraguay, buena parte del
// sur de Brasil, Corrientes y norte de Entre Ríos. Así se ven los sistemas
// de nubes/lluvia entrando y saliendo de la provincia, y las capas no
// terminan en un borde recto.
const BOUNDS = { latMin: -32, latMax: -21.5, lngMin: -60.5, lngMax: -49.5 };
// 13x13 = 169 puntos (~90 km de paso). Con caché de 40 min son ~6 k
// llamadas/día a Open-Meteo, dentro del plan gratis.
const GRID = 13;

function construirGrilla() {
  const pts = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      pts.push({
        lat:
          BOUNDS.latMin + ((BOUNDS.latMax - BOUNDS.latMin) * i) / (GRID - 1),
        lng:
          BOUNDS.lngMin + ((BOUNDS.lngMax - BOUNDS.lngMin) * j) / (GRID - 1),
      });
    }
  }
  return pts;
}

let cache = null;
let ultimoBueno = null; // última respuesta OK: fallback si Open-Meteo se cae

try {
  ultimoBueno = JSON.parse(fs.readFileSync(RESPALDO, "utf8"));
} catch {
  /* todavía no hay respaldo */
}

function guardarRespaldo(data) {
  ultimoBueno = data;
  try {
    fs.mkdirSync(path.dirname(RESPALDO), { recursive: true });
    fs.writeFileSync(RESPALDO, JSON.stringify(data));
  } catch (e) {
    console.warn("[clima] no se pudo guardar el respaldo:", e.message);
  }
}

async function pedirOpenMeteo(url, intentos = 3) {
  let err;
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      err = new Error(`Open-Meteo respondió ${res.status}`);
      // 5xx / 429: reintentar con backoff; 4xx: no tiene sentido.
      if (res.status < 500 && res.status !== 429) throw err;
    } catch (e) {
      err = e;
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw err;
}

async function obtenerGrillaClima() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const grid = construirGrilla();
  const lat = grid.map((p) => p.lat.toFixed(3)).join(",");
  const lng = grid.map((p) => p.lng.toFixed(3)).join(",");

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=cloud_cover,precipitation,temperature_2m,wind_speed_10m,wind_direction_10m` +
    `&forecast_days=2&wind_speed_unit=ms&timezone=America%2FArgentina%2FBuenos_Aires`;

  let body;
  try {
    body = await pedirOpenMeteo(url);
  } catch (err) {
    // Open-Meteo caído: servimos la última grilla buena si la hay.
    if (ultimoBueno) return ultimoBueno;
    throw err;
  }
  const results = Array.isArray(body) ? body : [body];

  const horas = results[0].hourly.time; // ["2026-08-31T00:00", ...] hora local

  // Para cada punto, las series horarias de cada campo.
  const puntos = results.map((r, idx) => {
    const h = r.hourly;
    const dir = h.wind_direction_10m;
    const spd = h.wind_speed_10m;
    // Componentes u/v (hacia dónde sopla).
    const u = [];
    const v = [];
    for (let k = 0; k < spd.length; k++) {
      const rad = (((dir[k] ?? 0) + 180) * Math.PI) / 180;
      u.push(Math.sin(rad) * (spd[k] ?? 0));
      v.push(-Math.cos(rad) * (spd[k] ?? 0));
    }
    return {
      lat: grid[idx].lat,
      lng: grid[idx].lng,
      cloud: h.cloud_cover,
      precip: h.precipitation,
      temp: h.temperature_2m,
      windU: u,
      windV: v,
    };
  });

  const data = { bounds: BOUNDS, grid: GRID, horas, puntos };
  cache = { at: Date.now(), data };
  guardarRespaldo(data);
  return data;
}

module.exports = { obtenerGrillaClima };
