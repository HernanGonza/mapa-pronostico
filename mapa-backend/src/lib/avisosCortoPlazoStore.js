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
    // Hasta cuándo se muestra en el mapa público: pasada esa hora se
    // despublica solo. Despublicar a mano = poner vigente_hasta en now().
    .then(() => p.query(`ALTER TABLE avisos_corto_plazo ADD COLUMN IF NOT EXISTS vigente_hasta timestamptz`))
    // De qué aviso del SMN salió (id del CAP + info + zona); NULL si se dibujó a
    // mano. Sirve para marcar en el panel cuáles avisos del SMN ya están publicados.
    .then(() => p.query(`ALTER TABLE avisos_corto_plazo ADD COLUMN IF NOT EXISTS smn_id text`))
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

async function crear({ poligono, titulo, texto, fondo, smnId = null, usuarioId = null, feedPng, historiasPng }) {
  const base = baseRuta();
  const nombres = nombresArchivos(fondo);
  const feedPath = `${base}/${nombres.feedNombre}`;
  const historiasPath = `${base}/${nombres.historiasNombre}`;
  await Promise.all([subirArchivo(feedPath, feedPng), subirArchivo(historiasPath, historiasPng)]);

  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(
      `INSERT INTO avisos_corto_plazo (generado_por, titulo, texto, fondo, poligono, feed_path, historias_path, smn_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
       RETURNING id, generado_en`,
      [usuarioId, titulo, texto, fondo, JSON.stringify(poligono), feedPath, historiasPath, smnId]
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
    `SELECT a.id, a.generado_en, a.publicado_en, a.vigente_hasta, a.titulo, a.texto, a.fondo, a.poligono, a.feed_path, a.historias_path, a.smn_id,
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
    vigenteHasta: r.vigente_hasta ? r.vigente_hasta.toISOString() : null,
    titulo: r.titulo,
    texto: r.texto,
    fondo: r.fondo,
    poligono: r.poligono,
    smnId: r.smn_id ?? null,
    generadoPorEmail: r.generado_por_email,
    feedUrl: urlPublica(r.feed_path),
    historiasUrl: urlPublica(r.historias_path),
  };
}

const MAX_VIGENCIA_HORAS = 72;

/** Error de la vigencia pedida (ISO), o null si sirve: tiene que ser futura y razonable. */
function errorDeVigencia(vigenteHasta) {
  const t = Date.parse(vigenteHasta);
  if (typeof vigenteHasta !== "string" || Number.isNaN(t)) return "Elegí hasta cuándo está vigente el aviso.";
  if (t <= Date.now()) return "La vigencia tiene que ser una fecha y hora futura.";
  if (t > Date.now() + MAX_VIGENCIA_HORAS * 3600 * 1000) return `La vigencia no puede superar las ${MAX_VIGENCIA_HORAS} horas.`;
  return null;
}

/** Publica el aviso en el mapa público hasta `vigenteHasta`; pasada esa hora
 * deja de mostrarse solo. Puede haber varios vigentes a la vez (distintas
 * zonas del SMN). Republicar uno ya publicado le cambia la vigencia. */
async function publicar(id, vigenteHasta) {
  const error = errorDeVigencia(vigenteHasta);
  if (error) throw Object.assign(new Error(error), { status: 400 });
  await init();
  const p = store.getPool();
  if (!p) throw Object.assign(new Error("No hay base de datos disponible para publicar."), { status: 503 });
  const { rows } = await p.query(
    `UPDATE avisos_corto_plazo SET publicado_en = now(), vigente_hasta = $2 WHERE id = $1
       RETURNING id, generado_en, publicado_en, vigente_hasta, titulo, texto, fondo, poligono, feed_path, historias_path, smn_id,
         (SELECT email FROM usuarios WHERE id = generado_por) AS generado_por_email`,
    [id, new Date(vigenteHasta)]
  );
  if (!rows.length) throw Object.assign(new Error("No existe ese aviso."), { status: 404 });
  return filaAAviso(rows[0]);
}

/** Lo saca del mapa público ya, sin esperar a que venza. */
async function despublicar(id) {
  await init();
  const p = store.getPool();
  if (!p) throw Object.assign(new Error("No hay base de datos disponible."), { status: 503 });
  const { rowCount } = await p.query(
    `UPDATE avisos_corto_plazo SET vigente_hasta = now() WHERE id = $1 AND vigente_hasta > now()`,
    [id]
  );
  if (!rowCount) throw Object.assign(new Error("Ese aviso no está vigente."), { status: 404 });
}

/** Avisos publicados y todavía vigentes, el más reciente primero ([] si no hay).
 * Los publicados antes de existir la vigencia (vigente_hasta NULL) no cuentan. */
async function obtenerVigentes() {
  if (!store.usaPostgres()) return [];
  await init();
  const p = store.getPool();
  const { rows } = await p.query(
    `SELECT a.id, a.generado_en, a.publicado_en, a.vigente_hasta, a.titulo, a.texto, a.fondo, a.poligono, a.feed_path, a.historias_path, a.smn_id,
            u.email AS generado_por_email
       FROM avisos_corto_plazo a
       LEFT JOIN usuarios u ON u.id = a.generado_por
      WHERE a.publicado_en IS NOT NULL AND a.vigente_hasta > now()
      ORDER BY a.publicado_en DESC`
  );
  return rows.map(filaAAviso);
}

module.exports = { init, crear, obtenerHistorial, publicar, despublicar, obtenerVigentes, errorDeVigencia, MAX_VIGENCIA_HORAS };
