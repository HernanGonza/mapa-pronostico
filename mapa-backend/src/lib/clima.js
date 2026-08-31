/**
 * Grilla de clima real para las capas del mapa (nubosidad, lluvia,
 * temperatura, viento). Todo sale de Open-Meteo (modelo numérico, gratis,
 * sin key). Un solo request trae 48 h para ~49 puntos.
 *
 * Diseño defensivo (Render free + límite gratis de Open-Meteo):
 *  - Semilla commiteada en `data/clima-semilla.json`: el mapa SIEMPRE
 *    arranca con capas, aunque Open-Meteo esté rate-limiteando la IP.
 *  - `stale-while-revalidate`: si la caché venció, se devuelve igual y se
 *    refresca en segundo plano — el request del usuario nunca espera ni
 *    falla.
 *  - Sin reintentos ante 429/4xx: reintentar sobre un rate-limit solo
 *    hunde más la cuota. Se sirve lo último bueno y listo.
 */

const fs = require("fs");
const path = require("path");

// El modelo GFS/ICON se actualiza cada ~1-3 h. 60 min de caché nos deja
// MUY holgados dentro del plan gratis de Open-Meteo.
const CACHE_MS = 60 * 60 * 1000;
// Hasta 24 h servimos la última grilla buena sin marcarla como inservible:
// una capa de nubes de hace unas horas es infinitamente mejor que un panel
// de capas que no aparece.
const STALE_OK_MS = 24 * 60 * 60 * 1000;

const DIR_DATOS = path.join(__dirname, "..", "..", "data");
// Semilla commiteada (siempre existe en el deploy).
const SEMILLA = path.join(DIR_DATOS, "clima-semilla.json");
// Copia en disco de la última grilla buena (efímera en Render free, pero
// sobrevive reinicios en local / planes con disco).
const RESPALDO = path.join(DIR_DATOS, "store", "clima-ultimo.json");

// Recuadro amplio alrededor de Misiones: abarca Paraguay, buena parte del
// sur de Brasil, Corrientes y norte de Entre Ríos. Así se ven los sistemas
// de nubes/lluvia entrando y saliendo de la provincia, y las capas no
// terminan en un borde recto.
const BOUNDS = { latMin: -32, latMax: -21.5, lngMin: -60.5, lngMax: -49.5 };
// 7x7 = 49 puntos (~150 km de paso). Las capas se interpolan y se
// upsamplean a 200 px con textura de ruido encima, así que no hace falta
// más densidad — y 49 llamadas/refresco entra de sobra en la cuota.
const GRID = 7;

function construirGrilla() {
  const pts = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      pts.push({
        lat: BOUNDS.latMin + ((BOUNDS.latMax - BOUNDS.latMin) * i) / (GRID - 1),
        lng: BOUNDS.lngMin + ((BOUNDS.lngMax - BOUNDS.lngMin) * j) / (GRID - 1),
      });
    }
  }
  return pts;
}

let cache = null; // { at, data }
let ultimoBueno = null; // última respuesta OK (o la semilla): fallback duro
let refrescando = null; // promesa en vuelo, para no disparar 10 refrescos
let proximoIntento = 0; // evita martillar Open-Meteo después de un 429/fallo

const COOLDOWN_ERROR_MS = 15 * 60 * 1000;
const COOLDOWN_429_MS = 60 * 60 * 1000;

function cargarInicial() {
  // Preferimos el respaldo en disco si es más nuevo que la semilla.
  for (const f of [RESPALDO, SEMILLA]) {
    try {
      ultimoBueno = JSON.parse(fs.readFileSync(f, "utf8"));
      break;
    } catch {
      /* probamos el siguiente */
    }
  }
}
cargarInicial();

function guardarRespaldo(data) {
  ultimoBueno = data;
  try {
    fs.mkdirSync(path.dirname(RESPALDO), { recursive: true });
    fs.writeFileSync(RESPALDO, JSON.stringify(data));
  } catch (e) {
    console.warn("[clima] no se pudo guardar el respaldo:", e.message);
  }
}

async function pedirOpenMeteo(url) {
  // Un solo intento extra, y SOLO ante fallo de red (no ante 429/4xx/5xx:
  // reintentar sobre un rate-limit es contraproducente).
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      const err = new Error(`Open-Meteo respondió ${res.status}`);
      err.status = res.status;
      throw err;
    } catch (e) {
      if (i === 1 || /respondió \d/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
}

async function traerDeOpenMeteo() {
  const grid = construirGrilla();
  const lat = grid.map((p) => p.lat.toFixed(3)).join(",");
  const lng = grid.map((p) => p.lng.toFixed(3)).join(",");

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=cloud_cover,precipitation,temperature_2m,wind_speed_10m,wind_direction_10m` +
    `&forecast_days=2&wind_speed_unit=ms&timezone=America%2FArgentina%2FBuenos_Aires`;

  const body = await pedirOpenMeteo(url);
  const results = Array.isArray(body) ? body : [body];
  const horas = results[0].hourly.time; // ["2026-08-31T00:00", ...] hora local

  const puntos = results.map((r, idx) => {
    const h = r.hourly;
    const dir = h.wind_direction_10m;
    const spd = h.wind_speed_10m;
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
  proximoIntento = 0;
  guardarRespaldo(data);
  return data;
}

/** Dispara un refresco en segundo plano (idempotente). */
function refrescarEnFondo() {
  if (Date.now() < proximoIntento) return Promise.resolve(null);
  if (refrescando) return refrescando;
  refrescando = traerDeOpenMeteo()
    .catch((err) => {
      proximoIntento =
        Date.now() + (err.status === 429 ? COOLDOWN_429_MS : COOLDOWN_ERROR_MS);
      console.warn(
        `[clima] refresco falló: ${err.message}; próximo intento en ${
          err.status === 429 ? "60" : "15"
        } min`
      );
      return null;
    })
    .finally(() => {
      refrescando = null;
    });
  return refrescando;
}

/**
 * Devuelve la grilla de clima. NUNCA lanza ni bloquea si hay algo servible
 * (caché, respaldo o semilla). Solo lanza si no hay absolutamente nada y
 * Open-Meteo tampoco responde.
 */
async function obtenerGrillaClima() {
  const fresca = cache && Date.now() - cache.at < CACHE_MS;
  if (fresca) return cache.data;

  // Caché vencida pero utilizable: la servimos y refrescamos en fondo.
  if (cache && Date.now() - cache.at < STALE_OK_MS) {
    refrescarEnFondo();
    return cache.data;
  }

  // Durante el cooldown no hacemos un intento sincrónico adicional. La
  // semilla/respaldo sigue siendo una respuesta válida para el mapa.
  if (ultimoBueno && Date.now() < proximoIntento) return ultimoBueno;

  // Sin caché servible: intentamos una vez de verdad...
  try {
    return await traerDeOpenMeteo();
  } catch (err) {
    // ...y si falla, semilla/respaldo. Refrescamos en fondo por si el
    // rate-limit se libera.
    if (ultimoBueno) {
      proximoIntento =
        Date.now() + (err.status === 429 ? COOLDOWN_429_MS : COOLDOWN_ERROR_MS);
      return ultimoBueno;
    }
    throw err;
  }
}

// Un intento de calentar la caché al arrancar (sin romper el boot si falla).
refrescarEnFondo();

module.exports = { obtenerGrillaClima };
