const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { subirArchivo, urlPublica } = require("./storage");

/**
 * Placas que acompañan a una alerta publicada: la del mapa («Crear placa para redes», tipo
 * 'mapa', ver generateAlertaMap) y las de actualización de vigencia, recomendaciones, aviso de
 * alerta y actualización de nivel (ver generatePlacasAlerta). Una fila por placa
 * confirmada, colgada de su publicación: así cada tarjeta de la pila del panel
 * muestra las suyas. `datos` guarda con qué se armó (zonas, textos, íconos), para
 * que la próxima arranque de ahí. Sin Postgres no se guarda nada (sólo el bucket).
 */

let initPromise;

async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  await auth.init();
  await require("./alertasMeteorologicasStore").init(); // la tabla de publicaciones tiene que existir antes
  const p = store.getPool();
  initPromise = p
    .query(
      `CREATE TABLE IF NOT EXISTS alertas_meteo_publicacion_placas (
         id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         publicacion_id bigint NOT NULL REFERENCES alertas_meteo_publicaciones(id),
         tipo           text NOT NULL,
         nivel          text NOT NULL,
         datos          jsonb NOT NULL,
         generado_por   bigint REFERENCES usuarios(id),
         generado_en    timestamptz NOT NULL DEFAULT now(),
         feed_path      text NOT NULL,
         historias_path text NOT NULL
       );
       CREATE INDEX IF NOT EXISTS alertas_meteo_publicacion_placas_pub_idx ON alertas_meteo_publicacion_placas (publicacion_id);
       -- Eliminar desde el panel no borra la fila (queda para el histórico): sólo deja de mostrarse.
       ALTER TABLE alertas_meteo_publicacion_placas ADD COLUMN IF NOT EXISTS eliminada_en timestamptz;
       -- Editar reemplaza las imágenes: las de antes quedan acá ([{ feed_path, historias_path, hasta }]),
       -- para seguir sabiendo si alguna versión ya salió en redes.
       ALTER TABLE alertas_meteo_publicacion_placas ADD COLUMN IF NOT EXISTS versiones_anteriores jsonb NOT NULL DEFAULT '[]'::jsonb;
       ALTER TABLE alertas_meteo_publicacion_placas ADD COLUMN IF NOT EXISTS editado_en timestamptz;
       ALTER TABLE alertas_meteo_publicacion_placas ADD COLUMN IF NOT EXISTS eliminada_por bigint REFERENCES usuarios(id)`
    )
    .then(() => console.log("[placasAlertaStore] Postgres listo (tabla alertas_meteo_publicacion_placas)"))
    .catch((e) => {
      initPromise = null;
      throw e;
    });
  return initPromise;
}

const NOMBRE = { vigencia: "actualizacion-vigencia", recomendaciones: "recomendaciones", aviso: "aviso-de-alerta", nivel: "actualizacion-nivel", mapa: "mapa-alerta" };

function filaAPlaca(r, redes = []) {
  const actuales = new Set([urlPublica(r.feed_path), urlPublica(r.historias_path)]);
  return {
    id: Number(r.id),
    publicacionId: Number(r.publicacion_id),
    tipo: r.tipo,
    nivel: r.nivel,
    datos: r.datos,
    generadoEn: r.generado_en.toISOString(),
    generadoPorEmail: r.generado_por_email ?? null,
    feedUrl: urlPublica(r.feed_path),
    historiasUrl: urlPublica(r.historias_path),
    feedNombre: r.feed_path.split("/").pop(),
    historiasNombre: r.historias_path.split("/").pop(),
    editadoEn: r.editado_en ? r.editado_en.toISOString() : null,
    // Dónde salió en redes: la versión que se ve ahora y, si se editó, las de antes.
    redes: redes.map(({ placaUrl, ...x }) => ({ ...x, version: actuales.has(placaUrl) ? "actual" : "anterior" })),
  };
}

/** Rutas de la placa en el bucket, con el nombre que se descarga. */
function rutas(tipo) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const base = `alertas-meteorologicas/placas/${stamp}-${crypto.randomBytes(3).toString("hex")}`;
  const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  return { feedPath: `${base}/${NOMBRE[tipo]}-feed-${fecha}.png`, historiasPath: `${base}/${NOMBRE[tipo]}-historias-${fecha}.png` };
}

async function crear({ publicacionId, tipo, nivel, datos, usuarioId = null, feedPng, historiasPng }) {
  const { feedPath, historiasPath } = rutas(tipo);
  await Promise.all([subirArchivo(feedPath, feedPng), subirArchivo(historiasPath, historiasPng)]);
  await init();
  const p = store.getPool();
  if (!p) return filaAPlaca({ id: 0, publicacion_id: publicacionId, tipo, nivel, datos, generado_en: new Date(), feed_path: feedPath, historias_path: historiasPath });
  const { rows } = await p.query(
    `INSERT INTO alertas_meteo_publicacion_placas (publicacion_id, tipo, nivel, datos, generado_por, feed_path, historias_path)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) RETURNING *`,
    [publicacionId, tipo, nivel, JSON.stringify(datos), usuarioId, feedPath, historiasPath]
  );
  await evento(p, rows[0], "placa_generada", usuarioId);
  return filaAPlaca(rows[0]);
}

/**
 * Edita una placa: imágenes nuevas (las de antes quedan en versiones_anteriores), mismos tipo y
 * alerta. Error 404 si no existe, es de otra alerta, de otro tipo o ya se eliminó.
 */
async function reemplazar({ id, publicacionId, tipo, nivel, datos, usuarioId = null, feedPng, historiasPng }) {
  await init();
  const p = store.getPool();
  if (!p) throw Object.assign(new Error("No hay base de datos disponible."), { status: 503 });
  const { rows: antes } = await p.query(
    `SELECT 1 FROM alertas_meteo_publicacion_placas WHERE id = $1 AND publicacion_id = $2 AND tipo = $3 AND eliminada_en IS NULL`, [id, publicacionId, tipo]);
  if (!antes.length) throw Object.assign(new Error("Esa placa ya no está."), { status: 404 });
  const { feedPath, historiasPath } = rutas(tipo);
  await Promise.all([subirArchivo(feedPath, feedPng), subirArchivo(historiasPath, historiasPng)]);
  const { rows } = await p.query(
    `UPDATE alertas_meteo_publicacion_placas
        SET versiones_anteriores = versiones_anteriores || jsonb_build_array(jsonb_build_object('feed_path', feed_path, 'historias_path', historias_path, 'hasta', now())),
            nivel = $2, datos = $3::jsonb, feed_path = $4, historias_path = $5, editado_en = now(), generado_por = COALESCE($6, generado_por)
      WHERE id = $1 AND eliminada_en IS NULL
      RETURNING *`,
    [id, nivel, JSON.stringify(datos), feedPath, historiasPath, usuarioId]
  );
  if (!rows.length) throw Object.assign(new Error("Esa placa ya no está."), { status: 404 });
  await evento(p, rows[0], "placa_editada", usuarioId);
  return filaAPlaca(rows[0]);
}

/** Historial de la alerta (ver alertasMeteorologicasStore.registrarEvento). Un fallo acá no frena la placa. */
const evento = (db, r, nombre, usuarioId) => require("./alertasMeteorologicasStore")
  .registrarEvento(db, { publicacionId: r.publicacion_id, evento: nombre, usuarioId, detalle: { placaId: Number(r.id), tipo: r.tipo, nivel: r.nivel } })
  .catch((e) => console.error("[placasAlertaStore] evento:", e.message));

/** La saca de la tarjeta (queda en la base, para el histórico). */
async function eliminar(id, usuarioId = null) {
  await init();
  const p = store.getPool();
  if (!p) throw Object.assign(new Error("No hay base de datos disponible."), { status: 503 });
  const { rows } = await p.query(`UPDATE alertas_meteo_publicacion_placas SET eliminada_en = now(), eliminada_por = $2 WHERE id = $1 AND eliminada_en IS NULL RETURNING *`, [id, usuarioId]);
  if (!rows.length) throw Object.assign(new Error("Esa placa ya no está."), { status: 404 });
  await evento(p, rows[0], "placa_eliminada", usuarioId);
}

/** Placas de estas publicaciones, la más nueva primero, con dónde salieron en redes: { [publicacionId]: [placa…] }. */
async function dePublicaciones(ids) {
  const porId = Object.fromEntries(ids.map((id) => [id, []]));
  if (!store.usaPostgres() || !ids.length) return porId;
  await init();
  const { rows } = await store.getPool().query(
    `SELECT x.*, u.email AS generado_por_email
       FROM alertas_meteo_publicacion_placas x
       LEFT JOIN usuarios u ON u.id = x.generado_por
      WHERE x.publicacion_id = ANY($1::bigint[]) AND x.eliminada_en IS NULL
      ORDER BY x.generado_en DESC`,
    [ids]
  );
  // Publicaciones en redes de cualquier versión (la actual y las anteriores) de estas placas.
  const urlsDe = (r) => [r.feed_path, r.historias_path, ...(r.versiones_anteriores || []).flatMap((v) => [v.feed_path, v.historias_path])].map(urlPublica);
  const exitosas = await require("./redesStore").exitosasDe(rows.flatMap(urlsDe)).catch((e) => { console.error("[placasAlertaStore] redes:", e.message); return []; });
  for (const r of rows) {
    const mias = new Set(urlsDe(r));
    porId[Number(r.publicacion_id)]?.push(filaAPlaca(r, exitosas.filter((x) => mias.has(x.placaUrl))));
  }
  return porId;
}

/** Lo último que se usó de cada tipo (de cualquier alerta), para arrancar la próxima placa de ahí. */
async function ultimosDatos() {
  if (!store.usaPostgres()) return {};
  await init();
  const { rows } = await store.getPool().query(
    `SELECT DISTINCT ON (tipo) tipo, datos FROM alertas_meteo_publicacion_placas WHERE eliminada_en IS NULL ORDER BY tipo, COALESCE(editado_en, generado_en) DESC`
  );
  return Object.fromEntries(rows.map((r) => [r.tipo, r.datos]));
}

module.exports = { init, crear, reemplazar, eliminar, dePublicaciones, ultimosDatos };
