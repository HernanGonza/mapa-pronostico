const fs = require("fs");
const path = require("path");

/**
 * Persistencia del pronóstico publicado.
 *
 * - Con `DATABASE_URL` (Postgres / Neon): guarda una fila por cada
 *   "Publicar" → queda el historial completo. El mapa usa la última.
 * - Sin `DATABASE_URL` (desarrollo local sin base): cae a un archivo
 *   JSON en disco, sin historial.
 *
 * Todas las funciones son async.
 *
 * El Postgres de producción es el de Supabase self-hosted de "ecodatos"
 * (compartido con otros servicios del Ministerio) — para no pisar sus
 * tablas, todo lo de este proyecto vive en el schema `alerta_temprana`,
 * propio. Cada conexión del pool fija `search_path` a ese schema (ver
 * `crearPool` más abajo); así las `CREATE TABLE IF NOT EXISTS` sin
 * calificar de este archivo y del resto de los módulos (auth,
 * alertasMeteorologicasStore, etc.) quedan ahí solas, sin tocar nada de
 * `public` ni de los demás schemas de ecodatos.
 */

const DATABASE_SCHEMA = process.env.DATABASE_SCHEMA || "alerta_temprana";

const STORE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "data",
  "store",
  "pronostico-actual.json"
);

let pool = null;
let listo = null;

function usaPostgres() {
  return !!process.env.DATABASE_URL;
}

/** Crea el pool y la tabla la primera vez. */
async function init() {
  if (!usaPostgres()) return;
  if (listo) return listo;
  const { Pool } = require("pg");
  // Neon (y la mayoría de los Postgres gestionados) exigen TLS. El Postgres
  // que corre en el mismo docker-compose no tiene TLS habilitado — ahí el
  // compose setea DATABASE_SSL=false.
  const sslDeshabilitado = /^(false|0|disable)$/i.test(process.env.DATABASE_SSL || "");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslDeshabilitado ? false : { rejectUnauthorized: false },
    max: 3,
  });
  // `options: -c search_path=...` en la connection string no siempre
  // sobrevive a un pooler (Supavisor) entre medio — se fija a mano en
  // cada conexión nueva del pool, que es lo que efectivamente respeta.
  pool.on("connect", (client) => {
    client.query(`SET search_path TO ${DATABASE_SCHEMA}, public`).catch((err) => {
      console.error("[store] No se pudo fijar el search_path:", err.message);
    });
  });
  listo = pool
    .query(`CREATE SCHEMA IF NOT EXISTS ${DATABASE_SCHEMA}`)
    .then(() =>
      pool.query(
        `CREATE TABLE IF NOT EXISTS pronosticos (
           id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
           publicado_en timestamptz NOT NULL DEFAULT now(),
           filas        jsonb NOT NULL,
           fecha_pronostico date
         )`
      )
    )
    .then(() => pool.query(`ALTER TABLE pronosticos ADD COLUMN IF NOT EXISTS fecha_pronostico date`))
    .then(() => pool.query(`ALTER TABLE pronosticos ADD COLUMN IF NOT EXISTS extendido jsonb`))
    .then(() => {
      console.log("[store] Postgres listo (tabla pronosticos)");
    })
    .catch(async (err) => {
      // Una caída breve de red durante el arranque no debe dejar el store
      // bloqueado para siempre con la misma promesa rechazada.
      const fallido = pool;
      pool = null;
      listo = null;
      await fallido?.end().catch(() => {});
      throw err;
    });
  return listo;
}

async function publicar(filas, fechaPronostico = null, extendido = null) {
  if (usaPostgres()) {
    await init();
    const { rows } = await pool.query(
      `INSERT INTO pronosticos (filas, fecha_pronostico, extendido)
       VALUES ($1::jsonb, $2::date, $3::jsonb)
       RETURNING publicado_en, filas, fecha_pronostico, extendido`,
      [JSON.stringify(filas), fechaPronostico || null, extendido ? JSON.stringify(extendido) : null]
    );
    return { publicadoEn: rows[0].publicado_en.toISOString(), fechaPronostico: rows[0].fecha_pronostico, filas: rows[0].filas, extendido: rows[0].extendido };
  }

  const payload = { publicadoEn: new Date().toISOString(), fechaPronostico: fechaPronostico || null, filas, extendido };
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

async function obtenerActual() {
  if (usaPostgres()) {
    await init();
    const { rows } = await pool.query(
      `SELECT publicado_en, fecha_pronostico, filas, extendido
         FROM pronosticos
         ORDER BY id DESC
         LIMIT 1`
    );
    if (!rows.length) return null;
    return {
      publicadoEn: rows[0].publicado_en.toISOString(),
      fechaPronostico: rows[0].fecha_pronostico,
      filas: rows[0].filas,
      extendido: rows[0].extendido,
    };
  }

  if (!fs.existsSync(STORE_PATH)) return null;
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
}

/** Lista liviana del historial (sin `filas`), lo más reciente primero. */
async function obtenerHistorial(limite = 60) {
  if (!usaPostgres()) return [];
  await init();
  const { rows } = await pool.query(
    `SELECT id, publicado_en
       FROM pronosticos
       ORDER BY id DESC
       LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    publicadoEn: r.publicado_en.toISOString(),
  }));
}

/** El pool de Postgres, para que otros módulos (auth, incendios) lo
 * reutilicen en vez de abrir cada uno el suyo. `null` si no hay
 * `DATABASE_URL` o todavía no se llamó a `init()`. */
function getPool() {
  return pool;
}

module.exports = { publicar, obtenerActual, obtenerHistorial, init, getPool, usaPostgres };
