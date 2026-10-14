const fs = require("fs");
const path = require("path");
const store = require("../store");

/**
 * Puntos de monitoreo de arroyos (módulo Inundaciones): cada uno es un lugar donde una crecida corta una ruta
 * o un puente. Pueden tener una estación automática de la Red Hidrológica Nacional (`estacion`, código del SNIH)
 * o no tenerla todavía. Se editan desde el panel; los umbrales (m, en la escala de la estación) los carga el
 * equipo cuando Vialidad / Defensa Civil los informan.
 *
 * Con DATABASE_URL se guardan en la tabla arroyos_puntos (un documento jsonb por punto); sin base, en
 * data/store/arroyos-puntos.json. La primera vez se siembran las estaciones de la RHN de Misiones que miden
 * arroyos internos (ver SEMILLA), sin umbrales.
 */

const ARCHIVO = path.join(__dirname, "..", "..", "..", "data", "store", "arroyos-puntos.json");

// lat/lng del SNIH (Filtros.aspx/LeerEstaciones). Yabotí Guazú no manda datos hoy, pero queda cargada para cuando vuelva.
const SEMILLA = [
  ["13404", "Colonia Mártires", "Arroyo Yabebiry", -27.4011944, -55.3349722],
  ["13414", "El Alcázar", "Arroyo Paranay", -26.75075, -54.7563333],
  ["13422", "Paraje La Lechuza", "Arroyo Soberbio", -27.2574444, -54.2357555],
  ["13407", "Valle Hermoso", "Arroyo Piray Miní", -26.355, -54.4982222],
  ["13424", "Puente Viejo RN 12", "Arroyo Piray Guazú", -26.4860833, -54.5888333],
  ["13403", "Pinar Ciba", "Arroyo Piray Guazú", -26.512, -54.4538333],
  ["13458", "Pte. Int. P. Rosales", "Arroyo Pepirí Guazú", -26.6133333, -53.7347222],
  ["13459", "El Saltito", "Arroyo El Saltito", -27.4405556, -54.5766667],
  ["13461", "San Antonio", "Arroyo San Antonio", -26.5658333, -53.7311111],
  ["13460", "Yabotí Guazú", "Arroyo Yabotí Guazú", -27.0694444, -53.8938889],
].map(([estacion, nombre, arroyo, lat, lng]) => ({ id: `snih-${estacion}`, nombre, arroyo, estacion, ruta: "", municipio: "", lat, lng, vigilancia: null, alerta: null, corte: null, nota: "", activo: true }));

let initPromise;
async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  initPromise = store.getPool()
    .query(`CREATE TABLE IF NOT EXISTS arroyos_puntos (
       id             text PRIMARY KEY,
       datos          jsonb NOT NULL,
       actualizado_en timestamptz NOT NULL DEFAULT now()
     )`)
    .then(() => console.log("[arroyosStore] Postgres listo (tabla arroyos_puntos)"))
    .catch((e) => { initPromise = null; throw e; });
  return initPromise;
}

function leerArchivo() {
  try { return JSON.parse(fs.readFileSync(ARCHIVO, "utf8")); } catch { return null; }
}
function escribirArchivo(puntos) {
  fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
  fs.writeFileSync(ARCHIVO, JSON.stringify(puntos, null, 1));
}

async function listar() {
  await init();
  const p = store.getPool();
  let puntos;
  if (p) {
    let { rows } = await p.query(`SELECT datos FROM arroyos_puntos`);
    if (!rows.length) {
      for (const s of SEMILLA) await p.query(`INSERT INTO arroyos_puntos (id, datos) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING`, [s.id, JSON.stringify(s)]);
      ({ rows } = await p.query(`SELECT datos FROM arroyos_puntos`));
    }
    puntos = rows.map((r) => r.datos);
  } else {
    puntos = leerArchivo();
    if (!puntos) { puntos = SEMILLA; escribirArchivo(puntos); }
  }
  return puntos.sort((a, b) => a.arroyo.localeCompare(b.arroyo, "es") || a.nombre.localeCompare(b.nombre, "es"));
}

async function guardar(punto) {
  await init();
  const p = store.getPool();
  if (p) {
    await p.query(
      `INSERT INTO arroyos_puntos (id, datos) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET datos = EXCLUDED.datos, actualizado_en = now()`,
      [punto.id, JSON.stringify(punto)]
    );
  } else {
    const todos = (await listar()).filter((x) => x.id !== punto.id);
    escribirArchivo([...todos, punto]);
  }
  return punto;
}

async function borrar(id) {
  await init();
  const p = store.getPool();
  if (p) return (await p.query(`DELETE FROM arroyos_puntos WHERE id = $1`, [id])).rowCount > 0;
  const todos = await listar();
  const quedan = todos.filter((x) => x.id !== id);
  if (quedan.length === todos.length) return false;
  escribirArchivo(quedan);
  return true;
}

module.exports = { listar, guardar, borrar, SEMILLA };
