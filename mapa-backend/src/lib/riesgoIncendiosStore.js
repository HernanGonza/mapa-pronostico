const fs = require("fs");
const path = require("path");
const store = require("./store");

/**
 * Persistencia de la categoría de riesgo de incendio por departamento
 * (selección manual del operador, no calculada — ver panel de "Riesgo de
 * incendios"). Mismo patrón que `store.js` para el pronóstico: con
 * `DATABASE_URL` guarda una fila por "Publicar" (reutilizando el pool de
 * `store.js`, como hace `incendiosStore.js`); sin base, cae a un archivo
 * JSON en disco.
 */

const STORE_PATH = process.env.RIESGO_STORE_PATH || path.join(
  __dirname,
  "..",
  "..",
  "data",
  "store",
  "riesgo-incendios-actual.json"
);

let listo = null;

async function init() {
  if (!store.usaPostgres()) return;
  if (listo) return listo;
  await store.init();
  const pool = store.getPool();
  if (!pool) return;
  listo = pool
    .query(
      `CREATE TABLE IF NOT EXISTS riesgo_incendios (
         id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         publicado_en timestamptz NOT NULL DEFAULT now(),
         zonas        jsonb NOT NULL
       )`
    )
    .then(() => console.log("[riesgoIncendios] Postgres listo (tabla riesgo_incendios)"))
    .catch(err => { listo = null; throw err; });
  return listo;
}

async function publicar(zonas) {
  if (store.usaPostgres()) {
    await init();
    const pool = store.getPool();
    const { rows } = await pool.query(
      `INSERT INTO riesgo_incendios (zonas)
       VALUES ($1::jsonb)
       RETURNING publicado_en, zonas`,
      [JSON.stringify(zonas)]
    );
    return { publicadoEn: rows[0].publicado_en.toISOString(), zonas: rows[0].zonas };
  }

  const payload = { publicadoEn: new Date().toISOString(), zonas };
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  const temporal = `${STORE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporal, JSON.stringify(payload, null, 2));
  fs.renameSync(temporal, STORE_PATH);
  return payload;
}

async function obtenerActual() {
  if (store.usaPostgres()) {
    await init();
    const pool = store.getPool();
    const { rows } = await pool.query(
      `SELECT publicado_en, zonas
         FROM riesgo_incendios
         ORDER BY id DESC
         LIMIT 1`
    );
    if (!rows.length) return null;
    return { publicadoEn: rows[0].publicado_en.toISOString(), zonas: rows[0].zonas };
  }

  if (!fs.existsSync(STORE_PATH)) return null;
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
}

module.exports = { publicar, obtenerActual, init };
