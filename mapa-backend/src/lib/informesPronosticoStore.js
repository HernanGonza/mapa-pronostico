const fs = require("fs");
const path = require("path");
const store = require("./store");

/**
 * Informes de pronóstico del día (módulo «Previsión del tiempo»). Alerta Temprana arma varios por día (3 es lo normal),
 * así que cada uno es un documento propio: el borrador completo (lo que arma el cajón, ver informePronosticoPdf.js) y
 * lo que le pasó, en `meta`:
 *   { publicadoEn, publicadoPor,                       // lo último que se publicó en los mapas desde este informe
 *     envios: [{ en, por, destinatarios, asunto }],    // correos enviados (con el PDF de este informe)
 *     placa: { id, generadoEn, feedUrl, historiasUrl, feedNombre, historiasNombre, por } }  // la última placa para redes
 * Con DATABASE_URL se guardan en la tabla pronostico_informes; sin base, en data/store/pronostico-informes.json.
 */
const ARCHIVO = path.join(__dirname, "..", "..", "data", "store", "pronostico-informes.json");
const DIAS_VISIBLES = 45;
const MAX_LISTA = 120;

let initPromise;
async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  initPromise = store.getPool()
    .query(`CREATE TABLE IF NOT EXISTS pronostico_informes (
       id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       fecha          date NOT NULL,
       borrador       jsonb NOT NULL,
       meta           jsonb NOT NULL DEFAULT '{}'::jsonb,
       creado_por     text,
       creado_en      timestamptz NOT NULL DEFAULT now(),
       actualizado_en timestamptz NOT NULL DEFAULT now()
     )`)
    .then(() => console.log("[informesPronosticoStore] Postgres listo (tabla pronostico_informes)"))
    .catch((e) => { initPromise = null; throw e; });
  return initPromise;
}

const aInforme = (r) => ({
  id: Number(r.id), fecha: typeof r.fecha === "string" ? r.fecha.slice(0, 10) : new Date(r.fecha.getTime() - r.fecha.getTimezoneOffset() * 60000).toISOString().slice(0, 10),
  borrador: r.borrador, meta: r.meta || {}, creadoPor: r.creado_por || null, creadoEn: new Date(r.creado_en).toISOString(), actualizadoEn: new Date(r.actualizado_en).toISOString(),
});

// --- archivo (sin base) ----------------------------------------------------------------------------------------
const leerArchivo = () => { try { return JSON.parse(fs.readFileSync(ARCHIVO, "utf8")); } catch { return { siguiente: 1, informes: [] }; } };
const escribirArchivo = (d) => { fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true }); fs.writeFileSync(ARCHIVO, JSON.stringify(d, null, 1)); };

async function listar() {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(
      `SELECT id, fecha::text AS fecha, borrador, meta, creado_por, creado_en, actualizado_en FROM pronostico_informes
        WHERE creado_en > now() - ($1 || ' days')::interval OR (meta->>'publicadoEn') IS NOT NULL AND (meta->>'publicadoEn')::timestamptz > now() - ($1 || ' days')::interval
        ORDER BY fecha DESC, id DESC LIMIT $2`, [String(DIAS_VISIBLES), MAX_LISTA]);
    return rows.map(aInforme);
  }
  const desde = Date.now() - DIAS_VISIBLES * 864e5;
  return leerArchivo().informes.filter((i) => Date.parse(i.creado_en) > desde).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id).slice(0, MAX_LISTA).map(aInforme);
}

async function obtener(id) {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(`SELECT id, fecha::text AS fecha, borrador, meta, creado_por, creado_en, actualizado_en FROM pronostico_informes WHERE id = $1`, [id]);
    return rows[0] ? aInforme(rows[0]) : null;
  }
  const r = leerArchivo().informes.find((i) => i.id === id);
  return r ? aInforme(r) : null;
}

async function crear({ borrador, usuario = null }) {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(
      `INSERT INTO pronostico_informes (fecha, borrador, creado_por) VALUES ($1::date, $2::jsonb, $3)
       RETURNING id, fecha::text AS fecha, borrador, meta, creado_por, creado_en, actualizado_en`, [borrador.fecha, JSON.stringify(borrador), usuario]);
    return aInforme(rows[0]);
  }
  const d = leerArchivo(), ahora = new Date().toISOString();
  const fila = { id: d.siguiente++, fecha: borrador.fecha, borrador, meta: {}, creado_por: usuario, creado_en: ahora, actualizado_en: ahora };
  d.informes.push(fila); escribirArchivo(d);
  return aInforme(fila);
}

/** Reemplaza el borrador (el cajón guarda solo mientras se escribe). Devuelve el informe, o null si ya no existe. */
async function guardar(id, borrador) {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(
      `UPDATE pronostico_informes SET fecha = $2::date, borrador = $3::jsonb, actualizado_en = now() WHERE id = $1
       RETURNING id, fecha::text AS fecha, borrador, meta, creado_por, creado_en, actualizado_en`, [id, borrador.fecha, JSON.stringify(borrador)]);
    return rows[0] ? aInforme(rows[0]) : null;
  }
  const d = leerArchivo(), i = d.informes.find((x) => x.id === id);
  if (!i) return null;
  Object.assign(i, { fecha: borrador.fecha, borrador, actualizado_en: new Date().toISOString() });
  escribirArchivo(d);
  return aInforme(i);
}

/** Cambia `meta` con `cambiar(meta) → meta` (sin tocar el borrador). */
async function actualizarMeta(id, cambiar) {
  await init();
  const p = store.getPool();
  if (p) {
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(`SELECT meta FROM pronostico_informes WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows[0]) { await client.query("ROLLBACK"); return null; }
      const meta = cambiar(rows[0].meta || {});
      const r = await client.query(
        `UPDATE pronostico_informes SET meta = $2::jsonb WHERE id = $1 RETURNING id, fecha::text AS fecha, borrador, meta, creado_por, creado_en, actualizado_en`, [id, JSON.stringify(meta)]);
      await client.query("COMMIT");
      return aInforme(r.rows[0]);
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
  }
  const d = leerArchivo(), i = d.informes.find((x) => x.id === id);
  if (!i) return null;
  i.meta = cambiar(i.meta || {});
  escribirArchivo(d);
  return aInforme(i);
}

async function borrar(id) {
  await init();
  const p = store.getPool();
  if (p) return (await p.query(`DELETE FROM pronostico_informes WHERE id = $1`, [id])).rowCount > 0;
  const d = leerArchivo(), antes = d.informes.length;
  d.informes = d.informes.filter((i) => i.id !== id);
  if (d.informes.length === antes) return false;
  escribirArchivo(d);
  return true;
}

module.exports = { listar, obtener, crear, guardar, actualizarMeta, borrar };
