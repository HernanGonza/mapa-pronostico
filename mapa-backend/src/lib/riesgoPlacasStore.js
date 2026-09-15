const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { subirArchivo, urlPublica } = require("./storage");

/** Historial de placas feed+historias del riesgo de incendios — mismo
 * patrón que pronosticoPlacasStore.js. */

let initPromise;

async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  await auth.init();
  const p = store.getPool();
  initPromise = p
    .query(
      `CREATE TABLE IF NOT EXISTS riesgo_placas (
         id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         generado_por   bigint REFERENCES usuarios(id),
         generado_en    timestamptz NOT NULL DEFAULT now(),
         fecha          date NOT NULL,
         feed_path      text NOT NULL,
         historias_path text NOT NULL
       )`
    )
    .then(() => console.log("[riesgoPlacasStore] Postgres listo (tabla riesgo_placas)"))
    .catch((e) => {
      initPromise = null;
      throw e;
    });
  return initPromise;
}

function baseRuta() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `placas/${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

function nombresArchivos(fecha) {
  return {
    feedNombre: `riesgo-incendios-feed-${fecha}.png`,
    historiasNombre: `riesgo-incendios-historias-${fecha}.png`,
  };
}

async function crear({ fecha, usuarioId = null, feedPng, historiasPng }) {
  const base = baseRuta();
  const nombres = nombresArchivos(fecha);
  const feedPath = `${base}/${nombres.feedNombre}`;
  const historiasPath = `${base}/${nombres.historiasNombre}`;
  await Promise.all([subirArchivo(feedPath, feedPng), subirArchivo(historiasPath, historiasPng)]);

  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(
      `INSERT INTO riesgo_placas (generado_por, fecha, feed_path, historias_path)
       VALUES ($1,$2,$3,$4)
       RETURNING id, generado_en`,
      [usuarioId, fecha, feedPath, historiasPath]
    );
    return { id: Number(rows[0].id), ...nombres, generadoEn: rows[0].generado_en.toISOString(), feedUrl: urlPublica(feedPath), historiasUrl: urlPublica(historiasPath) };
  }
  return { id: null, ...nombres, generadoEn: new Date().toISOString(), feedUrl: urlPublica(feedPath), historiasUrl: urlPublica(historiasPath) };
}

module.exports = { init, crear };
