const store = require("./store");
const auth = require("./auth");

/**
 * Planilla de precipitaciones (reemplaza al Excel PRECIPITACIONES.xlsx): estaciones cargadas a mano, la lluvia de cada día y la
 * media mensual de cada una. Los totales, anomalías y acumulados se calculan al leer (no se guardan).
 *   precipitaciones_estaciones  nombre + red (1 SMN, 2 INTA, 3 Automática, 4 Red Matteo); «Posadas» puede estar en dos redes
 *   precipitaciones_medias      media del mes (1-12) de cada estación; `usa_media_de` = «se toma la media de Cerro Azul»
 *   precipitaciones_diarias     mm de cada estación y día; sin fila = sin dato (distinto de 0)
 * Lo que se carga es un borrador: la tabla y el mapa públicos leen la copia publicada (`*_pub`), que se actualiza sólo con `publicar()`.
 */
let initPromise;
async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  await auth.init();
  initPromise = store.getPool().query(
    `CREATE TABLE IF NOT EXISTS precipitaciones_estaciones (
       id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       nombre    text NOT NULL,
       red       smallint NOT NULL CHECK (red BETWEEN 1 AND 4),
       lat       double precision,
       lng       double precision,
       orden     integer NOT NULL DEFAULT 0,
       activa    boolean NOT NULL DEFAULT true,
       creada_en timestamptz NOT NULL DEFAULT now(),
       UNIQUE (nombre, red)
     );
     CREATE TABLE IF NOT EXISTS precipitaciones_medias (
       estacion_id   bigint NOT NULL REFERENCES precipitaciones_estaciones(id) ON DELETE CASCADE,
       mes           smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),
       media_mm      numeric(6,1),
       usa_media_de  bigint REFERENCES precipitaciones_estaciones(id) ON DELETE SET NULL,
       PRIMARY KEY (estacion_id, mes)
     );
     CREATE TABLE IF NOT EXISTS precipitaciones_diarias (
       estacion_id    bigint NOT NULL REFERENCES precipitaciones_estaciones(id) ON DELETE CASCADE,
       fecha          date NOT NULL,
       mm             numeric(6,1) NOT NULL CHECK (mm >= 0),
       actualizado_por bigint REFERENCES usuarios(id),
       actualizado_en timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (estacion_id, fecha)
     );
     CREATE INDEX IF NOT EXISTS precipitaciones_diarias_fecha_idx ON precipitaciones_diarias (fecha);
     CREATE TABLE IF NOT EXISTS precipitaciones_estaciones_pub (
       id bigint PRIMARY KEY, nombre text NOT NULL, red smallint NOT NULL, lat double precision, lng double precision, orden integer NOT NULL, activa boolean NOT NULL
     );
     CREATE TABLE IF NOT EXISTS precipitaciones_medias_pub (
       estacion_id bigint NOT NULL, mes smallint NOT NULL, media_mm numeric(6,1), usa_media_de bigint, PRIMARY KEY (estacion_id, mes)
     );
     CREATE TABLE IF NOT EXISTS precipitaciones_diarias_pub (
       estacion_id bigint NOT NULL, fecha date NOT NULL, mm numeric(6,1) NOT NULL, PRIMARY KEY (estacion_id, fecha)
     );
     CREATE INDEX IF NOT EXISTS precipitaciones_diarias_pub_fecha_idx ON precipitaciones_diarias_pub (fecha);
     CREATE TABLE IF NOT EXISTS precipitaciones_publicaciones (
       id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       publicado_en timestamptz NOT NULL DEFAULT now(),
       publicado_por bigint REFERENCES usuarios(id),
       resumen      jsonb NOT NULL
     )`
  ).then(() => console.log("[precipitacionesStore] Postgres listo (estaciones, medias y diarias)"))
    .catch((e) => { initPromise = null; throw e; });
  return initPromise;
}

const dia = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10));
const n = (v) => (v == null ? null : Number(v));
const sinBase = () => Object.assign(new Error("No hay base de datos disponible para la planilla de precipitaciones."), { status: 503 });
const mal = (texto, status = 400) => Object.assign(new Error(texto), { status });
async function pool() { await init(); const p = store.getPool(); if (!p) throw sinBase(); return p; }

const estacion = (r, medias = []) => ({ id: Number(r.id), nombre: r.nombre, red: r.red, lat: r.lat, lng: r.lng, orden: r.orden, activa: r.activa,
  medias: Object.fromEntries(medias.map((m) => [m.mes, { mediaMm: n(m.media_mm), usaMediaDe: m.usa_media_de == null ? null : Number(m.usa_media_de) }])) });

/**
 * Todas las estaciones (con sus medias por mes) y, si se pide un rango, los mm de cada día: { estaciones, diarias: [[estacionId, "AAAA-MM-DD", mm]] }.
 * Por defecto lo publicado (lo que ve el público); con `borrador` lo que se está cargando.
 */
async function datos({ desde, hasta, borrador = false } = {}) {
  const p = await pool();
  const sufijo = borrador ? "" : "_pub";
  const [{ rows: es }, { rows: ms }] = await Promise.all([
    p.query(`SELECT * FROM precipitaciones_estaciones${sufijo} ORDER BY orden, id`),
    p.query(`SELECT * FROM precipitaciones_medias${sufijo}`),
  ]);
  const porEst = new Map();
  for (const m of ms) { const k = Number(m.estacion_id); if (!porEst.has(k)) porEst.set(k, []); porEst.get(k).push(m); }
  let diarias = [];
  if (desde && hasta) {
    const { rows } = await p.query(`SELECT estacion_id, fecha, mm FROM precipitaciones_diarias${sufijo} WHERE fecha BETWEEN $1 AND $2 ORDER BY fecha`, [desde, hasta]);
    diarias = rows.map((r) => [Number(r.estacion_id), dia(r.fecha), Number(r.mm)]);
  }
  return { estaciones: es.map((r) => estacion(r, porEst.get(Number(r.id)))), diarias };
}

/** Carga o borra celdas. `cambios`: [{ estacionId, fecha, mm }]; mm null = vaciar la celda. */
async function guardarDiarias(cambios, usuarioId = null) {
  const p = await pool();
  const poner = cambios.filter((c) => c.mm != null), quitar = cambios.filter((c) => c.mm == null);
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    if (poner.length) await c.query(
      `INSERT INTO precipitaciones_diarias (estacion_id, fecha, mm, actualizado_por)
       SELECT e, f, m, $4 FROM unnest($1::bigint[], $2::date[], $3::numeric[]) AS t(e, f, m)
       ON CONFLICT (estacion_id, fecha) DO UPDATE SET mm = EXCLUDED.mm, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
      [poner.map((x) => x.estacionId), poner.map((x) => x.fecha), poner.map((x) => x.mm), usuarioId]);
    if (quitar.length) await c.query(
      `DELETE FROM precipitaciones_diarias d USING unnest($1::bigint[], $2::date[]) AS t(e, f) WHERE d.estacion_id = t.e AND d.fecha = t.f`,
      [quitar.map((x) => x.estacionId), quitar.map((x) => x.fecha)]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    if (e.code === "23503") throw mal("Una de las estaciones ya no existe: recargá la planilla.");
    throw e;
  } finally { c.release(); }
  return cambios.length;
}

/** Crea una estación al final de la lista. */
async function crearEstacion({ nombre, red, lat = null, lng = null }) {
  const p = await pool();
  try {
    const { rows } = await p.query(
      `INSERT INTO precipitaciones_estaciones (nombre, red, lat, lng, orden) VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(orden), 0) + 1 FROM precipitaciones_estaciones)) RETURNING *`, [nombre, red, lat, lng]);
    return estacion(rows[0]);
  } catch (e) { if (e.code === "23505") throw mal("Ya hay una estación con ese nombre en esa red."); throw e; }
}

const CAMPOS = { nombre: "nombre", red: "red", lat: "lat", lng: "lng", orden: "orden", activa: "activa" };
async function actualizarEstacion(id, cambios) {
  const p = await pool();
  const sets = [], v = [id];
  for (const [k, col] of Object.entries(CAMPOS)) if (k in cambios) { v.push(cambios[k]); sets.push(`${col} = $${v.length}`); }
  if (!sets.length) throw mal("No hay nada para cambiar.");
  try {
    const { rows } = await p.query(`UPDATE precipitaciones_estaciones SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, v);
    if (!rows.length) throw mal("Esa estación no existe.", 404);
    return estacion(rows[0]);
  } catch (e) { if (e.code === "23505") throw mal("Ya hay una estación con ese nombre en esa red."); throw e; }
}

/** Reordena: `ids` en el orden nuevo. */
async function reordenar(ids) {
  const p = await pool();
  await p.query(`UPDATE precipitaciones_estaciones e SET orden = t.o FROM unnest($1::bigint[]) WITH ORDINALITY AS t(id, o) WHERE e.id = t.id`, [ids]);
}

/** Borra la estación y todos sus datos (los días y las medias se van con ella). */
async function quitarEstacion(id) {
  const p = await pool();
  const { rowCount } = await p.query(`DELETE FROM precipitaciones_estaciones WHERE id = $1`, [id]);
  if (!rowCount) throw mal("Esa estación no existe.", 404);
}

/** Las 12 medias de una estación. `medias`: [{ mes, mediaMm, usaMediaDe }] (se reemplazan las de los meses que lleguen). */
async function guardarMedias(estacionId, medias) {
  const p = await pool();
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    for (const m of medias) {
      if (m.mediaMm == null && m.usaMediaDe == null) await c.query(`DELETE FROM precipitaciones_medias WHERE estacion_id = $1 AND mes = $2`, [estacionId, m.mes]);
      else await c.query(
        `INSERT INTO precipitaciones_medias (estacion_id, mes, media_mm, usa_media_de) VALUES ($1,$2,$3,$4)
         ON CONFLICT (estacion_id, mes) DO UPDATE SET media_mm = EXCLUDED.media_mm, usa_media_de = EXCLUDED.usa_media_de`, [estacionId, m.mes, m.mediaMm, m.usaMediaDe]);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    if (e.code === "23503") throw mal("La estación elegida para la media no existe.");
    throw e;
  } finally { c.release(); }
}

/**
 * Importa lo leído de un Excel: [{ nombre, red, medias: { mes: { mm, ref } }, dias: [[fecha, mm]] }]. Crea las estaciones que falten
 * (por nombre + red), completa las celdas y las medias (`ref` = nombre de la estación de la que se toma la media); no borra nada.
 */
async function importar(estaciones, usuarioId = null) {
  const p = await pool();
  const c = await p.connect();
  const resumen = { estacionesNuevas: 0, dias: 0, medias: 0 };
  try {
    await c.query("BEGIN");
    const ids = new Map();
    for (const e of estaciones) {
      let { rows } = await c.query(`SELECT id FROM precipitaciones_estaciones WHERE nombre = $1 AND red = $2`, [e.nombre, e.red]);
      if (!rows.length) {
        ({ rows } = await c.query(`INSERT INTO precipitaciones_estaciones (nombre, red, orden) VALUES ($1,$2,(SELECT COALESCE(MAX(orden), 0) + 1 FROM precipitaciones_estaciones)) RETURNING id`, [e.nombre, e.red]));
        resumen.estacionesNuevas++;
      }
      ids.set(`${e.nombre}|${e.red}`, rows[0].id);
      if (e.dias.length) {
        await c.query(
          `INSERT INTO precipitaciones_diarias (estacion_id, fecha, mm, actualizado_por)
           SELECT $1, f, m, $4 FROM unnest($2::date[], $3::numeric[]) AS t(f, m)
           ON CONFLICT (estacion_id, fecha) DO UPDATE SET mm = EXCLUDED.mm, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
          [rows[0].id, e.dias.map((d) => d[0]), e.dias.map((d) => d[1]), usuarioId]);
        resumen.dias += e.dias.length;
      }
    }
    const porNombre = (nombre) => [...ids].find(([k]) => k.split("|")[0] === nombre)?.[1] ?? null; // la primera estación con ese nombre
    for (const e of estaciones) {
      const id = ids.get(`${e.nombre}|${e.red}`);
      for (const [mes, m] of Object.entries(e.medias || {})) {
        const ref = m.ref ? porNombre(m.ref) : null;
        await c.query(
          `INSERT INTO precipitaciones_medias (estacion_id, mes, media_mm, usa_media_de) VALUES ($1,$2,$3,$4)
           ON CONFLICT (estacion_id, mes) DO UPDATE SET media_mm = EXCLUDED.media_mm, usa_media_de = EXCLUDED.usa_media_de`, [id, Number(mes), ref ? null : m.mm, ref]);
        resumen.medias++;
      }
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
  return resumen;
}

/** Qué cambió en el borrador respecto de lo publicado (para avisar antes de publicar). */
async function cambiosPendientes(c) {
  const [d, e, m] = await Promise.all([
    c.query(`SELECT count(*) FILTER (WHERE p.estacion_id IS NULL) AS nuevos,
                    count(*) FILTER (WHERE p.estacion_id IS NOT NULL AND p.mm <> d.mm) AS cambiados,
                    (SELECT count(*) FROM precipitaciones_diarias_pub p2 WHERE NOT EXISTS (SELECT 1 FROM precipitaciones_diarias d2 WHERE d2.estacion_id = p2.estacion_id AND d2.fecha = p2.fecha)) AS quitados,
                    (SELECT max(fecha) FROM precipitaciones_diarias) AS ultima
             FROM precipitaciones_diarias d LEFT JOIN precipitaciones_diarias_pub p USING (estacion_id, fecha)`),
    c.query(`SELECT count(*) AS n FROM precipitaciones_estaciones a FULL JOIN precipitaciones_estaciones_pub b USING (id)
             WHERE a.id IS NULL OR b.id IS NULL OR (a.nombre, a.red, a.lat, a.lng, a.orden, a.activa) IS DISTINCT FROM (b.nombre, b.red, b.lat, b.lng, b.orden, b.activa)`),
    c.query(`SELECT count(*) AS n FROM precipitaciones_medias a FULL JOIN precipitaciones_medias_pub b USING (estacion_id, mes)
             WHERE (a.media_mm, a.usa_media_de) IS DISTINCT FROM (b.media_mm, b.usa_media_de)`),
  ]);
  const r = d.rows[0];
  return { diasNuevos: Number(r.nuevos), diasCambiados: Number(r.cambiados), diasQuitados: Number(r.quitados), estaciones: Number(e.rows[0].n), medias: Number(m.rows[0].n), ultimaFecha: r.ultima ? dia(r.ultima) : null };
}

/** Cuándo se publicó por última vez y cuántos cambios hay sin publicar. */
async function estadoPublicacion() {
  const p = await pool();
  const [{ rows }, pendientes] = await Promise.all([
    p.query(`SELECT pu.publicado_en, u.email FROM precipitaciones_publicaciones pu LEFT JOIN usuarios u ON u.id = pu.publicado_por ORDER BY pu.id DESC LIMIT 1`),
    cambiosPendientes(p),
  ]);
  const total = pendientes.diasNuevos + pendientes.diasCambiados + pendientes.diasQuitados + pendientes.estaciones + pendientes.medias;
  return { ultima: rows[0] ? { publicadoEn: rows[0].publicado_en.toISOString(), por: rows[0].email ?? null } : null, pendientes, total };
}

/** Copia el borrador completo (estaciones, medias y días) a lo público. */
async function publicar(usuarioId = null) {
  const p = await pool();
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    await c.query(`LOCK TABLE precipitaciones_diarias_pub, precipitaciones_estaciones_pub, precipitaciones_medias_pub IN EXCLUSIVE MODE`);
    const resumen = await cambiosPendientes(c);
    await c.query(`DELETE FROM precipitaciones_diarias_pub; DELETE FROM precipitaciones_medias_pub; DELETE FROM precipitaciones_estaciones_pub`);
    await c.query(`INSERT INTO precipitaciones_estaciones_pub (id, nombre, red, lat, lng, orden, activa) SELECT id, nombre, red, lat, lng, orden, activa FROM precipitaciones_estaciones`);
    await c.query(`INSERT INTO precipitaciones_medias_pub (estacion_id, mes, media_mm, usa_media_de) SELECT estacion_id, mes, media_mm, usa_media_de FROM precipitaciones_medias`);
    await c.query(`INSERT INTO precipitaciones_diarias_pub (estacion_id, fecha, mm) SELECT estacion_id, fecha, mm FROM precipitaciones_diarias`);
    const { rows } = await c.query(`INSERT INTO precipitaciones_publicaciones (publicado_por, resumen) VALUES ($1, $2::jsonb) RETURNING publicado_en`, [usuarioId, JSON.stringify(resumen)]);
    await c.query("COMMIT");
    return { publicadoEn: rows[0].publicado_en.toISOString(), resumen };
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}

module.exports = { estadoPublicacion, publicar, init, datos, guardarDiarias, crearEstacion, actualizarEstacion, reordenar, quitarEstacion, guardarMedias, importar };
