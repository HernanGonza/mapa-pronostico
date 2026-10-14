const fs = require("fs");
const path = require("path");
const store = require("./store");

/**
 * Lo último que se descargó de cada modelo del ensamble (ver ensambleDescargas.js): una fila por modelo, que se reemplaza
 * cada vez que sale una corrida nueva. `datos` son las series horarias de los 30 puntos (Open-Meteo) o las lecturas del
 * WRF-SMN, tal como las usa ensamble.js; así las consultas no salen a internet.
 *
 * Con DATABASE_URL: tabla ensamble_descargas. Sin base (desarrollo): data/store/ensamble/<modelo>.json.
 */
const DIR = path.join(__dirname, "..", "..", "data", "store", "ensamble");
const TTL_MS = 30000; // las consultas seguidas no vuelven a leer y parsear la fila entera
const cache = new Map(); // modelo → { t, valor }

let initPromise;
// La promesa se guarda antes del primer await: varios modelos inicializan a la vez y dos CREATE TABLE simultáneos chocan.
function init() {
  if (!store.usaPostgres()) return Promise.resolve();
  if (!initPromise) {
    initPromise = store.init()
      .then(() => store.getPool().query(`CREATE TABLE IF NOT EXISTS ensamble_descargas (
         modelo        text PRIMARY KEY,
         corrida       timestamptz NOT NULL,
         descargado_en timestamptz NOT NULL DEFAULT now(),
         duracion_ms   integer,
         datos         jsonb NOT NULL
       )`))
      .then(() => console.log("[ensambleStore] Postgres listo (tabla ensamble_descargas)"))
      .catch((e) => { initPromise = null; throw e; });
  }
  return initPromise;
}

const archivo = (modelo) => path.join(DIR, `${modelo.replace(/[^a-z0-9_]/gi, "")}.json`);

async function guardar(modelo, { corrida, datos, duracionMs = null }) {
  await init();
  const p = store.getPool(), descargadoEn = new Date().toISOString();
  if (p) {
    await p.query(
      `INSERT INTO ensamble_descargas (modelo, corrida, descargado_en, duracion_ms, datos) VALUES ($1, $2, now(), $3, $4::jsonb)
       ON CONFLICT (modelo) DO UPDATE SET corrida = EXCLUDED.corrida, descargado_en = now(), duracion_ms = EXCLUDED.duracion_ms, datos = EXCLUDED.datos`,
      [modelo, corrida, duracionMs, JSON.stringify(datos)]
    );
  } else {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(archivo(modelo), JSON.stringify({ corrida, descargadoEn, duracionMs, datos }));
  }
  cache.set(modelo, { t: Date.now(), valor: { corrida, descargadoEn, duracionMs, datos } });
}

/** { corrida: ISO, descargadoEn: ISO, duracionMs, datos } de la última descarga de `modelo`, o null si nunca se bajó. */
async function leer(modelo) {
  const c = cache.get(modelo);
  if (c && Date.now() - c.t < TTL_MS) return c.valor;
  await init();
  const p = store.getPool();
  let valor = null;
  if (p) {
    const { rows } = await p.query(`SELECT corrida, descargado_en, duracion_ms, datos FROM ensamble_descargas WHERE modelo = $1`, [modelo]);
    if (rows[0]) valor = { corrida: rows[0].corrida.toISOString(), descargadoEn: rows[0].descargado_en.toISOString(), duracionMs: rows[0].duracion_ms, datos: rows[0].datos };
  } else {
    try { valor = JSON.parse(fs.readFileSync(archivo(modelo), "utf8")); } catch { /* nunca se bajó */ }
  }
  cache.set(modelo, { t: Date.now(), valor });
  return valor;
}

/** Sólo el cuándo (sin las series), para el panel: { <modelo>: { corrida, descargadoEn, duracionMs } }. */
async function resumen() {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(`SELECT modelo, corrida, descargado_en, duracion_ms FROM ensamble_descargas`);
    return Object.fromEntries(rows.map((r) => [r.modelo, { corrida: r.corrida.toISOString(), descargadoEn: r.descargado_en.toISOString(), duracionMs: r.duracion_ms }]));
  }
  const salida = {};
  try { for (const f of fs.readdirSync(DIR)) { const j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); salida[f.replace(/\.json$/, "")] = { corrida: j.corrida, descargadoEn: j.descargadoEn, duracionMs: j.duracionMs }; } } catch { /* no hay nada */ }
  return salida;
}

module.exports = { guardar, leer, resumen };
