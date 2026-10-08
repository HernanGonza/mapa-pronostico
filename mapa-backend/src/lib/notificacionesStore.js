const store = require("./store");
const auth = require("./auth");

/**
 * Notificaciones del panel (la campanita de la cabecera y los números en las tarjetas). Hoy sólo
 * avisan de los ACP (avisos a muy corto plazo del SMN) que llegan; después se suman las alertas
 * automáticas: cada tipo es un texto libre (`tipo`) y cada notificación una `clave` única, así que
 * avisar dos veces de lo mismo no la duplica.
 *
 *  notificaciones         una por evento (la ven todos los usuarios)
 *  notificaciones_leidas  qué usuario ya la vio (cada uno tiene la suya)
 * Sin base de datos no hay notificaciones (devuelven vacío).
 */
const DIAS_VISIBLES = 3;
let initPromise;

async function init() {
  if (!store.usaPostgres()) return false;
  if (initPromise) return initPromise.then(() => true);
  await store.init();
  await auth.init();
  const p = store.getPool();
  initPromise = p
    .query(
      `CREATE TABLE IF NOT EXISTS notificaciones (
         id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         tipo       text NOT NULL,
         clave      text NOT NULL UNIQUE,
         titulo     text NOT NULL,
         detalle    text,
         url        text,
         creada_en  timestamptz NOT NULL DEFAULT now(),
         vence_en   timestamptz
       );
       CREATE TABLE IF NOT EXISTS notificaciones_leidas (
         usuario_id      bigint NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
         notificacion_id bigint NOT NULL REFERENCES notificaciones(id) ON DELETE CASCADE,
         leida_en        timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (usuario_id, notificacion_id)
       );
       CREATE INDEX IF NOT EXISTS notificaciones_creada_idx ON notificaciones (creada_en DESC);
       -- Alguien ya se ocupó (ej. generó el aviso del ACP): deja de contar como nueva para todos.
       ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS resuelta_en timestamptz;
       ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS resuelta_por bigint REFERENCES usuarios(id) ON DELETE SET NULL;`
    )
    .then(() => console.log("[notificacionesStore] Postgres listo"))
    .catch((e) => { initPromise = null; throw e; });
  await initPromise;
  return true;
}

/** Crea la notificación si no existía (misma `clave`). Devuelve true si es nueva. */
async function crearSiNoExiste({ tipo, clave, titulo, detalle = null, url = null, venceEn = null }) {
  if (!(await init())) return false;
  const { rowCount } = await store.getPool().query(
    `INSERT INTO notificaciones (tipo, clave, titulo, detalle, url, vence_en) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (clave) DO NOTHING`,
    [tipo, clave, titulo, detalle, url, venceEn]);
  return rowCount > 0;
}

/**
 * Alguien se ocupó de esta notificación (la `clave` de `crearSiNoExiste`): deja de contar como nueva para todos los
 * usuarios; cada uno lo ve en su próxima consulta. No hace nada si no existe o ya estaba resuelta.
 */
async function resolver(clave, usuarioId = null) {
  if (!(await init())) return false;
  const { rowCount } = await store.getPool().query(
    `UPDATE notificaciones SET resuelta_en = now(), resuelta_por = $2 WHERE clave = $1 AND resuelta_en IS NULL`, [clave, usuarioId]);
  return rowCount > 0;
}

/**
 * Las de los últimos días, la más nueva primero, con `leida` según el usuario. `nuevas`: cuántas sin leer
 * siguen vigentes (una vencida ya no sirve como aviso), en total y por tipo.
 */
async function listar(usuarioId, { limite = 30 } = {}) {
  if (!(await init())) return { notificaciones: [], nuevas: 0, nuevasPorTipo: {} };
  const { rows } = await store.getPool().query(
    `SELECT n.id, n.tipo, n.titulo, n.detalle, n.url, n.creada_en, n.vence_en, n.resuelta_en, u.email AS resuelta_por, (l.usuario_id IS NOT NULL) AS leida
       FROM notificaciones n LEFT JOIN notificaciones_leidas l ON l.notificacion_id = n.id AND l.usuario_id = $1
       LEFT JOIN usuarios u ON u.id = n.resuelta_por
      WHERE n.creada_en > now() - make_interval(days => $2)
      ORDER BY n.creada_en DESC, n.id DESC LIMIT $3`, [usuarioId, DIAS_VISIBLES, limite]);
  const ahora = Date.now();
  const notificaciones = rows.map((r) => ({ id: Number(r.id), tipo: r.tipo, titulo: r.titulo, detalle: r.detalle, url: r.url,
    creadaEn: r.creada_en.toISOString(), venceEn: r.vence_en ? r.vence_en.toISOString() : null, leida: r.leida,
    vencida: !!r.vence_en && r.vence_en.getTime() <= ahora, resuelta: !!r.resuelta_en, resueltaPor: r.resuelta_por || null }));
  const sinLeer = notificaciones.filter((n) => !n.leida && !n.vencida && !n.resuelta);
  const nuevasPorTipo = {};
  for (const n of sinLeer) nuevasPorTipo[n.tipo] = (nuevasPorTipo[n.tipo] || 0) + 1;
  return { notificaciones, nuevas: sinLeer.length, nuevasPorTipo };
}

/** Marca como leídas para este usuario: unas `ids`, todas las de un `tipo` o todas (`todas`). */
async function marcarLeidas(usuarioId, { ids = null, tipo = null, todas = false } = {}) {
  if (!(await init())) return 0;
  const p = store.getPool();
  const base = `INSERT INTO notificaciones_leidas (usuario_id, notificacion_id) SELECT $1, id FROM notificaciones WHERE creada_en > now() - make_interval(days => $2)`;
  const args = [usuarioId, DIAS_VISIBLES];
  let sql;
  if (todas) sql = base;
  else if (tipo) { sql = `${base} AND tipo = $3`; args.push(String(tipo)); }
  else if (Array.isArray(ids) && ids.length && ids.every((i) => Number.isInteger(i) && i > 0)) { sql = `${base} AND id = ANY($3::bigint[])`; args.push(ids); }
  else return 0;
  const { rowCount } = await p.query(`${sql} ON CONFLICT DO NOTHING`, args);
  return rowCount;
}

module.exports = { init, crearSiNoExiste, resolver, listar, marcarLeidas, DIAS_VISIBLES };
