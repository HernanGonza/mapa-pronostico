const { serie, vigente, tendencia } = require('./datos');
const BASE = 'https://sig.misiones.gob.ar/mapas/datos';
const REPRESAS = [
  { id: 'itaipu', nombre: 'Itaipú', coords: [-25.4078, -54.5892], csv: 'ITAIPU.csv' },
  { id: 'caxias', nombre: 'Salto Caxias', coords: [-25.5431, -53.4981], csv: 'CAXIAS.csv' },
  { id: 'chapeco', nombre: 'Foz do Chapecó', coords: [-27.140421, -53.043532], csv: 'CHAPECO.csv' },
  { id: 'capanema', nombre: 'Capanema (Baixo Iguaçu)', coords: [-25.629377, -52.619576], csv: 'CAPANEMA.csv' },
];
const INTERVALO = 5 * 60 * 1000;
const ESTACIONES = [
  { id: 'soberbio', nombre: 'El Soberbio', rio: 'uruguay', csv: 'EL_SOBERBIO.csv', alerta: 11, evacuacion: 13 },
  { id: 'sanjavier', nombre: 'San Javier', rio: 'uruguay', csv: 'SAN_JAVIER.csv', alerta: 6.5, evacuacion: 10, emergencia: 13 },
  { id: 'puertoiguazu', nombre: 'Puerto Iguazú', rio: 'parana', csv: 'IGUAZU_SNIH.csv' },
  { id: 'libertad', nombre: 'Libertad', rio: 'parana', csv: 'LIBERTAD_SNIH.csv' },
];
const FUENTES = [...REPRESAS.map(r => ({ ...r, tipo: 'ons' })),
  { id: 'usina', csv: 'CHAPECO_USINA.csv', tipo: 'usina' },
  ...ESTACIONES.map(r => ({ ...r, tipo: 'estacion' })),
  { id: 'puertos', csv: 'altura-rios.json', tipo: 'json' }];
const cache = new Map();
let consultadoEn = null, actualizando = null;
const niveles = { normal: 'Normal', vigilancia: 'Vigilancia', alerta: 'Alerta', evacuacion: 'Umbral de evacuación', emergencia: 'Emergencia', sin_datos: 'Sin datos recientes' };
const orden = ['normal', 'vigilancia', 'alerta', 'evacuacion', 'emergencia'];
const estado = (codigo, motivo) => ({ codigo, etiqueta: niveles[codigo], motivo });
async function descargar(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}
function puertos(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.features) || !data.features.length) throw new Error('Mapa sin estaciones');
  return data.features.map(f => ({
    id: f.properties.unid ?? f.properties.series_id, nombre: f.properties.nombre, rio: f.properties.rio,
    coords: [f.geometry.coordinates[1], f.geometry.coordinates[0]], valor: f.properties.valor,
    tendencia: f.properties.tendencia, estado: f.properties.estado,
    nivelAlerta: f.properties.nivel_de_alerta, nivelEvacuacion: f.properties.nivel_de_evacuacion,
    nivelAguasBajas: f.properties.nivel_de_aguas_bajas, fecha: f.properties.fecha,
  }));
}
async function actualizarAhora({ logger = console } = {}) {
  if (actualizando) return actualizando;
  actualizando = (async () => {
    await Promise.allSettled(FUENTES.map(async f => {
      const intentoEn = new Date().toISOString();
      try {
        const text = await descargar(`${BASE}/${f.csv}?v=${Date.now()}`);
        const datos = f.tipo === 'json' ? puertos(text) : serie(text, f.tipo);
        cache.set(f.id, { datos, consultadoEn: intentoEn, intentoEn, error: null });
      } catch (e) {
        cache.set(f.id, { ...cache.get(f.id), intentoEn, error: `${f.csv}: ${e.message}` });
        logger.warn?.(`[cuencas] ${f.csv}: ${e.message}`);
      }
    }));
    consultadoEn = new Date().toISOString();
  })().finally(() => { actualizando = null; });
  return actualizando;
}
function lectura(id, ahora) {
  const source = cache.get(id);
  const last = source?.datos?.[0];
  return { valor: last?.valor ?? null, fecha: last?.fecha ?? null,
    vigente: vigente(last, 3, ahora), error: source?.error || null,
    ...tendencia(source?.datos) };
}
function situacionLocal(config, ahora) {
  const l = lectura(config.id, ahora);
  let s = estado('sin_datos', `Sin medición reciente en ${config.nombre}`);
  if (l.vigente) {
    const umbral = config.emergencia && l.valor >= config.emergencia ? 'emergencia'
      : config.evacuacion && l.valor >= config.evacuacion ? 'evacuacion'
      : config.alerta && l.valor >= config.alerta ? 'alerta' : null;
    // Sin umbrales locales definidos, se informa la tendencia sin inventar alerta por altura.
    s = umbral ? estado(umbral, `${config.nombre}: supera el umbral de ${niveles[umbral].toLowerCase()}`)
      : l.variacion >= 0.12 ? estado('alerta', `Ascenso rápido en ${config.nombre}`)
      : l.variacion >= 0.04 ? estado('vigilancia', `Nivel en ascenso en ${config.nombre}`)
      : config.alerta ? estado('normal', `${config.nombre}: por debajo del umbral de alerta`)
      : estado('sin_datos', `${config.nombre}: sin umbral de altura definido en el detalle SIG`);
  }
  return { ...config, ...l, estado: s, criterio: 'Detalle del río · SIG Misiones',
    nota: config.id === 'sanjavier' ? 'Alerta a 6,5 m según el detalle SIG; el mapa SIG usa 8 m.' : null };
}
function obtenerActual(ahora = Date.now()) {
  const represas = REPRESAS.map(r => ({ ...r, ...lectura(r.id, ahora) }));
  const localidades = ESTACIONES.map(r => situacionLocal(r, ahora));
  const tarjetas = {};
  for (const [id, rio, fuenteId, subtitulo] of [
    ['parana', 'Río Paraná', 'itaipu', 'Defluente de Itaipú'],
    ['uruguay', 'Río Uruguay', 'usina', 'Salida de Chapecó + aporte del río Chapecó'],
    ['iguazu', 'Río Iguazú', 'capanema', 'Defluente de Capanema'],
  ]) {
    const l = lectura(fuenteId, ahora);
    const sitios = localidades.filter(r => r.rio === id);
    let s = !l.vigente ? estado('sin_datos', 'Sin lectura reciente del caudal de referencia')
      : l.valor >= 20000 ? estado('emergencia', 'Caudal crítico: desde 20.000 m³/s')
      : l.valor >= 16000 ? estado('alerta', 'Caudal alto: desde 16.000 m³/s')
      : l.valor >= 13000 ? estado('vigilancia', 'Caudal elevado: desde 13.000 m³/s')
      : estado('normal', 'Caudal por debajo de 13.000 m³/s');
    const alertas = sitios.filter(r => orden.indexOf(r.estado.codigo) > 0).sort((a, b) => orden.indexOf(b.estado.codigo) - orden.indexOf(a.estado.codigo));
    if (alertas[0] && orden.indexOf(alertas[0].estado.codigo) > orden.indexOf(s.codigo)) s = alertas[0].estado;
    const coberturaIncompleta = !l.vigente || sitios.some(r => !r.vigente || r.estado.codigo === 'sin_datos');
    if (s.codigo === 'normal' && coberturaIncompleta) s = estado('sin_datos', 'Caudal bajo el umbral; situación local sin confirmar');
    tarjetas[id] = { rio, subtitulo, ...l, estado: s, localidades: sitios, coberturaIncompleta,
      criterio: 'Caudal: vigilancia ≥ 13.000, alerta ≥ 16.000 y emergencia ≥ 20.000 m³/s. Clasificación de este sitio con referencias del SIG; no equivale a una orden de evacuación.',
      detalle: id === 'parana' ? 'Referencia de alerta: Itaipú. La portada SIG suma Itaipú + Caxias.'
        : id === 'iguazu' ? 'Referencia de alerta: Capanema. La portada SIG muestra Caxias.'
        : 'Cálculo del detalle SIG: turbinado + vertido + aporte del río Chapecó.' };
  }
  const fuentes = FUENTES.map(f => ({ id: f.id, archivo: f.csv, consultadoEn: cache.get(f.id)?.consultadoEn ?? null,
    error: cache.get(f.id)?.error ?? null }));
  const errors = fuentes.filter(f => f.error);
  return { fuente: 'SIG Misiones', consultadoEn, tarjetas: consultadoEn ? tarjetas : null, represas,
    puertos: cache.get('puertos')?.datos?.map(p => ({ ...p, desactualizado: !vigente(p, 36, ahora) })) ?? null,
    fuentes, error: errors.length ? `No se pudieron actualizar ${errors.length} fuentes. Se conservan sus últimas lecturas.` : null,
    desactualizado: !consultadoEn || ahora - Date.parse(consultadoEn) > 2 * INTERVALO,
    alertas: Object.values(tarjetas).filter(t => orden.indexOf(t.estado.codigo) > 0).map(t => ({ rio: t.rio, ...t.estado })) };
}
function iniciar({ intervalMs = INTERVALO, logger = console } = {}) {
  const timer = setInterval(() => { void actualizarAhora({ logger }); }, intervalMs);
  timer.unref?.(); void actualizarAhora({ logger });
  return { async detener() { clearInterval(timer); await actualizando; } };
}
module.exports = { actualizarAhora, iniciar, obtenerActual, REPRESAS };
