const store = require("./store");
const { nowInArgentina } = require("./dateUtils");

/**
 * Serie histórica diaria por estación (TMIN/TMAX/condición/precipitación)
 * — la base de los gráficos de "clima histórico". Se alimenta de dos
 * maneras:
 *  1. Automática, hacia adelante: cada publicación diaria de Alerta
 *     Temprana (ver `routes/pronostico.js`) llama a `upsertMuchos` con
 *     `fuente='docx_diario'`.
 *  2. Manual, hacia atrás: importación de CSV (`importadorClimatico.js`,
 *     `fuente='import_csv'`) o carga suelta fila por fila
 *     (`fuente='carga_manual'`) para completar el historial que ya existe
 *     en planillas/PDFs sueltos.
 * `UNIQUE (estacion, fecha)` + `ON CONFLICT DO UPDATE` hace que reimportar
 * un rango ya cargado actualice en vez de duplicar.
 */

let initPromise;

async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  const p = store.getPool();
  initPromise = p
    .query(
      `CREATE TABLE IF NOT EXISTS registros_climaticos (
         id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         estacion      text NOT NULL,
         fecha         date NOT NULL,
         tmin          numeric,
         tmax          numeric,
         precipitacion numeric,
         condicion     text,
         fuente        text NOT NULL DEFAULT 'carga_manual',
         creado_en     timestamptz NOT NULL DEFAULT now(),
         UNIQUE (estacion, fecha)
       )`
    )
    .then(() => console.log("[registrosClimaticosStore] Postgres listo (tabla registros_climaticos)"))
    .catch((e) => { initPromise = null; throw e; });
  return initPromise;
}

function fechaHoyArgentina() {
  return nowInArgentina().toISOString().slice(0, 10);
}

async function upsertUno({ estacion, fecha, tmin = null, tmax = null, precipitacion = null, condicion = null, fuente = "carga_manual" }) {
  if (typeof estacion !== "string" || !estacion.trim()) throw Object.assign(new Error("Falta la estación."), { status: 400 });
  if (!fecha || Number.isNaN(Date.parse(fecha))) throw Object.assign(new Error("Fecha inválida."), { status: 400 });
  await init();
  const p = store.getPool();
  if (!p) throw Object.assign(new Error("No hay base de datos disponible."), { status: 503 });
  await p.query(
    `INSERT INTO registros_climaticos (estacion, fecha, tmin, tmax, precipitacion, condicion, fuente)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (estacion, fecha) DO UPDATE SET
       tmin = EXCLUDED.tmin, tmax = EXCLUDED.tmax, precipitacion = EXCLUDED.precipitacion,
       condicion = EXCLUDED.condicion, fuente = EXCLUDED.fuente`,
    [estacion.trim(), fecha, tmin, tmax, precipitacion, condicion, fuente]
  );
}

/** `filas` en el shape del pronóstico diario: [{LOCALIDAD, TMIN, TMAX, CONDICION}]. */
async function upsertMuchos(filas, fecha, fuente = "docx_diario") {
  if (!store.usaPostgres() || !Array.isArray(filas) || !filas.length) return;
  const fechaFinal = fecha || fechaHoyArgentina();
  for (const f of filas) {
    if (!f?.LOCALIDAD) continue;
    await upsertUno({ estacion: f.LOCALIDAD, fecha: fechaFinal, tmin: f.TMIN ?? null, tmax: f.TMAX ?? null, condicion: f.CONDICION ?? null, fuente });
  }
}

async function obtenerEstaciones() {
  if (!store.usaPostgres()) return [];
  await init();
  const p = store.getPool();
  const { rows } = await p.query(`SELECT DISTINCT estacion FROM registros_climaticos ORDER BY estacion`);
  return rows.map((r) => r.estacion);
}

async function obtenerSerie(estacion, desde, hasta) {
  if (!store.usaPostgres() || !estacion) return [];
  await init();
  const p = store.getPool();
  const condiciones = ["estacion = $1"];
  const valores = [estacion];
  if (desde) { valores.push(desde); condiciones.push(`fecha >= $${valores.length}`); }
  if (hasta) { valores.push(hasta); condiciones.push(`fecha <= $${valores.length}`); }
  const { rows } = await p.query(
    `SELECT fecha, tmin, tmax, precipitacion, condicion FROM registros_climaticos
      WHERE ${condiciones.join(" AND ")}
      ORDER BY fecha ASC
      LIMIT 20000`,
    valores
  );
  return rows.map((r) => ({
    fecha: r.fecha.toISOString().slice(0, 10),
    tmin: r.tmin != null ? Number(r.tmin) : null,
    tmax: r.tmax != null ? Number(r.tmax) : null,
    precipitacion: r.precipitacion != null ? Number(r.precipitacion) : null,
    condicion: r.condicion,
  }));
}

/** Agregados simples para la pestaña de estadísticas: conteo de eventos
 * por tipo/año/departamento (join con eventos_climaticos publicados) y un
 * resumen de cobertura de `registros_climaticos` (cuántos días hay
 * cargados por estación, para ubicar huecos del historial). */
async function obtenerEstadisticas() {
  if (!store.usaPostgres()) return { eventosPorTipo: [], eventosPorAnio: [], eventosPorDepartamento: [], coberturaPorEstacion: [] };
  await init();
  const p = store.getPool();
  const [porTipo, porAnio, porDepartamento, cobertura] = await Promise.all([
    p.query(`SELECT tipo, count(*)::int AS cantidad FROM eventos_climaticos WHERE publicado_en IS NOT NULL GROUP BY tipo ORDER BY cantidad DESC`),
    p.query(`SELECT extract(year FROM fecha_inicio)::int AS anio, count(*)::int AS cantidad FROM eventos_climaticos WHERE publicado_en IS NOT NULL GROUP BY anio ORDER BY anio`),
    p.query(`SELECT departamento, count(*)::int AS cantidad FROM eventos_climaticos WHERE publicado_en IS NOT NULL AND departamento IS NOT NULL GROUP BY departamento ORDER BY cantidad DESC`),
    p.query(`SELECT estacion, count(*)::int AS dias, min(fecha) AS desde, max(fecha) AS hasta FROM registros_climaticos GROUP BY estacion ORDER BY estacion`),
  ]);
  return {
    eventosPorTipo: porTipo.rows,
    eventosPorAnio: porAnio.rows,
    eventosPorDepartamento: porDepartamento.rows,
    coberturaPorEstacion: cobertura.rows.map((r) => ({ estacion: r.estacion, dias: r.dias, desde: r.desde.toISOString().slice(0, 10), hasta: r.hasta.toISOString().slice(0, 10) })),
  };
}

module.exports = { init, upsertUno, upsertMuchos, obtenerEstaciones, obtenerSerie, obtenerEstadisticas };
