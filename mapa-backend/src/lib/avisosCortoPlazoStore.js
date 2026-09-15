const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { subirArchivo, urlPublica } = require("./storage");

/**
 * Historial de "avisos a muy corto plazo": el operador dibuja un polígono
 * de referencia sobre el mapa (no se publica en ningún lado, es sólo para
 * escribir el texto con precisión) y genera una placa de texto libre con
 * el mismo motor que "Recomendaciones" de alertas meteorológicas
 * (generateAlertaMap.generateRecomendaciones). A diferencia de esa,
 * ACÁ SÍ se guarda todo en la base (polígono incluido) — a pedido:
 * "se tiene que guardar toda la info en la db".
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
      `CREATE TABLE IF NOT EXISTS avisos_corto_plazo (
         id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         generado_por   bigint REFERENCES usuarios(id),
         generado_en    timestamptz NOT NULL DEFAULT now(),
         titulo         text NOT NULL,
         texto          text NOT NULL,
         fondo          text NOT NULL,
         poligono       jsonb NOT NULL,
         feed_path      text NOT NULL,
         historias_path text NOT NULL
       )`
    )
    .then(() => console.log("[avisosCortoPlazoStore] Postgres listo (tabla avisos_corto_plazo)"))
    .catch((e) => {
      initPromise = null;
      throw e;
    });
  return initPromise;
}

function baseRuta() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `avisos-corto-plazo/${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

function nombresArchivos(fondo) {
  const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return {
    feedNombre: `aviso-corto-plazo-feed-${fondo}-${fecha}.png`,
    historiasNombre: `aviso-corto-plazo-historias-${fondo}-${fecha}.png`,
  };
}

async function crear({ poligono, titulo, texto, fondo, usuarioId = null, feedPng, historiasPng }) {
  const base = baseRuta();
  const nombres = nombresArchivos(fondo);
  const feedPath = `${base}/${nombres.feedNombre}`;
  const historiasPath = `${base}/${nombres.historiasNombre}`;
  await Promise.all([subirArchivo(feedPath, feedPng), subirArchivo(historiasPath, historiasPng)]);

  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(
      `INSERT INTO avisos_corto_plazo (generado_por, titulo, texto, fondo, poligono, feed_path, historias_path)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
       RETURNING id, generado_en`,
      [usuarioId, titulo, texto, fondo, JSON.stringify(poligono), feedPath, historiasPath]
    );
    return {
      id: Number(rows[0].id),
      ...nombres,
      generadoEn: rows[0].generado_en.toISOString(),
      feedUrl: urlPublica(feedPath),
      historiasUrl: urlPublica(historiasPath),
    };
  }
  return {
    id: null,
    ...nombres,
    generadoEn: new Date().toISOString(),
    feedUrl: urlPublica(feedPath),
    historiasUrl: urlPublica(historiasPath),
  };
}

async function obtenerHistorial(limite = 20) {
  if (!store.usaPostgres()) return [];
  await init();
  const p = store.getPool();
  const { rows } = await p.query(
    `SELECT a.id, a.generado_en, a.titulo, a.texto, a.fondo, a.poligono, a.feed_path, a.historias_path,
            u.email AS generado_por_email
       FROM avisos_corto_plazo a
       LEFT JOIN usuarios u ON u.id = a.generado_por
      ORDER BY a.generado_en DESC
      LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    generadoEn: r.generado_en.toISOString(),
    titulo: r.titulo,
    texto: r.texto,
    fondo: r.fondo,
    poligono: r.poligono,
    generadoPorEmail: r.generado_por_email,
    feedUrl: urlPublica(r.feed_path),
    historiasUrl: urlPublica(r.historias_path),
  }));
}

module.exports = { init, crear, obtenerHistorial };
