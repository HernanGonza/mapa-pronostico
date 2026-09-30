const fs = require("fs");
const path = require("path");
const store = require("./store");
const auth = require("./auth");
const departamentosStore = require("./departamentosStore");
const { errorDeVigencia } = require("./avisosCortoPlazoStore");

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
       ALTER TABLE alertas_meteo_publicacion_fenomenos ADD COLUMN IF NOT EXISTS categoria2 text;
       -- Como los avisos a muy corto plazo: cada publicación se ve en el embebido hasta
       -- vigente_hasta y después se saca sola; puede haber varias a la vez (hoy y mañana).
       -- periodo = para cuándo es (lo que se lee en la tarjeta del embebido).
       -- Las publicadas antes de esto (vigente_hasta NULL) ya no se muestran.
       ALTER TABLE alertas_meteo_publicaciones ADD COLUMN IF NOT EXISTS vigente_hasta timestamptz;
       ALTER TABLE alertas_meteo_publicaciones ADD COLUMN IF NOT EXISTS periodo text`
    )
    .then(() => console.log("[alertasMeteorologicasStore] Postgres listo (publicaciones normalizadas)"))
    .catch((e) => {
      initPromise = null;
      throw e;
    });
  return initPromise;
}

const MAX_PERIODO_PUBLICACION = 120;
function errorDePublicacion({ vigenteHasta, periodo, reemplazar = [] }) {
  if (typeof periodo !== "string" || !periodo.trim() || periodo.length > MAX_PERIODO_PUBLICACION) return `Escribí para cuándo es la alerta (hasta ${MAX_PERIODO_PUBLICACION} caracteres).`;
  if (!Array.isArray(reemplazar) || reemplazar.some((id) => !Number.isInteger(id) || id <= 0)) return "Publicaciones a reemplazar inválidas.";
  return errorDeVigencia(vigenteHasta);
}

/**
 * Publica el mapa hasta `vigenteHasta` (se saca solo después). `reemplazar`: ids de
 * publicaciones vigentes que ésta reemplaza (se despublican en la misma transacción),
 * para no duplicar la alerta de hoy cuando se corrige.
 */
async function publicar(zonas, iconos, usuarioId = null, { vigenteHasta, periodo, reemplazar = [] } = {}) {
  await init();
  const p = store.getPool();
  if (p) {
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      if (reemplazar.length) await client.query(`UPDATE alertas_meteo_publicaciones SET vigente_hasta = now() WHERE id = ANY($1::bigint[]) AND vigente_hasta > now()`, [reemplazar]);
      const { rows } = await client.query(
        `INSERT INTO alertas_meteo_publicaciones (usuario_id, vigente_hasta, periodo) VALUES ($1,$2,$3) RETURNING id, publicado_en, vigente_hasta`,
        [usuarioId, vigenteHasta, periodo.trim()]
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
      return { id: Number(id), publicadoEn: publicado_en.toISOString(), vigenteHasta: rows[0].vigente_hasta.toISOString(), periodo: periodo.trim(), zonas, iconos };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  const x = { id: 1, publicadoEn: new Date().toISOString(), vigenteHasta: new Date(vigenteHasta).toISOString(), periodo: periodo.trim(), zonas, iconos };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(x));
  return x;
}

async function actual() {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows: pubs } = await p.query(
      `SELECT id, publicado_en, vigente_hasta, periodo FROM alertas_meteo_publicaciones ORDER BY id DESC LIMIT 1`
    );
    if (!pubs.length) return null;
    return conDetalle(p, pubs[0]);
  }
  if (!fs.existsSync(FILE)) return null;
  const x = JSON.parse(fs.readFileSync(FILE));
  return { ...x, iconos: x.iconos || [] };
}

/** Zonas e íconos de una publicación. */
async function conDetalle(p, { id, publicado_en, vigente_hasta, periodo }) {
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
    return { id: Number(id), publicadoEn: publicado_en.toISOString(), vigenteHasta: vigente_hasta ? vigente_hasta.toISOString() : null, periodo: periodo || null,
      zonas, iconos: iconos.map(({ categoria2, ...i }) => (categoria2 ? { ...i, categoria2 } : i)) };
}

/** Las publicaciones que se ven ahora en el embebido (más vieja primero). */
async function vigentes() {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(
      `SELECT id, publicado_en, vigente_hasta, periodo FROM alertas_meteo_publicaciones WHERE vigente_hasta > now() ORDER BY publicado_en`
    );
    return Promise.all(rows.map((r) => conDetalle(p, r)));
  }
  const x = await actual();
  return x && Date.parse(x.vigenteHasta) > Date.now() ? [x] : [];
}

/** La saca del embebido antes de que venza. */
async function despublicar(id) {
  await init();
  const p = store.getPool();
  if (!p) { if (fs.existsSync(FILE)) fs.rmSync(FILE); return; }
  const { rowCount } = await p.query(`UPDATE alertas_meteo_publicaciones SET vigente_hasta = now() WHERE id = $1 AND vigente_hasta > now()`, [id]);
  if (!rowCount) throw Object.assign(new Error("La alerta no está publicada."), { status: 404 });
}

module.exports = { init, publicar, actual, vigentes, despublicar, errorDePublicacion, MAX_PERIODO_PUBLICACION };
