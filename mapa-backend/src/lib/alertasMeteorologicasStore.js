const fs = require("fs");
const path = require("path");
const store = require("./store");
const auth = require("./auth");
const departamentosStore = require("./departamentosStore");

/**
 * Publicación del mapa manual de alertas meteorológicas (el que alimenta
 * `/embed/alertas-meteorologicas`). Normalizado en tres tablas en vez de
 * los dos jsonb de antes, para poder hacer estadísticas/histórico
 * directo en SQL ("¿cuántas veces estuvo Rojo tal departamento este
 * año?") sin tener que desarmar jsonb:
 *   - alertas_meteo_publicaciones          (quién y cuándo)
 *   - alertas_meteo_publicacion_departamentos (color por departamento)
 *   - alertas_meteo_publicacion_fenomenos     (color por fenómeno elegido)
 *
 * Sin `DATABASE_URL`: cae a un archivo JSON en disco (como antes), sin
 * historial ni autoría — solo para desarrollo local sin base.
 */

const FILE = path.join(__dirname, "..", "..", "data", "store", "alertas-meteorologicas.json");
let initPromise;

async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  await Promise.all([auth.init(), departamentosStore.init()]);
  const p = store.getPool();
  initPromise = p
    .query(
      `CREATE TABLE IF NOT EXISTS alertas_meteo_publicaciones (
         id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         publicado_en timestamptz NOT NULL DEFAULT now(),
         usuario_id   bigint REFERENCES usuarios(id)
       );
       CREATE TABLE IF NOT EXISTS alertas_meteo_publicacion_departamentos (
         publicacion_id  bigint NOT NULL REFERENCES alertas_meteo_publicaciones(id) ON DELETE CASCADE,
         departamento_id text NOT NULL REFERENCES departamentos(id),
         categoria       text NOT NULL,
         PRIMARY KEY (publicacion_id, departamento_id)
       );
       CREATE TABLE IF NOT EXISTS alertas_meteo_publicacion_fenomenos (
         publicacion_id bigint NOT NULL REFERENCES alertas_meteo_publicaciones(id) ON DELETE CASCADE,
         fenomeno_id    text NOT NULL,
         categoria      text NOT NULL,
         PRIMARY KEY (publicacion_id, fenomeno_id)
       );
       ALTER TABLE alertas_meteo_publicacion_fenomenos ADD COLUMN IF NOT EXISTS categoria2 text`
    )
    .then(() => console.log("[alertasMeteorologicasStore] Postgres listo (publicaciones normalizadas)"))
    .catch((e) => {
      initPromise = null;
      throw e;
    });
  return initPromise;
}

async function publicar(zonas, iconos, usuarioId = null) {
  await init();
  const p = store.getPool();
  if (p) {
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO alertas_meteo_publicaciones (usuario_id) VALUES ($1) RETURNING id, publicado_en`,
        [usuarioId]
      );
      const { id, publicado_en } = rows[0];
      for (const z of zonas) {
        await client.query(
          `INSERT INTO alertas_meteo_publicacion_departamentos (publicacion_id, departamento_id, categoria) VALUES ($1,$2,$3)`,
          [id, z.id, z.categoria]
        );
      }
      for (const i of iconos) {
        await client.query(
          `INSERT INTO alertas_meteo_publicacion_fenomenos (publicacion_id, fenomeno_id, categoria, categoria2) VALUES ($1,$2,$3,$4)`,
          [id, i.id, i.categoria, i.categoria2 || null]
        );
      }
      await client.query("COMMIT");
      return { publicadoEn: publicado_en.toISOString(), zonas, iconos };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  const x = { publicadoEn: new Date().toISOString(), zonas, iconos };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(x));
  return x;
}

async function actual() {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows: pubs } = await p.query(
      `SELECT id, publicado_en FROM alertas_meteo_publicaciones ORDER BY id DESC LIMIT 1`
    );
    if (!pubs.length) return null;
    const { id, publicado_en } = pubs[0];
    const [{ rows: zonas }, { rows: iconos }] = await Promise.all([
      p.query(
        `SELECT departamento_id AS id, categoria FROM alertas_meteo_publicacion_departamentos WHERE publicacion_id = $1`,
        [id]
      ),
      p.query(
        `SELECT fenomeno_id AS id, categoria, categoria2 FROM alertas_meteo_publicacion_fenomenos WHERE publicacion_id = $1`,
        [id]
      ),
    ]);
    // categoria2 sólo viaja si hay segundo color (así lo publicado antes de esta función queda igual).
    return { publicadoEn: publicado_en.toISOString(), zonas, iconos: iconos.map(({ categoria2, ...i }) => (categoria2 ? { ...i, categoria2 } : i)) };
  }
  if (!fs.existsSync(FILE)) return null;
  const x = JSON.parse(fs.readFileSync(FILE));
  return { ...x, iconos: x.iconos || [] };
}

module.exports = { init, publicar, actual };
