const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { subirArchivo, borrarArchivos, urlPublica } = require("./storage");

/**
 * Historial de las placas «Monitoreo de precipitaciones» (ver generatePlacaPrecipitaciones). Una fila por placa
 * confirmada: quién, cuándo, el período, la 2.ª línea del título, los datos de cada estación (para poder
 * reabrirla) y dónde quedaron feed + historias en el bucket.
 */
let initPromise;

async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  await auth.init();
  initPromise = store.getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS placas_precipitaciones (
         id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         generado_por   bigint REFERENCES usuarios(id),
         generado_en    timestamptz NOT NULL DEFAULT now(),
         subtitulo      text NOT NULL,
         periodo        text NOT NULL,
         fondo          integer NOT NULL,
         filas          jsonb NOT NULL,
         feed_path      text NOT NULL,
         historias_path text NOT NULL
       )`
    )
    .then(() => console.log("[placasPrecipitacionesStore] Postgres listo (tabla placas_precipitaciones)"))
    .catch((e) => { initPromise = null; throw e; });
  return initPromise;
}

const limpio = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

async function crear({ subtitulo, periodo, fondo, filas, usuarioId = null, feedPng, historiasPng }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const base = `precipitaciones/${stamp}-${crypto.randomBytes(3).toString("hex")}`;
  const nombres = { feedNombre: `precipitaciones-feed-${limpio(periodo)}.png`, historiasNombre: `precipitaciones-historias-${limpio(periodo)}.png` };
  const feedPath = `${base}/${nombres.feedNombre}`, historiasPath = `${base}/${nombres.historiasNombre}`;
  await Promise.all([subirArchivo(feedPath, feedPng), subirArchivo(historiasPath, historiasPng)]);
  const urls = { feedUrl: urlPublica(feedPath), historiasUrl: urlPublica(historiasPath) };
  await init();
  const p = store.getPool();
  if (!p) return { id: null, ...nombres, generadoEn: new Date().toISOString(), ...urls };
  const { rows } = await p.query(
    `INSERT INTO placas_precipitaciones (generado_por, subtitulo, periodo, fondo, filas, feed_path, historias_path)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, generado_en`,
    [usuarioId, subtitulo, periodo, fondo, JSON.stringify(filas), feedPath, historiasPath]
  );
  return { id: Number(rows[0].id), ...nombres, generadoEn: rows[0].generado_en.toISOString(), ...urls };
}

async function obtenerHistorial(limite = 20) {
  if (!store.usaPostgres()) return [];
  await init();
  const { rows } = await store.getPool().query(
    `SELECT a.id, a.generado_en, a.subtitulo, a.periodo, a.fondo, a.filas, a.feed_path, a.historias_path, u.email AS generado_por_email
       FROM placas_precipitaciones a LEFT JOIN usuarios u ON u.id = a.generado_por
      ORDER BY a.generado_en DESC LIMIT $1`, [limite]);
  return rows.map((r) => ({ id: Number(r.id), generadoEn: r.generado_en.toISOString(), subtitulo: r.subtitulo, periodo: r.periodo, fondo: r.fondo, filas: r.filas, generadoPorEmail: r.generado_por_email, feedUrl: urlPublica(r.feed_path), historiasUrl: urlPublica(r.historias_path) }));
}

/** Borra la placa del todo: la fila y sus dos imágenes del bucket. Devuelve false si ya no existía. */
async function eliminar(id) {
  if (!store.usaPostgres()) return false;
  await init();
  const { rows } = await store.getPool().query("DELETE FROM placas_precipitaciones WHERE id = $1 RETURNING feed_path, historias_path", [id]);
  if (!rows.length) return false;
  await borrarArchivos([rows[0].feed_path, rows[0].historias_path]).catch((e) => console.error("[placasPrecipitacionesStore] no se pudieron borrar las imágenes:", e.message));
  return true;
}

module.exports = { init, crear, obtenerHistorial, eliminar };
