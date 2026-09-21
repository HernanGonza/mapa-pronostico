const store = require("./store");
const auth = require("./auth");

/**
 * Registro de lo que se publicó en redes desde el panel: quién, cuándo,
 * dónde y con qué resultado. Sirve para avisar "esta placa ya salió en
 * Instagram" antes de duplicar una publicación. Sin Postgres no se registra
 * nada (y por lo tanto tampoco se avisa de duplicados).
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
      `CREATE TABLE IF NOT EXISTS publicaciones_redes (
         id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         usuario_id  bigint REFERENCES usuarios(id),
         creado_en   timestamptz NOT NULL DEFAULT now(),
         destino     text NOT NULL,
         formato     text NOT NULL,
         placa_url   text NOT NULL,
         epigrafe    text,
         ok          boolean NOT NULL,
         externo_id  text,
         permalink   text,
         error       text
       )`
    )
    .then(() => p.query(`CREATE INDEX IF NOT EXISTS publicaciones_redes_placa_idx ON publicaciones_redes (placa_url)`))
    .then(() => console.log("[redesStore] Postgres listo (tabla publicaciones_redes)"))
    .catch((e) => {
      initPromise = null;
      throw e;
    });
  return initPromise;
}

/** Publicaciones exitosas previas de estas placas (para avisar de duplicados). */
async function exitosasDe(placaUrls) {
  const urls = placaUrls.filter(Boolean);
  if (!store.usaPostgres() || !urls.length) return [];
  await init();
  const { rows } = await store.getPool().query(
    `SELECT r.destino, r.formato, r.placa_url, r.creado_en, r.permalink, u.email AS usuario_email
       FROM publicaciones_redes r
       LEFT JOIN usuarios u ON u.id = r.usuario_id
      WHERE r.ok AND r.placa_url = ANY($1)
      ORDER BY r.creado_en DESC`,
    [urls]
  );
  return rows.map((r) => ({
    destino: r.destino,
    formato: r.formato,
    creadoEn: r.creado_en.toISOString(),
    permalink: r.permalink,
    usuarioEmail: r.usuario_email,
  }));
}

async function registrar({ usuarioId, epigrafe, feedUrl, historiasUrl, resultados }) {
  if (!store.usaPostgres() || !resultados.length) return;
  await init();
  const p = store.getPool();
  for (const r of resultados) {
    await p.query(
      `INSERT INTO publicaciones_redes (usuario_id, destino, formato, placa_url, epigrafe, ok, externo_id, permalink, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [usuarioId, r.destino, r.formato, r.formato === "feed" ? feedUrl : historiasUrl, epigrafe || null, r.ok, r.externoId || null, r.permalink || null, r.error || null]
    );
  }
}

module.exports = { init, exitosasDe, registrar };
