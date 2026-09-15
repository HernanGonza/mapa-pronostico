const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { subirArchivo, urlPublica } = require("./storage");

/**
 * Historial de placas feed+historias del pronóstico del tiempo — mismo
 * patrón que placasMeteoStore.js (alertas meteorológicas), pero sin
 * zonas/iconos: acá el "contenido" es directamente el mapa de pronóstico
 * ya publicado, no hace falta guardar un snapshot aparte.
 */

let initPromise;

async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  await auth.init();
  const p = store.getPool();
  initPromise = p
    .query(
      `CREATE TABLE IF NOT EXISTS pronostico_placas (
         id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         generado_por      bigint REFERENCES usuarios(id),
         generado_en       timestamptz NOT NULL DEFAULT now(),
         fecha_pronostico  date,
         feed_path         text NOT NULL,
         historias_path    text NOT NULL
       )`
    )
    .then(() => console.log("[pronosticoPlacasStore] Postgres listo (tabla pronostico_placas)"))
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
    feedNombre: `pronostico-feed-${fecha || "sf"}.png`,
    historiasNombre: `pronostico-historias-${fecha || "sf"}.png`,
  };
}

async function crear({ fechaPronostico = null, usuarioId = null, feedPng, historiasPng }) {
  const base = baseRuta();
  const nombres = nombresArchivos(fechaPronostico);
  const feedPath = `${base}/${nombres.feedNombre}`;
  const historiasPath = `${base}/${nombres.historiasNombre}`;
  await Promise.all([subirArchivo(feedPath, feedPng), subirArchivo(historiasPath, historiasPng)]);

  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(
      `INSERT INTO pronostico_placas (generado_por, fecha_pronostico, feed_path, historias_path)
       VALUES ($1,$2,$3,$4)
       RETURNING id, generado_en`,
      [usuarioId, fechaPronostico || null, feedPath, historiasPath]
    );
    return { id: Number(rows[0].id), ...nombres, generadoEn: rows[0].generado_en.toISOString(), feedUrl: urlPublica(feedPath), historiasUrl: urlPublica(historiasPath) };
  }
  return { id: null, ...nombres, generadoEn: new Date().toISOString(), feedUrl: urlPublica(feedPath), historiasUrl: urlPublica(historiasPath) };
}

module.exports = { init, crear };
