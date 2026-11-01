const fs = require("fs");
const path = require("path");
const store = require("./store");
const { imagenesDe } = require("./informeMensual");

/**
 * Informes mensuales guardados (módulo «Informe mensual»): uno por mes y año, con el borrador completo (ver informeMensual.js; las
 * imágenes viajan dentro, como data URL). Con DATABASE_URL, tabla informes_mensuales; sin base, data/store/informes-mensuales.json.
 */
const ARCHIVO = path.join(__dirname, "..", "..", "data", "store", "informes-mensuales.json");

let initPromise;
async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  initPromise = store.getPool()
    .query(`CREATE TABLE IF NOT EXISTS informes_mensuales (
       anio           integer NOT NULL,
       mes            integer NOT NULL,
       borrador       jsonb NOT NULL,
       actualizado_por text,
       creado_en      timestamptz NOT NULL DEFAULT now(),
       actualizado_en timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (anio, mes)
     )`)
    .then(() => console.log("[informesMensualesStore] Postgres listo (tabla informes_mensuales)"))
    .catch((e) => { initPromise = null; throw e; });
  return initPromise;
}

const leerArchivo = () => { try { return JSON.parse(fs.readFileSync(ARCHIVO, "utf8")); } catch { return { informes: [] }; } };
const escribirArchivo = (d) => { fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true }); fs.writeFileSync(ARCHIVO, JSON.stringify(d)); };
const resumen = (anio, mes, borrador, por, en) => ({ anio, mes, actualizadoPor: por || null, actualizadoEn: new Date(en).toISOString(), conImagenes: imagenesDe(borrador.trimestral).length + imagenesDe(borrador.nino).length });

/** Los informes guardados, el más nuevo primero (sin las imágenes). */
async function listar() {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(`SELECT anio, mes, borrador, actualizado_por, actualizado_en FROM informes_mensuales ORDER BY anio DESC, mes DESC LIMIT 120`);
    return rows.map((r) => resumen(r.anio, r.mes, r.borrador, r.actualizado_por, r.actualizado_en));
  }
  return leerArchivo().informes.sort((a, b) => b.anio - a.anio || b.mes - a.mes).map((r) => resumen(r.anio, r.mes, r.borrador, r.por, r.en));
}

async function obtener(anio, mes) {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(`SELECT borrador, actualizado_por, actualizado_en FROM informes_mensuales WHERE anio = $1 AND mes = $2`, [anio, mes]);
    return rows[0] ? { borrador: rows[0].borrador, actualizadoPor: rows[0].actualizado_por, actualizadoEn: new Date(rows[0].actualizado_en).toISOString() } : null;
  }
  const r = leerArchivo().informes.find((i) => i.anio === anio && i.mes === mes);
  return r ? { borrador: r.borrador, actualizadoPor: r.por || null, actualizadoEn: new Date(r.en).toISOString() } : null;
}

/** Guarda (crea o reemplaza) el informe de ese mes. */
async function guardar(anio, mes, borrador, por = null) {
  await init();
  const p = store.getPool();
  if (p) {
    await p.query(
      `INSERT INTO informes_mensuales (anio, mes, borrador, actualizado_por) VALUES ($1, $2, $3, $4)
       ON CONFLICT (anio, mes) DO UPDATE SET borrador = EXCLUDED.borrador, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
      [anio, mes, JSON.stringify(borrador), por]);
  } else {
    const d = leerArchivo();
    d.informes = d.informes.filter((i) => !(i.anio === anio && i.mes === mes)).concat({ anio, mes, borrador, por, en: new Date().toISOString() });
    escribirArchivo(d);
  }
  return { anio, mes, actualizadoEn: new Date().toISOString(), actualizadoPor: por };
}

async function borrar(anio, mes) {
  await init();
  const p = store.getPool();
  if (p) { const r = await p.query(`DELETE FROM informes_mensuales WHERE anio = $1 AND mes = $2`, [anio, mes]); return r.rowCount > 0; }
  const d = leerArchivo(), antes = d.informes.length;
  d.informes = d.informes.filter((i) => !(i.anio === anio && i.mes === mes));
  escribirArchivo(d);
  return d.informes.length < antes;
}

module.exports = { listar, obtener, guardar, borrar };
