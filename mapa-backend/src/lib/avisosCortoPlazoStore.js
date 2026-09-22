const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { subirArchivo, urlPublica } = require("./storage");

/**
 * Historial de "avisos a muy corto plazo": el operador elige un aviso
 * vigente del CAP del SMN (polígono + texto reales) o, si el SMN no trajo
 * polígono para ese aviso, lo dibuja a mano — y genera la placa con
 * generateAvisoCortoPlazoMap (mapa con el polígono + texto del aviso, sin
 * caja). Todo se guarda en la base (polígono incluido) — a pedido: "se
 * tiene que guardar toda la info en la db".
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
    .then(() => p.query(`ALTER TABLE avisos_corto_plazo ADD COLUMN IF NOT EXISTS publicado_en timestamptz`))
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
    `SELECT a.id, a.generado_en, a.publicado_en, a.titulo, a.texto, a.fondo, a.poligono, a.feed_path, a.historias_path,
            u.email AS generado_por_email
       FROM avisos_corto_plazo a
       LEFT JOIN usuarios u ON u.id = a.generado_por
      ORDER BY a.generado_en DESC
      LIMIT $1`,
    [limite]
  );
  return rows.map(filaAAviso);
}

function filaAAviso(r) {
  return {
    id: Number(r.id),
    generadoEn: r.generado_en.toISOString(),
    publicadoEn: r.publicado_en ? r.publicado_en.toISOString() : null,
    titulo: r.titulo,
    texto: r.texto,
    fondo: r.fondo,
    poligono: r.poligono,
    generadoPorEmail: r.generado_por_email,
    feedUrl: urlPublica(r.feed_path),
    historiasUrl: urlPublica(r.historias_path),
  };
}

/** Marca este aviso como el que se muestra en el mapa público/iframe — es
 * el único "publicado" en un momento dado (no hace falta "despublicar" el
 * anterior: `obtenerActual` siempre toma el de `publicado_en` más reciente). */
async function publicar(id) {
  await init();
  const p = store.getPool();
  if (!p) throw Object.assign(new Error("No hay base de datos disponible para publicar."), { status: 503 });
  const { rows } = await p.query(
    `UPDATE avisos_corto_plazo SET publicado_en = now() WHERE id = $1
       RETURNING id, generado_en, publicado_en, titulo, texto, fondo, poligono, feed_path, historias_path,
         (SELECT email FROM usuarios WHERE id = generado_por) AS generado_por_email`,
    [id]
  );
  if (!rows.length) throw Object.assign(new Error("No existe ese aviso."), { status: 404 });
  return filaAAviso(rows[0]);
}

/** El aviso publicado actualmente (`null` si ninguno lo está todavía). */
async function obtenerActual() {
  if (!store.usaPostgres()) return null;
  await init();
  const p = store.getPool();
  const { rows } = await p.query(
    `SELECT a.id, a.generado_en, a.publicado_en, a.titulo, a.texto, a.fondo, a.poligono, a.feed_path, a.historias_path,
            u.email AS generado_por_email
       FROM avisos_corto_plazo a
       LEFT JOIN usuarios u ON u.id = a.generado_por
      WHERE a.publicado_en IS NOT NULL
      ORDER BY a.publicado_en DESC
      LIMIT 1`
  );
  return rows.length ? filaAAviso(rows[0]) : null;
}

module.exports = { init, crear, obtenerHistorial, publicar, obtenerActual };
