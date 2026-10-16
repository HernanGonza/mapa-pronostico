const store = require("./store");
const auth = require("./auth");

/**
 * Tabla online de precipitaciones (se muestra en /embed/precipitaciones): una fila por estación y período,
 * que se carga desde el informe de precipitaciones («Publicar en la tabla online»). Volver a publicar el
 * mismo período de la misma estación actualiza la fila en vez de duplicarla.
 *   fecha_desde / fecha_hasta   días que cubre el dato (hora de Misiones)
 *   lluvia_mm                   lluvia del período; max_mm / max_minutos: la máxima en una ventana de 30 min o 1 h
 *   mes_mm / media_mm           acumulado del mes y valor medio; anomalia_mm = mes − media
 */
let initPromise;
async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  await auth.init();
  initPromise = store.getPool().query(
    `CREATE TABLE IF NOT EXISTS precipitaciones_registros (
       id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       clave          text NOT NULL,
       estacion       text NOT NULL,
       red            text NOT NULL,
       fuente         text,
       lat            double precision,
       lng            double precision,
       fecha_desde    date NOT NULL,
       fecha_hasta    date NOT NULL,
       lluvia_mm      numeric(7,1),
       max_mm         numeric(7,1),
       max_minutos    smallint,
       mes_mm         numeric(7,1),
       media_mm       numeric(7,1),
       anomalia_mm    numeric(7,1),
       cargado_por    bigint REFERENCES usuarios(id),
       cargado_en     timestamptz NOT NULL DEFAULT now(),
       actualizado_en timestamptz NOT NULL DEFAULT now(),
       UNIQUE (clave, fecha_desde, fecha_hasta)
     );
     CREATE INDEX IF NOT EXISTS precipitaciones_registros_fecha_idx ON precipitaciones_registros (fecha_hasta)`
  ).then(() => console.log("[precipitacionesTablaStore] Postgres listo (tabla precipitaciones_registros)"))
    .catch((e) => { initPromise = null; throw e; });
  return initPromise;
}

const dia = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10));
const n = (v) => (v == null ? null : Number(v));
const fila = (r) => ({ id: Number(r.id), estacion: r.estacion, red: r.red, fuente: r.fuente, lat: r.lat, lng: r.lng, desde: dia(r.fecha_desde), hasta: dia(r.fecha_hasta),
  lluvia: n(r.lluvia_mm), max: n(r.max_mm), maxMinutos: r.max_minutos, mes: n(r.mes_mm), media: n(r.media_mm), anomalia: n(r.anomalia_mm), actualizadoEn: r.actualizado_en.toISOString() });
const sinBase = () => Object.assign(new Error("No hay base de datos disponible para la tabla de precipitaciones."), { status: 503 });
async function pool() { await init(); const p = store.getPool(); if (!p) throw sinBase(); return p; }

/** Carga (o actualiza) las filas de un período. `filas`: [{ clave, estacion, red, fuente?, lat?, lng?, lluvia, max?, maxMinutos?, mes?, media?, anomalia? }]. */
async function publicar({ desde, hasta, filas, usuarioId = null }) {
  const p = await pool();
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    for (const f of filas) {
      await c.query(
        `INSERT INTO precipitaciones_registros (clave, estacion, red, fuente, lat, lng, fecha_desde, fecha_hasta, lluvia_mm, max_mm, max_minutos, mes_mm, media_mm, anomalia_mm, cargado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (clave, fecha_desde, fecha_hasta) DO UPDATE SET estacion = EXCLUDED.estacion, red = EXCLUDED.red, fuente = EXCLUDED.fuente, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
           lluvia_mm = EXCLUDED.lluvia_mm, max_mm = EXCLUDED.max_mm, max_minutos = EXCLUDED.max_minutos, mes_mm = EXCLUDED.mes_mm, media_mm = EXCLUDED.media_mm,
           anomalia_mm = EXCLUDED.anomalia_mm, cargado_por = EXCLUDED.cargado_por, actualizado_en = now()`,
        [f.clave, f.estacion, f.red, f.fuente ?? null, f.lat ?? null, f.lng ?? null, desde, hasta, f.lluvia, f.max ?? null, f.maxMinutos ?? null, f.mes ?? null, f.media ?? null, f.anomalia ?? null, usuarioId]
      );
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
  return filas.length;
}

/** Filas con filtros opcionales: desde/hasta (el período se cruza con ese rango), red, q (texto en el nombre). Lo más reciente primero. */
async function listar({ desde, hasta, red, q, limite = 5000 } = {}) {
  const p = await pool();
  const donde = [], v = [];
  if (desde) { v.push(desde); donde.push(`fecha_hasta >= $${v.length}`); }
  if (hasta) { v.push(hasta); donde.push(`fecha_desde <= $${v.length}`); }
  if (red) { v.push(red); donde.push(`red = $${v.length}`); }
  if (q) { v.push(`%${q.replace(/[%_\\]/g, "\\$&")}%`); donde.push(`estacion ILIKE $${v.length}`); }
  v.push(limite);
  const { rows } = await p.query(`SELECT * FROM precipitaciones_registros ${donde.length ? `WHERE ${donde.join(" AND ")}` : ""} ORDER BY fecha_hasta DESC, estacion LIMIT $${v.length}`, v);
  return rows.map(fila);
}

/** Saca de la tabla todas las filas de un período exacto (para corregir una carga equivocada). */
async function quitarPeriodo({ desde, hasta }) {
  const p = await pool();
  const { rowCount } = await p.query(`DELETE FROM precipitaciones_registros WHERE fecha_desde = $1 AND fecha_hasta = $2`, [desde, hasta]);
  return rowCount;
}

const CAMPOS = { estacion: "estacion", red: "red", desde: "fecha_desde", hasta: "fecha_hasta", lluvia: "lluvia_mm", max: "max_mm", maxMinutos: "max_minutos", mes: "mes_mm", media: "media_mm", anomalia: "anomalia_mm", lat: "lat", lng: "lng" };

/** Corrige una fila (los campos que lleguen en `cambios`; las claves son las de `listar`). */
async function actualizar(id, cambios) {
  const p = await pool();
  const sets = [], v = [id];
  for (const [k, col] of Object.entries(CAMPOS)) if (k in cambios) { v.push(cambios[k]); sets.push(`${col} = $${v.length}`); }
  if (!sets.length) throw Object.assign(new Error("No hay nada para cambiar."), { status: 400 });
  try {
    const { rows } = await p.query(`UPDATE precipitaciones_registros SET ${sets.join(", ")}, actualizado_en = now() WHERE id = $1 RETURNING *`, v);
    if (!rows.length) throw Object.assign(new Error("Esa fila no existe."), { status: 404 });
    return fila(rows[0]);
  } catch (e) {
    if (e.code === "23505") throw Object.assign(new Error("Ya hay una fila de esa estación para ese período."), { status: 400 });
    throw e;
  }
}

async function quitar(id) {
  const p = await pool();
  const { rowCount } = await p.query(`DELETE FROM precipitaciones_registros WHERE id = $1`, [id]);
  if (!rowCount) throw Object.assign(new Error("Esa fila no existe."), { status: 404 });
}

module.exports = { init, publicar, listar, quitarPeriodo, actualizar, quitar };
