const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { subirArchivo, urlPublica } = require("./storage");

/**
 * Alertas del SMN (SAT) que el operador eligió publicar en el embebido de
 * alertas meteorológicas, una fila por alerta. Se guarda una copia completa
 * (título, nivel, período, descripción, zonas con su polígono): el SMN la
 * reemplaza en el informe siguiente y lo publicado tiene que seguir igual.
 * Se ve hasta `vigente_hasta` (el fin de la alerta del SMN); despublicar =
 * `vigente_hasta = now()`. Mismo esquema que los avisos a muy corto plazo.
 *
 * Cuando el SMN actualiza una publicada y alguien aplica la actualización (ver
 * alertasSmnAuto), se pisa `datos` en la misma fila y queda anotado en `cambios`.
 * Las placas que se generan de cada alerta van en alertas_smn_placas.
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
      `CREATE TABLE IF NOT EXISTS alertas_smn_publicadas (
         id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         smn_id        text NOT NULL,
         publicado_por bigint REFERENCES usuarios(id),
         publicado_en  timestamptz NOT NULL DEFAULT now(),
         vigente_hasta timestamptz NOT NULL,
         datos         jsonb NOT NULL
       )`
    )
    .then(() => p.query(`CREATE INDEX IF NOT EXISTS alertas_smn_publicadas_vigente_idx ON alertas_smn_publicadas (vigente_hasta)`))
    .then(() => p.query(`ALTER TABLE alertas_smn_publicadas ADD COLUMN IF NOT EXISTS actualizada_en timestamptz`))
    .then(() => p.query(`ALTER TABLE alertas_smn_publicadas ADD COLUMN IF NOT EXISTS cambios jsonb NOT NULL DEFAULT '[]'::jsonb`))
    .then(() => p.query(
      `CREATE TABLE IF NOT EXISTS alertas_smn_placas (
         id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         alerta_id      bigint NOT NULL REFERENCES alertas_smn_publicadas(id),
         tipo           text NOT NULL,
         motivo         text NOT NULL,
         nivel          text NOT NULL,
         datos          jsonb NOT NULL,
         generado_en    timestamptz NOT NULL DEFAULT now(),
         feed_path      text NOT NULL,
         historias_path text NOT NULL
       )`))
    .then(() => p.query(`CREATE INDEX IF NOT EXISTS alertas_smn_placas_alerta_idx ON alertas_smn_placas (alerta_id)`))
    // Igual que las placas de las alertas manuales: editar reemplaza las imágenes (las de antes quedan para saber si salieron en redes) y eliminar no borra la fila.
    .then(() => p.query(`ALTER TABLE alertas_smn_placas ADD COLUMN IF NOT EXISTS eliminada_en timestamptz`))
    .then(() => p.query(`ALTER TABLE alertas_smn_placas ADD COLUMN IF NOT EXISTS editado_en timestamptz`))
    .then(() => p.query(`ALTER TABLE alertas_smn_placas ADD COLUMN IF NOT EXISTS generado_por bigint REFERENCES usuarios(id)`))
    .then(() => p.query(`ALTER TABLE alertas_smn_placas ADD COLUMN IF NOT EXISTS versiones_anteriores jsonb NOT NULL DEFAULT '[]'::jsonb`))
    .then(() => console.log("[alertasSmnPublicadasStore] Postgres listo (tabla alertas_smn_publicadas)"))
    .catch((e) => {
      initPromise = null;
      throw e;
    });
  return initPromise;
}

function sinBase() {
  return Object.assign(new Error("Publicar alertas del SMN necesita la base de datos."), { status: 503 });
}

const fila = (r) => ({
  id: Number(r.id),
  smnId: r.smn_id,
  publicadoEn: r.publicado_en.toISOString(),
  vigenteHasta: r.vigente_hasta.toISOString(),
  publicadoPorEmail: r.publicado_por_email || null,
  actualizadaEn: r.actualizada_en ? r.actualizada_en.toISOString() : null,
  cambios: r.cambios || [],
  ...r.datos,
});

/** Lo que se guarda de una alerta del SMN: sólo lo que muestra el embebido. */
function copiaDe(alerta, info, colores = {}) {
  return {
    titulo: info.titulo,
    evento: info.evento || info.titulo,
    categoria: info.categoria,
    color: colores[info.categoria] || null,
    descripcion: info.descripcion,
    instrucciones: info.instrucciones,
    inicio: info.inicio,
    fin: info.fin,
    emitidoEn: alerta.emitidoEn,
    url: alerta.url || null,
    zonas: (info.zonas || []).map((z) => ({ nombre: z.nombre, departamentos: z.departamentos || [], geometry: z.geometry || null })),
  };
}

/**
 * Publica la alerta `smnId` ("<id del CAP>:<índice del info>") tomada de las
 * alertas SAT vigentes (`alertas`, lo mismo que ve el panel). Si ya está
 * publicada y vigente, devuelve esa misma (no la duplica). `colores`: nivel → color
 * del SMN, se guarda con la copia para que el embebido la pinte igual que el panel.
 */
async function publicar(smnId, alertas, usuarioId = null, colores = {}) {
  if (!store.usaPostgres()) throw sinBase();
  const corte = String(smnId).lastIndexOf(":");
  const alerta = alertas.find((a) => a.id === String(smnId).slice(0, corte));
  const info = alerta?.infos[Number(String(smnId).slice(corte + 1))];
  if (!info) throw Object.assign(new Error("Esa alerta del SMN ya no está vigente. Consultá de nuevo."), { status: 404 });
  if (!info.zonas?.some((z) => z.geometry)) throw Object.assign(new Error("La alerta no trae el área en el mapa: no se puede publicar."), { status: 400 });
  await init();
  const p = store.getPool();
  const { rows: ya } = await p.query(`SELECT * FROM alertas_smn_publicadas WHERE smn_id = $1 AND vigente_hasta > now() ORDER BY id DESC LIMIT 1`, [smnId]);
  if (ya.length) return fila(ya[0]);
  const { rows } = await p.query(
    `INSERT INTO alertas_smn_publicadas (smn_id, publicado_por, vigente_hasta, datos) VALUES ($1,$2,$3,$4::jsonb) RETURNING *`,
    [smnId, usuarioId, info.fin, JSON.stringify(copiaDe(alerta, info, colores))]
  );
  return fila(rows[0]);
}

async function despublicar(id) {
  if (!store.usaPostgres()) throw sinBase();
  await init();
  const { rowCount } = await store.getPool().query(`UPDATE alertas_smn_publicadas SET vigente_hasta = now() WHERE id = $1 AND vigente_hasta > now()`, [id]);
  if (!rowCount) throw Object.assign(new Error("La alerta no está publicada."), { status: 404 });
}

/** Las publicadas y todavía vigentes, por fecha de inicio (lo que muestra el embebido). */
async function obtenerVigentes() {
  if (!store.usaPostgres()) return [];
  await init();
  const { rows } = await store.getPool().query(
    `SELECT a.*, u.email AS publicado_por_email
       FROM alertas_smn_publicadas a LEFT JOIN usuarios u ON u.id = a.publicado_por
      WHERE a.vigente_hasta > now()
      ORDER BY a.datos->>'inicio', a.id`
  );
  return rows.map(fila);
}

/** Las publicadas todavía vigentes, para emparejarlas con lo que trae el SMN (ver alertasSmnAuto). */
async function candidatas() {
  if (!store.usaPostgres()) return [];
  await init();
  const { rows } = await store.getPool().query(`SELECT * FROM alertas_smn_publicadas WHERE vigente_hasta > now() ORDER BY id`);
  return rows.map((r) => ({ ...fila(r), vigente: true }));
}

/** Se aplica una actualización del SMN: se pisan sus datos en la misma fila y se anota qué cambió (`cambio`: null = nada para anotar). */
async function actualizarDatos(id, { smnId, vigenteHasta, datos, cambio = null }) {
  await init();
  const { rows } = await store.getPool().query(
    `UPDATE alertas_smn_publicadas
        SET smn_id = $2, vigente_hasta = $3, datos = $4::jsonb,
            actualizada_en = CASE WHEN $5::jsonb IS NULL THEN actualizada_en ELSE now() END,
            cambios = CASE WHEN $5::jsonb IS NULL THEN cambios ELSE cambios || jsonb_build_array($5::jsonb) END
      WHERE id = $1 RETURNING *`,
    [id, smnId, vigenteHasta, JSON.stringify(datos), cambio ? JSON.stringify(cambio) : null]);
  return rows[0] ? fila(rows[0]) : null;
}

const filaPlaca = (r, redes = []) => {
  const actuales = new Set([urlPublica(r.feed_path), urlPublica(r.historias_path)]);
  return {
    id: Number(r.id), alertaId: Number(r.alerta_id), tipo: r.tipo, motivo: r.motivo, nivel: r.nivel, datos: r.datos,
    generadoEn: r.generado_en.toISOString(), editadoEn: r.editado_en ? r.editado_en.toISOString() : null, generadoPorEmail: r.generado_por_email ?? null,
    feedUrl: urlPublica(r.feed_path), historiasUrl: urlPublica(r.historias_path),
    feedNombre: r.feed_path.split("/").pop(), historiasNombre: r.historias_path.split("/").pop(),
    // Dónde salió en redes: la versión que se ve ahora y, si se editó, las de antes.
    redes: redes.map(({ placaUrl, ...x }) => ({ ...x, version: actuales.has(placaUrl) ? "actual" : "anterior" })),
  };
};

function rutas(tipo) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const base = `alertas-meteorologicas/smn/${stamp}-${crypto.randomBytes(3).toString("hex")}`;
  return { feedPath: `${base}/${tipo}-feed.png`, historiasPath: `${base}/${tipo}-historias.png` };
}

/** Guarda una placa generada de la alerta `alertaId` (sube feed + historias al bucket). */
async function crearPlaca({ alertaId, tipo, motivo = "manual", nivel, datos, usuarioId = null, feedPng, historiasPng }) {
  await init();
  const { feedPath, historiasPath } = rutas(tipo);
  await Promise.all([subirArchivo(feedPath, feedPng), subirArchivo(historiasPath, historiasPng)]);
  const { rows } = await store.getPool().query(
    `INSERT INTO alertas_smn_placas (alerta_id, tipo, motivo, nivel, datos, feed_path, historias_path, generado_por) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`,
    [alertaId, tipo, motivo, nivel, JSON.stringify(datos), feedPath, historiasPath, usuarioId]);
  return filaPlaca(rows[0]);
}

/** Edita una placa: imágenes nuevas (las de antes quedan en versiones_anteriores). 404 si no existe, es de otra alerta o ya se eliminó. */
async function reemplazarPlaca({ id, alertaId, tipo, nivel, datos, usuarioId = null, feedPng, historiasPng }) {
  await init();
  const p = store.getPool();
  const { rows: antes } = await p.query(`SELECT 1 FROM alertas_smn_placas WHERE id = $1 AND alerta_id = $2 AND tipo = $3 AND eliminada_en IS NULL`, [id, alertaId, tipo]);
  if (!antes.length) throw Object.assign(new Error("Esa placa ya no está."), { status: 404 });
  const { feedPath, historiasPath } = rutas(tipo);
  await Promise.all([subirArchivo(feedPath, feedPng), subirArchivo(historiasPath, historiasPng)]);
  const { rows } = await p.query(
    `UPDATE alertas_smn_placas
        SET versiones_anteriores = versiones_anteriores || jsonb_build_array(jsonb_build_object('feed_path', feed_path, 'historias_path', historias_path, 'hasta', now())),
            nivel = $2, datos = $3::jsonb, feed_path = $4, historias_path = $5, editado_en = now(), generado_por = COALESCE($6, generado_por)
      WHERE id = $1 AND eliminada_en IS NULL RETURNING *`,
    [id, nivel, JSON.stringify(datos), feedPath, historiasPath, usuarioId]);
  if (!rows.length) throw Object.assign(new Error("Esa placa ya no está."), { status: 404 });
  return filaPlaca(rows[0]);
}

/** La saca de la tarjeta (queda en la base). No la borra de las redes. */
async function eliminarPlaca(id) {
  await init();
  const { rowCount } = await store.getPool().query(`UPDATE alertas_smn_placas SET eliminada_en = now() WHERE id = $1 AND eliminada_en IS NULL`, [id]);
  if (!rowCount) throw Object.assign(new Error("Esa placa ya no está."), { status: 404 });
}

/** Placas de estas alertas, la más nueva primero, con dónde salieron en redes: { [alertaId]: [placa…] }. */
async function placasDe(ids) {
  const porId = Object.fromEntries(ids.map((id) => [id, []]));
  if (!store.usaPostgres() || !ids.length) return porId;
  await init();
  const { rows } = await store.getPool().query(
    `SELECT x.*, u.email AS generado_por_email FROM alertas_smn_placas x LEFT JOIN usuarios u ON u.id = x.generado_por
      WHERE x.alerta_id = ANY($1::bigint[]) AND x.eliminada_en IS NULL ORDER BY x.generado_en DESC, x.id DESC`, [ids]);
  const urlsDe = (r) => [r.feed_path, r.historias_path, ...(r.versiones_anteriores || []).flatMap((v) => [v.feed_path, v.historias_path])].map(urlPublica);
  const exitosas = await require("./redesStore").exitosasDe(rows.flatMap(urlsDe)).catch((e) => { console.error("[alertasSmnPublicadasStore] redes:", e.message); return []; });
  for (const r of rows) {
    const mias = new Set(urlsDe(r));
    porId[Number(r.alerta_id)]?.push(filaPlaca(r, exitosas.filter((x) => mias.has(x.placaUrl))));
  }
  return porId;
}

module.exports = { init, publicar, despublicar, obtenerVigentes, copiaDe, candidatas, actualizarDatos, crearPlaca, reemplazarPlaca, eliminarPlaca, placasDe };
