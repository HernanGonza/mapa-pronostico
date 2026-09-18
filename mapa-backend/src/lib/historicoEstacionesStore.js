const store = require('./store');

const ESTACIONES = [
  { id: 'iguazu_aero', nombre: 'Iguazú Aero', zona: 'Norte' },
  { id: 'bernardo_de_irigoyen_aero', nombre: 'Bernardo de Irigoyen Aero', zona: 'Centro' },
  { id: 'posadas_aero', nombre: 'Posadas Aero', zona: 'Sur' },
];

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
  return rows.map(r => ({ ...r, desde: r.desde?.toISOString().slice(0,10) || null, hasta: r.hasta?.toISOString().slice(0,10) || null }));
}

async function obtenerSerie(estacionId, desde, hasta) {
  if (!ESTACIONES.some(e => e.id === estacionId)) throw Object.assign(new Error('Estación inválida.'), { status: 400 });
  if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde) || hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    throw Object.assign(new Error('Fecha inválida.'), { status: 400 });
  }
  await init();
  const { rows } = await store.getPool().query(`SELECT fecha, temperatura_maxima, temperatura_minima,
    temperatura_media, punto_rocio, presion_estacion, precipitacion, humedad_relativa,
    heliofania, nubosidad, viento_maximo_direccion, viento_maximo_intensidad, viento_medio_intensidad
    FROM observaciones_historicas WHERE estacion_id=$1
    AND fecha >= COALESCE($2::date, '-infinity'::date)
    AND fecha <= COALESCE($3::date, 'infinity'::date)
    ORDER BY fecha LIMIT 25000`, [estacionId, desde || null, hasta || null]);
  return rows.map(r => Object.fromEntries(Object.entries(r).map(([k,v]) =>
    [k, k === 'fecha' ? v.toISOString().slice(0,10) : v == null ? null : Number(v)])));
}

module.exports = { ESTACIONES, init, obtenerResumen, obtenerSerie };
