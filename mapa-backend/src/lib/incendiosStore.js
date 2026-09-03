const store = require("./store");

/**
 * Última tanda de alertas de incendio (NASA FIRMS, vía nuestro sistema de
 * alertas) que se recuperó. Mismo patrón que `store.js` para el
 * pronóstico: una fila por "Recuperar últimas alertas", el embed público
 * usa siempre la más reciente.
 */

let listo = null;

async function init() {
  if (listo) return listo;
  await store.init();
  const pool = store.getPool();
  if (!pool) return;
  listo = pool
    .query(
      `CREATE TABLE IF NOT EXISTS alertas_incendio (
         id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         recuperado_en timestamptz NOT NULL DEFAULT now(),
         datos         jsonb NOT NULL
       )`
    )
    .then(() => console.log("[incendios] Postgres listo (tabla alertas_incendio)"));
  return listo;
}

async function guardar(datos) {
  await init();
  const pool = store.getPool();
  if (!pool) throw new Error("Falta DATABASE_URL");
  const { rows } = await pool.query(
    `INSERT INTO alertas_incendio (datos) VALUES ($1::jsonb)
     RETURNING recuperado_en, datos`,
    [JSON.stringify(datos)]
  );
  return { recuperadoEn: rows[0].recuperado_en.toISOString(), datos: rows[0].datos };
}

async function obtenerActual() {
  await init();
  const pool = store.getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT recuperado_en, datos FROM alertas_incendio ORDER BY id DESC LIMIT 1`
  );
  if (!rows.length) return null;
  return { recuperadoEn: rows[0].recuperado_en.toISOString(), datos: rows[0].datos };
}

/** Últimas `limite` tandas recibidas, para la lista del panel. */
async function obtenerHistorial(limite = 10) {
  await init();
  const pool = store.getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT recuperado_en, datos FROM alertas_incendio ORDER BY id DESC LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({
    recuperadoEn: r.recuperado_en.toISOString(),
    datos: r.datos,
  }));
}

module.exports = { init, guardar, obtenerActual, obtenerHistorial };
