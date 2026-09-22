const store = require("./store");

/**
 * Serie diaria del índice FWI por departamento: lo que hace falta para
 * calcular el día siguiente (fórmula recursiva — el FFMC/DMC/DC de hoy
 * salen del de ayer + el clima de hoy, ver fwi.js). Es la parte
 * calculada/automática; no tiene nada que ver con `riesgo_incendios`
 * (riesgoIncendiosStore.js), que es la categoría ya PUBLICADA — una
 * decisión humana, vía "Revisar y publicar", que ahora puede arrancar
 * pre-cargada con este cálculo en vez de en blanco.
 *
 * Sin Postgres no hay forma de persistir una serie histórica día a día
 * (a diferencia de otros stores del proyecto, acá no hay fallback a
 * archivo: el cron simplemente no corre sin base — ver riesgoIncendiosIndiceService.js).
 */
let listo = null;

async function init() {
  if (!store.usaPostgres()) return;
  if (listo) return listo;
  await store.init();
  const pool = store.getPool();
  if (!pool) return;
  listo = pool
    .query(
      `CREATE TABLE IF NOT EXISTS riesgo_incendios_indice (
         departamento_id text NOT NULL,
         fecha           date NOT NULL,
         temperatura     real,
         humedad         real,
         viento          real,
         precipitacion   real,
         ffmc            real NOT NULL,
         dmc             real NOT NULL,
         dc              real NOT NULL,
         isi             real NOT NULL,
         bui             real NOT NULL,
         fwi             real NOT NULL,
         categoria       text NOT NULL,
         fuente          text,
         estacion_nombre text,
         generado_en     timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (departamento_id, fecha)
       )`
    )
    .then(() => console.log("[riesgoIncendiosIndice] Postgres listo (tabla riesgo_incendios_indice)"))
    .catch((err) => {
      listo = null;
      throw err;
    });
  return listo;
}

function filaAObjeto(r) {
  return {
    departamentoId: r.departamento_id,
    fecha: r.fecha.toISOString().slice(0, 10),
    temperatura: r.temperatura,
    humedad: r.humedad,
    viento: r.viento,
    precipitacion: r.precipitacion,
    ffmc: r.ffmc,
    dmc: r.dmc,
    dc: r.dc,
    isi: r.isi,
    bui: r.bui,
    fwi: r.fwi,
    categoria: r.categoria,
    fuente: r.fuente,
    estacionNombre: r.estacion_nombre,
    generadoEn: r.generado_en.toISOString(),
  };
}

/** La fila más reciente ANTERIOR a `fecha` (para arrancar la recursión del
 * día que se está por calcular) — `null` si no hay ninguna (primer día). */
async function obtenerUltimo(departamentoId, fecha) {
  if (!store.usaPostgres()) return null;
  await init();
  const pool = store.getPool();
  const { rows } = await pool.query(
    `SELECT * FROM riesgo_incendios_indice WHERE departamento_id = $1 AND fecha < $2 ORDER BY fecha DESC LIMIT 1`,
    [String(departamentoId), fecha]
  );
  return rows.length ? filaAObjeto(rows[0]) : null;
}

async function obtener(departamentoId, fecha) {
  if (!store.usaPostgres()) return null;
  await init();
  const pool = store.getPool();
  const { rows } = await pool.query(`SELECT * FROM riesgo_incendios_indice WHERE departamento_id = $1 AND fecha = $2`, [String(departamentoId), fecha]);
  return rows.length ? filaAObjeto(rows[0]) : null;
}

/** Todas las filas de una fecha (los 17 departamentos, si ya se calcularon). */
async function obtenerTodos(fecha) {
  if (!store.usaPostgres()) return [];
  await init();
  const pool = store.getPool();
  const { rows } = await pool.query(`SELECT * FROM riesgo_incendios_indice WHERE fecha = $1`, [fecha]);
  return rows.map(filaAObjeto);
}

async function obtenerUltimaFecha() {
  if (!store.usaPostgres()) return null;
  await init();
  const pool = store.getPool();
  const { rows } = await pool.query(`SELECT MAX(fecha) AS fecha FROM riesgo_incendios_indice`);
  return rows[0]?.fecha ? rows[0].fecha.toISOString().slice(0, 10) : null;
}

async function guardar(departamentoId, fecha, datos) {
  await init();
  const pool = store.getPool();
  if (!pool) throw Object.assign(new Error("No hay base de datos disponible para guardar el índice de riesgo de incendios."), { status: 503 });
  await pool.query(
    `INSERT INTO riesgo_incendios_indice (departamento_id, fecha, temperatura, humedad, viento, precipitacion, ffmc, dmc, dc, isi, bui, fwi, categoria, fuente, estacion_nombre)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (departamento_id, fecha) DO UPDATE SET
       temperatura = EXCLUDED.temperatura, humedad = EXCLUDED.humedad, viento = EXCLUDED.viento, precipitacion = EXCLUDED.precipitacion,
       ffmc = EXCLUDED.ffmc, dmc = EXCLUDED.dmc, dc = EXCLUDED.dc, isi = EXCLUDED.isi, bui = EXCLUDED.bui, fwi = EXCLUDED.fwi,
       categoria = EXCLUDED.categoria, fuente = EXCLUDED.fuente, estacion_nombre = EXCLUDED.estacion_nombre, generado_en = now()`,
    [String(departamentoId), fecha, datos.temperatura, datos.humedad, datos.viento, datos.precipitacion, datos.ffmc, datos.dmc, datos.dc, datos.isi, datos.bui, datos.fwi, datos.categoria, datos.fuente, datos.estacionNombre]
  );
}

module.exports = { init, obtener, obtenerUltimo, obtenerTodos, obtenerUltimaFecha, guardar };
