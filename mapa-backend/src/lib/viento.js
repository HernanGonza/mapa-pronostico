const CACHE_MS = 30 * 60 * 1000; // 30 min — el modelo no se actualiza más seguido que eso

// Recuadro amplio alrededor de Misiones (incluye Paraguay, sur de Brasil,
// Corrientes) para que las partículas de viento no terminen en un borde
// recto sobre la provincia — la transición tiene que ser gradual.
const BOUNDS = { latMin: -31.5, latMax: -22.5, lngMin: -59.5, lngMax: -50.5 };
const GRID_SIZE = 10; // 10x10 = 100 puntos, un solo request a Open-Meteo

function buildGrid() {
  const points = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    for (let j = 0; j < GRID_SIZE; j++) {
      const lat = BOUNDS.latMin + ((BOUNDS.latMax - BOUNDS.latMin) * i) / (GRID_SIZE - 1);
      const lng = BOUNDS.lngMin + ((BOUNDS.lngMax - BOUNDS.lngMin) * j) / (GRID_SIZE - 1);
      points.push({ lat, lng });
    }
  }
  return points;
}

let cache = null; // { at: timestamp, data: [...] }

/**
 * Trae velocidad + dirección de viento real (modelo numérico, vía
 * Open-Meteo — gratis, sin key) en una grilla sobre Misiones. Cachea en
 * memoria 30 min para no pegarle a la API en cada carga de página.
 */
async function obtenerGrillaViento() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache;
  }

  const grid = buildGrid();
  const lats = grid.map((p) => p.lat.toFixed(4)).join(",");
  const lngs = grid.map((p) => p.lng.toFixed(4)).join(",");

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    `&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo respondió ${res.status}`);
  }
  const body = await res.json();
  const results = Array.isArray(body) ? body : [body];

  const data = results.map((r, i) => ({
    lat: grid[i].lat,
    lng: grid[i].lng,
    speedKmh: r.current?.wind_speed_10m ?? null,
    directionDeg: r.current?.wind_direction_10m ?? null,
  }));

  cache = { at: Date.now(), puntos: data, gridSize: GRID_SIZE, bounds: BOUNDS };
  return cache;
}

module.exports = { obtenerGrillaViento };
