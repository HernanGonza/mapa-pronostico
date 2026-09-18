const store = require('./store');

const ESTACIONES = [
  { id: 'iguazu_aero', nombre: 'Iguazú Aero', zona: 'Norte' },
  { id: 'bernardo_de_irigoyen_aero', nombre: 'Bernardo de Irigoyen Aero', zona: 'Centro' },
  { id: 'posadas_aero', nombre: 'Posadas Aero', zona: 'Sur' },
];
const ID_PROVINCIA = 'toda_provincia';

let initPromise;

async function init() {
  if (!store.usaPostgres()) throw new Error('No hay base de datos disponible.');
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await store.init();
    const db = store.getPool();
    await db.query(`CREATE TABLE IF NOT EXISTS estaciones_historicas (
      id text PRIMARY KEY, nombre text NOT NULL, zona text NOT NULL UNIQUE
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS observaciones_historicas (
      estacion_id text NOT NULL REFERENCES estaciones_historicas(id),
      fecha date NOT NULL,
      temperatura_maxima numeric, temperatura_minima numeric,
      temperatura_media numeric, punto_rocio numeric,
      presion_estacion numeric, precipitacion numeric,
      humedad_relativa numeric, heliofania numeric, nubosidad numeric,
      viento_maximo_direccion numeric, viento_maximo_intensidad numeric,
      viento_medio_intensidad numeric,
      PRIMARY KEY (estacion_id, fecha)
    )`);
    await db.query('CREATE INDEX IF NOT EXISTS observaciones_historicas_fecha_idx ON observaciones_historicas (fecha)');
    for (const e of ESTACIONES) {
      await db.query(`INSERT INTO estaciones_historicas (id,nombre,zona) VALUES ($1,$2,$3)
        ON CONFLICT (id) DO UPDATE SET nombre=EXCLUDED.nombre, zona=EXCLUDED.zona`, [e.id, e.nombre, e.zona]);
    }
  })().catch(e => { initPromise = null; throw e; });
  return initPromise;
}

async function obtenerResumen() {
  await init();
  const { rows } = await store.getPool().query(`SELECT e.id, e.nombre, e.zona,
    count(o.fecha)::int AS dias, min(o.fecha) AS desde, max(o.fecha) AS hasta
    FROM estaciones_historicas e LEFT JOIN observaciones_historicas o ON o.estacion_id=e.id
    GROUP BY e.id,e.nombre,e.zona ORDER BY CASE e.zona WHEN 'Norte' THEN 1 WHEN 'Centro' THEN 2 ELSE 3 END`);
  const estaciones = rows.map(r => ({ ...r, desde: r.desde?.toISOString().slice(0,10) || null, hasta: r.hasta?.toISOString().slice(0,10) || null }));
  const { rows: [total] } = await store.getPool().query(`SELECT count(*)::int AS dias, min(fecha) AS desde, max(fecha) AS hasta
    FROM (SELECT fecha FROM observaciones_historicas
      WHERE estacion_id = ANY($1::text[]) GROUP BY fecha HAVING count(*) = 3) fechas`, [ESTACIONES.map(e => e.id)]);
  return [{ id: ID_PROVINCIA, nombre: 'Tres estaciones', zona: 'Toda la provincia', dias: total.dias,
    desde: total.desde?.toISOString().slice(0,10) || null, hasta: total.hasta?.toISOString().slice(0,10) || null }, ...estaciones];
}

async function obtenerSerie(estacionId, desde, hasta) {
  if (estacionId !== ID_PROVINCIA && !ESTACIONES.some(e => e.id === estacionId)) throw Object.assign(new Error('Estación inválida.'), { status: 400 });
  if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde) || hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    throw Object.assign(new Error('Fecha inválida.'), { status: 400 });
  }
  await init();
  if (estacionId === ID_PROVINCIA) {
    const { rows } = await store.getPool().query(`SELECT fecha,
      CASE WHEN count(temperatura_maxima)=3 THEN avg(temperatura_maxima) END AS temperatura_maxima,
      CASE WHEN count(temperatura_minima)=3 THEN avg(temperatura_minima) END AS temperatura_minima,
      CASE WHEN count(temperatura_media)=3 THEN avg(temperatura_media) END AS temperatura_media,
      NULL::numeric AS punto_rocio,
      NULL::numeric AS presion_estacion,
      CASE WHEN count(precipitacion)=3 THEN sum(precipitacion) END AS precipitacion,
      NULL::numeric AS humedad_relativa,
      NULL::numeric AS heliofania,
      NULL::numeric AS nubosidad,
      NULL::numeric AS viento_maximo_direccion,
      NULL::numeric AS viento_maximo_intensidad,
      NULL::numeric AS viento_medio_intensidad
      FROM observaciones_historicas WHERE estacion_id = ANY($1::text[])
      AND fecha >= COALESCE($2::date, '-infinity'::date)
      AND fecha <= COALESCE($3::date, 'infinity'::date)
      GROUP BY fecha HAVING count(*) = 3 ORDER BY fecha`, [ESTACIONES.map(e => e.id), desde || null, hasta || null]);
    return normalizarSerie(rows);
  }
  const { rows } = await store.getPool().query(`SELECT fecha, temperatura_maxima, temperatura_minima,
    temperatura_media, punto_rocio, presion_estacion, precipitacion, humedad_relativa,
    heliofania, nubosidad, viento_maximo_direccion, viento_maximo_intensidad, viento_medio_intensidad
    FROM observaciones_historicas WHERE estacion_id=$1
    AND fecha >= COALESCE($2::date, '-infinity'::date)
    AND fecha <= COALESCE($3::date, 'infinity'::date)
    ORDER BY fecha`, [estacionId, desde || null, hasta || null]);
  return normalizarSerie(rows);
}

function normalizarSerie(rows) {
  return rows.map(r => Object.fromEntries(Object.entries(r).map(([k,v]) =>
    [k, k === 'fecha' ? v.toISOString().slice(0,10) : v == null ? null : Number(v)])));
}

async function obtenerComparacion(desde, hasta) {
  if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde) || hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    throw Object.assign(new Error('Fecha inválida.'), { status: 400 });
  }
  await init();
  const { rows } = await store.getPool().query(`SELECT estacion_id, extract(year FROM fecha)::int AS anio,
    count(temperatura_media)::int AS dias_temp, avg(temperatura_media) AS temperatura,
    count(precipitacion)::int AS dias_lluvia, sum(precipitacion) AS lluvia
    FROM observaciones_historicas WHERE fecha >= COALESCE($1::date, '-infinity'::date)
    AND fecha <= COALESCE($2::date, 'infinity'::date)
    GROUP BY estacion_id, anio ORDER BY anio, estacion_id`, [desde || null, hasta || null]);
  return rows.map(r => ({ ...r, temperatura: r.temperatura == null ? null : Number(r.temperatura), lluvia: r.lluvia == null ? null : Number(r.lluvia) }));
}

module.exports = { ESTACIONES, ID_PROVINCIA, init, obtenerResumen, obtenerSerie, obtenerComparacion };
