const fs = require("fs");
const path = require("path");
const store = require("./store");
const { imagenesDe } = require("./informeMensual");

/**
 * Informes semanales guardados (módulo «Informe mensual», pestaña «Informe semanal»): uno por semana (se identifica por el día en que empieza, AAAA-MM-DD), con el borrador completo (ver informeMensual.js; las
 * imágenes viajan dentro, como data URL). Con DATABASE_URL, tabla informes_semanales; sin base, data/store/informes-semanales.json.
 */
const ARCHIVO = path.join(__dirname, "..", "..", "data", "store", "informes-semanales.json");

let initPromise;
async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  initPromise = store.getPool()
    .query(`CREATE TABLE IF NOT EXISTS informes_semanales (
       desde          text PRIMARY KEY,
       borrador       jsonb NOT NULL,
       actualizado_por text,
       creado_en      timestamptz NOT NULL DEFAULT now(),
       actualizado_en timestamptz NOT NULL DEFAULT now()
     )`)
    .then(() => console.log("[informesSemanalesStore] Postgres listo (tabla informes_semanales)"))
    .catch((e) => { initPromise = null; throw e; });
  return initPromise;
}

const leerArchivo = () => { try { return JSON.parse(fs.readFileSync(ARCHIVO, "utf8")); } catch { return { informes: [] }; } };
const escribirArchivo = (d) => { fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true }); fs.writeFileSync(ARCHIVO, JSON.stringify(d)); };
const resumen = (desde, borrador, por, en) => ({ desde, hasta: borrador.hasta, actualizadoPor: por || null, actualizadoEn: new Date(en).toISOString(), conImagenes: imagenesDe(borrador.trimestral).length + imagenesDe(borrador.nino).length });

/** Los informes guardados, el más nuevo primero (sin las imágenes). */
async function listar() {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(`SELECT desde, borrador, actualizado_por, actualizado_en FROM informes_semanales ORDER BY desde DESC LIMIT 200`);
    return rows.map((r) => resumen(r.desde, r.borrador, r.actualizado_por, r.actualizado_en));
  }
  return leerArchivo().informes.sort((a, b) => (a.desde < b.desde ? 1 : -1)).map((r) => resumen(r.desde, r.borrador, r.por, r.en));
}

async function obtener(desde) {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(`SELECT borrador, actualizado_por, actualizado_en FROM informes_semanales WHERE desde = $1`, [desde]);
    return rows[0] ? { borrador: rows[0].borrador, actualizadoPor: rows[0].actualizado_por, actualizadoEn: new Date(rows[0].actualizado_en).toISOString() } : null;
  }
  const r = leerArchivo().informes.find((i) => i.desde === desde);
  return r ? { borrador: r.borrador, actualizadoPor: r.por || null, actualizadoEn: new Date(r.en).toISOString() } : null;
}

/** Guarda (crea o reemplaza) el informe de ese mes. */
async function guardar(desde, borrador, por = null) {
  await init();
  const p = store.getPool();
  if (p) {
    await p.query(
      `INSERT INTO informes_semanales (desde, borrador, actualizado_por) VALUES ($1, $2, $3)
       ON CONFLICT (desde) DO UPDATE SET borrador = EXCLUDED.borrador, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
      [desde, JSON.stringify(borrador), por]);
  } else {
    const d = leerArchivo();
    d.informes = d.informes.filter((i) => !(i.desde === desde)).concat({ desde, borrador, por, en: new Date().toISOString() });
    escribirArchivo(d);
  }
  return { desde, actualizadoEn: new Date().toISOString(), actualizadoPor: por };
}

async function borrar(desde) {
  await init();
  const p = store.getPool();
  if (p) { const r = await p.query(`DELETE FROM informes_semanales WHERE desde = $1`, [desde]); return r.rowCount > 0; }
  const d = leerArchivo(), antes = d.informes.length;
  d.informes = d.informes.filter((i) => !(i.desde === desde));
  escribirArchivo(d);
  return d.informes.length < antes;
}

module.exports = { listar, obtener, guardar, borrar };
