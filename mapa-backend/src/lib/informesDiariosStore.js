const store = require("./store");
const auth = require("./auth");

/**
 * Informes diarios guardados (ver informesDiarios.js): el rango (fecha + desde → fecha_hasta + hasta;
 * fecha_hasta NULL = el mismo día), todo lo que se
 * juntó de las estaciones (resúmenes y series de 10 min), lo del SMN y lo publicado, y el texto
 * final (editado en la pantalla). Para el histórico y las estadísticas.
 */
let initPromise;
async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  await auth.init();
  const p = store.getPool();
  initPromise = p.query(
    `CREATE TABLE IF NOT EXISTS informes_diarios (
       id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       fecha          date NOT NULL,
       fecha_hasta    date,
       desde          text NOT NULL,
       hasta          text NOT NULL,
       titulo         text NOT NULL,
       resumen        text NOT NULL,
       datos          jsonb NOT NULL,
       generado_por   bigint REFERENCES usuarios(id),
       generado_en    timestamptz NOT NULL DEFAULT now(),
       actualizado_en timestamptz
     );
     ALTER TABLE informes_diarios ADD COLUMN IF NOT EXISTS fecha_hasta date;
     CREATE INDEX IF NOT EXISTS informes_diarios_fecha_idx ON informes_diarios (fecha)`
  ).then(() => console.log("[informesDiariosStore] Postgres listo (tabla informes_diarios)"))
    .catch((e) => { initPromise = null; throw e; });
  return initPromise;
}

const dia = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10));
const fila = (r, conDatos = true) => ({ id: Number(r.id), fecha: dia(r.fecha), fechaHasta: r.fecha_hasta ? dia(r.fecha_hasta) : dia(r.fecha), desde: r.desde, hasta: r.hasta,
  titulo: r.titulo, resumen: r.resumen, ...(conDatos ? { datos: r.datos } : {}), generadoEn: r.generado_en.toISOString(), actualizadoEn: r.actualizado_en?.toISOString() ?? null, generadoPorEmail: r.email ?? null });

function sinBase() { return Object.assign(new Error("No hay base de datos disponible para guardar el informe."), { status: 503 }); }

/** Guarda uno nuevo o, con `id`, lo actualiza (texto y datos). */
async function guardar({ id = null, fecha, fechaHasta = fecha, desde, hasta, titulo, resumen, datos, usuarioId = null }) {
  await init();
  const p = store.getPool();
  if (!p) throw sinBase();
  if (id) {
    const { rows } = await p.query(`UPDATE informes_diarios SET titulo = $2, resumen = $3, datos = $4::jsonb, actualizado_en = now() WHERE id = $1 RETURNING *`, [id, titulo, resumen, JSON.stringify(datos)]);
    if (!rows.length) throw Object.assign(new Error("Ese informe no existe."), { status: 404 });
    return fila(rows[0]);
  }
  const { rows } = await p.query(
    `INSERT INTO informes_diarios (fecha, fecha_hasta, desde, hasta, titulo, resumen, datos, generado_por) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *`,
    [fecha, fechaHasta && fechaHasta !== fecha ? fechaHasta : null, desde, hasta, titulo, resumen, JSON.stringify(datos), usuarioId]
  );
  return fila(rows[0]);
}

async function listar(limite = 30) {
  if (!store.usaPostgres()) return [];
  await init();
  const { rows } = await store.getPool().query(
    `SELECT i.id, i.fecha, i.fecha_hasta, i.desde, i.hasta, i.titulo, i.resumen, i.generado_en, i.actualizado_en, u.email FROM informes_diarios i LEFT JOIN usuarios u ON u.id = i.generado_por ORDER BY i.fecha DESC, i.id DESC LIMIT $1`, [limite]);
  return rows.map((r) => fila(r, false));
}

async function obtener(id) {
  await init();
  const p = store.getPool();
  if (!p) throw sinBase();
  const { rows } = await p.query(`SELECT i.*, u.email FROM informes_diarios i LEFT JOIN usuarios u ON u.id = i.generado_por WHERE i.id = $1`, [id]);
  if (!rows.length) throw Object.assign(new Error("Ese informe no existe."), { status: 404 });
  return fila(rows[0]);
}

module.exports = { init, guardar, listar, obtener };
