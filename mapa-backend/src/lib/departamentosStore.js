const store = require("./store");
const { loadDepartamentos } = require("./departamentos");

/**
 * Catálogo de los 17 departamentos en base — a diferencia de
 * `departamentos.js` (que lee el JSON/geojson estático para armar el
 * mapa), esta tabla existe para poder cruzar el histórico de alertas
 * con la ubicación (lat/lon) en consultas SQL de estadísticas.
 *
 * Los centroides se calcularon una sola vez a partir de
 * `data/departamentos.geojson` (centroide de polígono ponderado por
 * área — los departamentos son formas irregulares/cóncavas, un
 * promedio simple de vértices da un punto corrido) y quedan
 * hardcodeados acá como semilla; no dependen de ninguna librería (no
 * hay `turf` entre las dependencias).
 */
const CENTROIDES = {
  "1": { nombre: "Apóstoles", lat: -27.888482, lon: -55.677279 },
  "2": { nombre: "Cainguás", lat: -27.147788, lon: -54.802386 },
  "3": { nombre: "Candelaria", lat: -27.460624, lon: -55.582983 },
  "4": { nombre: "Capital", lat: -27.550725, lon: -55.855764 },
  "5": { nombre: "Concepción", lat: -27.930783, lon: -55.466965 },
  "6": { nombre: "Eldorado", lat: -26.313971, lon: -54.441141 },
  "7": { nombre: "General Manuel Belgrano", lat: -25.988799, lon: -53.959507 },
  "8": { nombre: "Guaraní", lat: -27.025741, lon: -54.269611 },
  "9": { nombre: "Iguazú", lat: -25.87327, lon: -54.400246 },
  "10": { nombre: "Libertador General San Martín", lat: -26.893091, lon: -54.92356 },
  "11": { nombre: "Leandro N. Alem", lat: -27.630585, lon: -55.388092 },
  "12": { nombre: "Montecarlo", lat: -26.658202, lon: -54.564848 },
  "13": { nombre: "Oberá", lat: -27.476205, lon: -55.071286 },
  "14": { nombre: "San Ignacio", lat: -27.17683, lon: -55.339976 },
  "15": { nombre: "San Javier", lat: -27.777156, lon: -55.167723 },
  "16": { nombre: "San Pedro", lat: -26.638364, lon: -53.966533 },
  "17": { nombre: "25 de Mayo", lat: -27.37827, lon: -54.634158 },
};

let initPromise;

/** Crea la tabla y siembra los 17 departamentos (idempotente). */
async function init() {
  await store.init();
  const pool = store.getPool();
  if (!pool) return;
  if (initPromise) return initPromise;
  initPromise = pool
    .query(
      `CREATE TABLE IF NOT EXISTS departamentos (
         id     text PRIMARY KEY,
         nombre text NOT NULL,
         lat    double precision NOT NULL,
         lon    double precision NOT NULL
       )`
    )
    .then(async () => {
      // Semilla desde el JSON estático (fuente de verdad de id/nombre)
      // + los centroides calculados de arriba. ON CONFLICT: si se
      // corrige un nombre o se recalcula un centroide, alcanza con
      // volver a correr esto.
      for (const d of loadDepartamentos()) {
        const c = CENTROIDES[String(d.id)];
        if (!c) continue;
        await pool.query(
          `INSERT INTO departamentos (id, nombre, lat, lon) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, lat = EXCLUDED.lat, lon = EXCLUDED.lon`,
          [String(d.id), d.nombre, c.lat, c.lon]
        );
      }
      console.log("[departamentosStore] Postgres listo (tabla departamentos, 17 sembrados)");
    })
    .catch((err) => {
      initPromise = null;
      throw err;
    });
  return initPromise;
}

module.exports = { init };
