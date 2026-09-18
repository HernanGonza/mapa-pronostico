// Monitor de cuencas: RE-SIRVE datos públicos del SIG de Misiones
// (https://sig.misiones.gob.ar/mapas/monitor/), la misma info que muestran
// sus tarjetas "Río Paraná/Uruguay/Iguazú" y el mapa de represas/puertos.
// No hay iframe ni API con CORS: es una página propia que arma esas vistas
// a partir de un GeoJSON y varios CSV que sí se pueden pedir server-side.
// Fuente última: datos del ONS (Brasil) para las represas.
const BASE = 'https://sig.misiones.gob.ar/mapas/datos';
// Coordenadas de las represas: no vienen en ningún JSON, están fijas en el
// JS de la página de origen (sig.misiones.gob.ar/mapas/monitor/) — mismas
// 4, mismo orden.
const REPRESAS = [
  { id: 'itaipu', nombre: 'Itaipú', coords: [-25.4078, -54.5892], csv: 'ITAIPU.csv' },
  { id: 'caxias', nombre: 'Salto Caxias', coords: [-25.5431, -53.4981], csv: 'CAXIAS.csv' },
  { id: 'chapeco', nombre: 'Foz do Chapecó', coords: [-27.140421, -53.043532], csv: 'CHAPECO.csv' },
  { id: 'capanema', nombre: 'Capanema (Baixo Iguaçu)', coords: [-25.629377, -52.619576], csv: 'CAPANEMA.csv' },
];
const INTERVALO = 30 * 60 * 1000; // los CSV son series horarias; no hace falta más seguido.
let estado = { consultadoEn: null, error: null, tarjetas: null, represas: [], puertos: null };
let actualizando = null;

async function descargar(url, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error(`SIG Misiones HTTP ${r.status} (${url})`);
    return await r.text();
  } catch (e) {
    throw e.name === 'AbortError' ? new Error(`SIG Misiones: timeout pidiendo ${url}`) : e;
  } finally { clearTimeout(timer); }
}

// Columnas del CSV del ONS (formato fijo, separador ';'): sólo interesan
// din_instante (col. 7) y val_vazaodefluente (col. 12), última fila = dato
// más reciente.
function ultimoDefluente(csv) {
  const lineas = csv.trim().split('\n');
  if (lineas.length < 2) throw new Error('CSV de represa vacío');
  const cols = lineas.at(-1).split(';');
  const valor = Number(cols[12]);
  if (!Number.isFinite(valor)) throw new Error('CSV de represa: val_vazaodefluente inválido');
  return { valor, fecha: cols[7] || null };
}

const fmtFecha = () => new Date().toISOString().slice(0, 10);

async function leerRepresas() {
  const v = fmtFecha();
  const datos = await Promise.all(REPRESAS.map(async r => {
    const csv = await descargar(`${BASE}/${r.csv}?v=${v}`);
    const { valor, fecha } = ultimoDefluente(csv);
    return { ...r, valor, fecha };
  }));
  const porId = Object.fromEntries(datos.map(d => [d.id, d]));
  const tarjetas = {
    parana: { rio: 'Río Paraná', subtitulo: 'Defluente Itaipú + Salto Caxias', valor: porId.itaipu.valor + porId.caxias.valor,
      detalle: `Itaipú ${Math.round(porId.itaipu.valor).toLocaleString('es-AR')} · Caxias ${Math.round(porId.caxias.valor).toLocaleString('es-AR')}` },
    uruguay: { rio: 'Río Uruguay', subtitulo: 'Defluente Foz do Chapecó', valor: porId.chapeco.valor, detalle: null },
    iguazu: { rio: 'Río Iguazú', subtitulo: 'Defluente Salto Caxias', valor: porId.caxias.valor, detalle: null },
  };
  const represas = datos.map(({ id, nombre, coords, valor, fecha }) => ({ id, nombre, coords, valor, fecha }));
  return { tarjetas, represas };
}

async function leerPuertos() {
  const geojson = JSON.parse(await descargar(`${BASE}/altura-rios.json?v=${fmtFecha()}`));
  return geojson.features.map(f => ({
    id: f.properties.unid ?? f.properties.series_id,
    nombre: f.properties.nombre,
    rio: f.properties.rio,
    coords: [f.geometry.coordinates[1], f.geometry.coordinates[0]],
    valor: f.properties.valor,
    tendencia: f.properties.tendencia,
    estado: f.properties.estado,
    nivelAlerta: f.properties.nivel_de_alerta,
    nivelEvacuacion: f.properties.nivel_de_evacuacion,
    nivelAguasBajas: f.properties.nivel_de_aguas_bajas,
    fecha: f.properties.fecha,
  }));
}

async function actualizarAhora({ logger = console } = {}) {
  if (actualizando) return actualizando;
  actualizando = (async () => {
    try {
      const [{ tarjetas, represas }, puertos] = await Promise.all([leerRepresas(), leerPuertos()]);
      estado = { consultadoEn: new Date().toISOString(), error: null, tarjetas, represas, puertos };
      logger.info(`[cuencas] actualizado: ${puertos.length} puertos, ${represas.length} represas`);
    } catch (e) {
      estado = { ...estado, error: e.message };
      logger.error('[cuencas]', e.message);
    }
  })().finally(() => { actualizando = null; });
  return actualizando;
}

function iniciar({ intervalMs = INTERVALO, logger = console } = {}) {
  let stopped = false;
  const timer = setInterval(() => { if (!stopped) actualizarAhora({ logger }); }, intervalMs);
  timer.unref?.();
  void actualizarAhora({ logger });
  return { async detener() { stopped = true; clearInterval(timer); await actualizando; } };
}

function obtenerActual() {
  const desactualizado = !estado.consultadoEn || Date.now() - Date.parse(estado.consultadoEn) > 2 * INTERVALO;
  return { fuente: 'SIG Misiones · sig.misiones.gob.ar/mapas/monitor', ...estado, desactualizado };
}

module.exports = { actualizarAhora, iniciar, obtenerActual, REPRESAS };
