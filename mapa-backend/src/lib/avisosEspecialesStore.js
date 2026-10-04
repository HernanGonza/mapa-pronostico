const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { subirArchivo, urlPublica } = require("./storage");

/**
 * Historial de "avisos especiales" (texto libre + captura de radar/satélite, ver
 * generateAvisoEspecial). Una fila por placa confirmada: quién, cuándo, el texto, la
 * fecha/hora de emisión que figura en la placa y dónde quedaron feed + historias en
 * el bucket. La captura original no se guarda aparte: ya queda dentro de las placas.
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
      `CREATE TABLE IF NOT EXISTS avisos_especiales (
         id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         generado_por   bigint REFERENCES usuarios(id),
         generado_en    timestamptz NOT NULL DEFAULT now(),
         texto          text NOT NULL,
         emitido_en     timestamptz NOT NULL,
         feed_path      text NOT NULL,
         historias_path text NOT NULL
       )`
    )
    // Título de dos líneas y nivel (color de la 2.ª línea), como las placas de las alertas.
    .then(() => p.query(`ALTER TABLE avisos_especiales ADD COLUMN IF NOT EXISTS titulo text`))
    .then(() => p.query(`ALTER TABLE avisos_especiales ADD COLUMN IF NOT EXISTS subtitulo text`))
    .then(() => p.query(`ALTER TABLE avisos_especiales ADD COLUMN IF NOT EXISTS nivel text`))
    .then(() => console.log("[avisosEspecialesStore] Postgres listo (tabla avisos_especiales)"))
    .catch((e) => {
      initPromise = null;
      throw e;
    });
  return initPromise;
}

/** "AAAA-MM-DDTHH:mm" → "AAAA-MM-DD-HHmm", para el nombre de los archivos. */
const sello = (emitidoEn) => emitidoEn.replace("T", "-").replace(":", "");

async function crear({ texto, emitidoEn, titulo = null, subtitulo = null, nivel = null, usuarioId = null, feedPng, historiasPng }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const base = `avisos-especiales/${stamp}-${crypto.randomBytes(3).toString("hex")}`;
  const nombres = { feedNombre: `aviso-especial-feed-${sello(emitidoEn)}.png`, historiasNombre: `aviso-especial-historias-${sello(emitidoEn)}.png` };
  const feedPath = `${base}/${nombres.feedNombre}`;
  const historiasPath = `${base}/${nombres.historiasNombre}`;
  await Promise.all([subirArchivo(feedPath, feedPng), subirArchivo(historiasPath, historiasPng)]);
  const urls = { feedUrl: urlPublica(feedPath), historiasUrl: urlPublica(historiasPath) };

  await init();
  const p = store.getPool();
  if (!p) return { id: null, ...nombres, generadoEn: new Date().toISOString(), ...urls };
  // emitidoEn es hora de Misiones (sin horario de verano: siempre -03:00).
  const { rows } = await p.query(
    `INSERT INTO avisos_especiales (generado_por, texto, emitido_en, feed_path, historias_path, titulo, subtitulo, nivel)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, generado_en`,
    [usuarioId, texto, `${emitidoEn}:00-03:00`, feedPath, historiasPath, titulo, subtitulo || null, nivel || null]
  );
  return { id: Number(rows[0].id), ...nombres, generadoEn: rows[0].generado_en.toISOString(), ...urls };
}

async function obtenerHistorial(limite = 20) {
  if (!store.usaPostgres()) return [];
  await init();
  const { rows } = await store.getPool().query(
    `SELECT a.id, a.generado_en, a.texto, a.emitido_en, a.feed_path, a.historias_path, u.email AS generado_por_email
       FROM avisos_especiales a
       LEFT JOIN usuarios u ON u.id = a.generado_por
      ORDER BY a.generado_en DESC
      LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    generadoEn: r.generado_en.toISOString(),
    texto: r.texto,
    emitidoEn: r.emitido_en.toISOString(),
    generadoPorEmail: r.generado_por_email,
    feedUrl: urlPublica(r.feed_path),
    historiasUrl: urlPublica(r.historias_path),
  }));
}

module.exports = { init, crear, obtenerHistorial };
