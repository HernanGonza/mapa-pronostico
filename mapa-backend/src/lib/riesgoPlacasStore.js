const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { subirArchivo, urlPublica } = require("./storage");

/** Historial de placas del riesgo de incendios — mismo patrón que
 * pronosticoPlacasStore.js, pero sólo historias (feed_path queda NULL;
 * las filas viejas conservan su feed). */

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
    .then(() => p.query(`ALTER TABLE riesgo_placas ALTER COLUMN feed_path DROP NOT NULL`))
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

async function crear({ fecha, usuarioId = null, historiasPng }) {
  const nombres = { feedNombre: null, historiasNombre: `riesgo-incendios-historias-${fecha}.png` };
  const historiasPath = `${baseRuta()}/${nombres.historiasNombre}`;
  await subirArchivo(historiasPath, historiasPng);

  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(
      `INSERT INTO riesgo_placas (generado_por, fecha, feed_path, historias_path)
       VALUES ($1,$2,$3,$4)
       RETURNING id, generado_en`,
      [usuarioId, fecha, null, historiasPath]
    );
    return { id: Number(rows[0].id), ...nombres, generadoEn: rows[0].generado_en.toISOString(), feedUrl: null, historiasUrl: urlPublica(historiasPath) };
  }
  return { id: null, ...nombres, generadoEn: new Date().toISOString(), feedUrl: null, historiasUrl: urlPublica(historiasPath) };
}

module.exports = { init, crear };
