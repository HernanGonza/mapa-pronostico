import { useEffect, useMemo, useState } from 'react';
import CampoFecha from './CampoFecha';
import { getComparacionEstacionesHistoricas, getEstacionesHistoricas, getSerieEstacionHistorica } from '../api';
import HistoricoMetricChart from './HistoricoMetricChart';
import Numero from './Numero';
import RosaVientos from './RosaVientos';
import BotonTablaPdf from './BotonTablaPdf';
import GraficoPersonalizado from './GraficoPersonalizado';
import { analizarHistorico, coberturaMinima } from '../lib/historicoAnalisis';

const AZUL = '#185f9a';
const ROJO = '#a53246';
const LLUVIA = '#1688b0';
const VERDE = '#548561';
const ORO = '#b98316';
const VIOLETA = '#7663a1';
const sinError = () => {};

const GRAFICOS_PUBLICOS = [
  { titulo: 'Temperaturas', campos: [['tmax', 'Máxima media', ROJO], ['tmin', 'Mínima media', AZUL]], unidad: '°C' },
  { titulo: 'Lluvia acumulada', campos: [['lluvia', 'Precipitación', LLUVIA]], unidad: 'mm', tipo: 'barra' },
  { titulo: 'Días de lluvia', campos: [['diasLluvia', '≥ 1 mm', AZUL], ['r20', '≥ 20 mm', VIOLETA]], unidad: 'días' },
];
const GRAFICOS_TECNICOS = [
  { titulo: 'Máximas y mínimas medias', campos: [['tmax', 'Máxima', ROJO], ['tmin', 'Mínima', AZUL], ['tmedia', 'Media diaria', VERDE]], unidad: '°C' },
  { titulo: 'Precipitación acumulada', campos: [['lluvia', 'Total', LLUVIA]], unidad: 'mm', tipo: 'barra' },
  { titulo: 'Frecuencia de lluvia', campos: [['diasLluvia', '≥ 1 mm', AZUL], ['r10', '≥ 10 mm', LLUVIA], ['r20', '≥ 20 mm', VIOLETA]], unidad: 'días' },
  { titulo: 'Temperaturas altas', campos: [['diasCalurosos', 'Máxima ≥ 35 °C', ROJO], ['nochesTropicales', 'Mínima > 20 °C', ORO]], unidad: 'días' },
  { titulo: 'Precipitación máxima diaria', campos: [['rx1', 'Máximo en 24 h', LLUVIA]], unidad: 'mm' },
  { titulo: 'Rachas de días secos y lluviosos', campos: [['cdd', 'Secos < 1 mm', ORO], ['cwd', 'Lluviosos ≥ 1 mm', AZUL]], unidad: 'días' },
  { titulo: 'Intensidad en días lluviosos', campos: [['intensidad', 'Lluvia por día ≥ 1 mm', LLUVIA]], unidad: 'mm/día' },
  { titulo: 'Amplitud térmica diaria media', campos: [['dtr', 'Máxima − mínima', VIOLETA]], unidad: '°C' },
  { titulo: 'Humedad relativa media', campos: [['humedad', 'Humedad', AZUL]], unidad: '%' },
  { titulo: 'Heliofanía media diaria', campos: [['heliofania', 'Horas de sol', ORO]], unidad: 'h' },
  { titulo: 'Nubosidad media', campos: [['nubosidad', 'Octavos', VIOLETA]], unidad: 'octavos' },
  { titulo: 'Presión media en estación', campos: [['presion', 'Presión', VERDE]], unidad: 'hPa' },
  { titulo: 'Viento medio', campos: [['viento', 'Intensidad', AZUL]], unidad: 'm/s' },
];
for (const grafico of [...GRAFICOS_PUBLICOS, ...GRAFICOS_TECNICOS]) {
  grafico.series = grafico.campos.map(([campo, nombre, color]) => ({ campo, nombre, color }));
}

const CAMPOS_DIARIOS = [
  ['fecha', 'Fecha'], ['temperatura_maxima', 'Máx. °C'], ['temperatura_minima', 'Mín. °C'],
  ['temperatura_media', 'Media °C'], ['punto_rocio', 'Rocío °C'], ['presion_estacion', 'Presión hPa'],
  ['precipitacion', 'Lluvia mm'], ['humedad_relativa', 'Humedad %'], ['heliofania', 'Heliofanía h'],
  ['nubosidad', 'Nubosidad'], ['viento_maximo_direccion', 'Viento máx. dir.'],
  ['viento_maximo_intensidad', 'Viento máx. m/s'], ['viento_medio_intensidad', 'Viento medio m/s'],
];
const ZONAS = [
  ['iguazu_aero', 'Norte · Iguazú', AZUL],
  ['bernardo_de_irigoyen_aero', 'Centro · Bernardo de Irigoyen', VERDE],
  ['posadas_aero', 'Sur · Posadas', ROJO],
];
let referenciaPromise;
function obtenerReferencia() {
  if (!referenciaPromise) referenciaPromise = getComparacionEstacionesHistoricas('1991-01-01', '2020-12-31')
    .catch(e => { referenciaPromise = null; throw e; });
  return referenciaPromise;
}

function restarAnios(fecha, anios) {
  const anio = Number(fecha.slice(0, 4)) - anios;
  const mes = Number(fecha.slice(5, 7));
  const dia = Math.min(Number(fecha.slice(8, 10)), new Date(Date.UTC(anio, mes, 0)).getUTCDate());
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
function formatoNumero(valor) {
  return valor == null ? '—' : Number(valor).toLocaleString('es-AR', { maximumFractionDigits: 1 });
}

function ComparacionZonas({ desde, hasta }) {
  const [anuales, setAnuales] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!desde || !hasta || desde > hasta) return;
    let activo = true;
    getComparacionEstacionesHistoricas(desde, hasta)
      .then(r => { if (activo) { setAnuales(r.anuales); setError(''); } })
      .catch(e => { if (activo) setError(e.message); });
    return () => { activo = false; };
  }, [desde, hasta]);
  const datos = useMemo(() => {
    const mapa = new Map();
    for (const r of anuales) {
      const anio = String(r.anio);
      if (!mapa.has(anio)) mapa.set(anio, { fecha: `${anio}-01-01` });
      const dias = (Date.UTC(r.anio + 1, 0, 1) - Date.UTC(r.anio, 0, 1)) / 86400000;
      if (r.dias_temp / dias >= coberturaMinima) mapa.get(anio)[`temp_${r.estacion_id}`] = Math.round(r.temperatura * 10) / 10;
      if (r.dias_lluvia / dias >= coberturaMinima) mapa.get(anio)[`lluvia_${r.estacion_id}`] = Math.round(r.lluvia * 10) / 10;
    }
    return [...mapa.values()];
  }, [anuales]);
  return <section className="historico-observatorio__comparacion">
    <h3>Comparación entre las tres zonas</h3>
    <p className="historico-observatorio__nota">Se comparan años completos con al menos 90% de datos válidos en cada estación. Los años parciales y anteriores al inicio de Bernardo de Irigoyen quedan sin punto.</p>
    {error && <p role="alert" className="risk-message risk-message--error">{error}</p>}
    <div className="historico-observatorio__graficos">
      <HistoricoMetricChart titulo="Temperatura media anual" subtitulo="Por año" ventana={VENTANA_GRAFICOS.anio} datos={datos} unidad="°C" series={ZONAS.map(([id, nombre, color]) => ({ campo: `temp_${id}`, nombre, color }))} />
      <HistoricoMetricChart titulo="Lluvia anual" subtitulo="Por año" ventana={VENTANA_GRAFICOS.anio} datos={datos} unidad="mm" series={ZONAS.map(([id, nombre, color]) => ({ campo: `lluvia_${id}`, nombre, color }))} />
    </div>
  </section>;
}

function AnomaliasHistoricas({ estacionId, anuales }) {
  const [referencia, setReferencia] = useState([]);
  useEffect(() => {
    let activo = true;
    obtenerReferencia()
      .then(r => { if (activo) setReferencia(r.anuales); })
      .catch(() => { if (activo) setReferencia([]); });
    return () => { activo = false; };
  }, []);
  const { datos, nTemp, nLluvia } = useMemo(() => {
    const base = referencia.filter(r => r.estacion_id === estacionId);
    const validos = (campo, conteo) => base.filter(r => r[conteo] / ((Date.UTC(r.anio + 1, 0, 1) - Date.UTC(r.anio, 0, 1)) / 86400000) >= coberturaMinima && Number.isFinite(r[campo]));
    const temp = validos('temperatura', 'dias_temp');
    const lluvia = validos('lluvia', 'dias_lluvia');
    const baseTemp = temp.length >= 24 ? temp.reduce((s, r) => s + r.temperatura, 0) / temp.length : null;
    const baseLluvia = lluvia.length >= 24 ? lluvia.reduce((s, r) => s + r.lluvia, 0) / lluvia.length : null;
    return {
      nTemp: temp.length, nLluvia: lluvia.length,
      datos: anuales.map(a => ({ fecha: a.fecha,
        temperatura: baseTemp != null && a.tmedia != null ? Math.round((a.tmedia - baseTemp) * 10) / 10 : null,
        lluvia: baseLluvia && a.lluvia != null ? Math.round((a.lluvia / baseLluvia - 1) * 100) : null,
        cero: 0,
      })),
    };
  }, [referencia, estacionId, anuales]);
  return <section className="historico-observatorio__comparacion">
    <h3>Desvíos respecto de 1991–2020</h3>
    <p className="historico-observatorio__nota">Referencia calculada con años de al menos 90% de cobertura: {nTemp} años para temperatura y {nLluvia} para lluvia. Se requiere un mínimo de 24 años. Es una comparación descriptiva de estas planillas, sin ajustes de homogeneidad.</p>
    <div className="historico-observatorio__graficos">
      <HistoricoMetricChart titulo="Temperatura media anual" subtitulo="Diferencia en °C" ventana={VENTANA_GRAFICOS.anio} datos={datos} unidad="°C" series={[{ campo: 'temperatura', nombre: 'Desvío térmico', color: ROJO }, { campo: 'cero', nombre: 'Referencia', color: '#82919d' }]} />
      <HistoricoMetricChart titulo="Lluvia anual" subtitulo="Diferencia porcentual" ventana={VENTANA_GRAFICOS.anio} datos={datos} unidad="%" series={[{ campo: 'lluvia', nombre: 'Desvío de lluvia', color: LLUVIA }, { campo: 'cero', nombre: 'Referencia', color: '#82919d' }]} />
    </div>
  </section>;
}

// Períodos por tramo en cada gráfico de series (después se recorre con las flechas del propio gráfico).
const VENTANA_GRAFICOS = { dia: 90, mes: 36, anio: 20 };

export default function HistoricoEstaciones({ publico = false, onError = sinError }) {
  const [estaciones, setEstaciones] = useState([]);
  const [id, setId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [serie, setSerie] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [rangoCargado, setRangoCargado] = useState(null);
  const [error, setError] = useState('');
  const [pagina, setPagina] = useState(0);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!publico) return undefined;
    const timer = setInterval(() => setRevision(r => r + 1), 15 * 60 * 1000);
    return () => clearInterval(timer);
  }, [publico]);

  useEffect(() => {
    let activo = true;
    getEstacionesHistoricas().then(({ estaciones: items }) => {
      if (!activo) return;
      const anterior = estaciones.find(e => e.id === id);
      const nueva = items.find(e => e.id === id);
      if (anterior?.hasta && nueva?.hasta && anterior.hasta !== nueva.hasta) {
        setHasta(actual => actual === anterior.hasta ? nueva.hasta : actual);
        if (publico) setDesde(actual => actual === restarAnios(anterior.hasta, 10) ? restarAnios(nueva.hasta, 10) : actual);
      }
      setEstaciones(items);
      if (items.length) setId(actual => actual || items[0].id);
    }).catch(e => { if (activo) { setError(e.message); onError(e.message); } });
    return () => { activo = false; };
  }, [onError, revision]);

  const estacion = estaciones.find(e => e.id === id);
  useEffect(() => {
    if (!estacion?.hasta) return;
    setHasta(estacion.hasta);
    setDesde(publico ? restarAnios(estacion.hasta, 10) : estacion.desde);
  }, [estacion?.id, publico]);

  useEffect(() => setPagina(0), [id, desde, hasta]);
  useEffect(() => {
    if (!id || !desde || !hasta || desde > hasta) return;
    let activo = true;
    setCargando(true);
    setError('');
    getSerieEstacionHistorica(id, desde, hasta)
      .then(r => { if (activo) { setSerie(r.serie); setRangoCargado({ id, desde, hasta }); } })
      .catch(e => { if (activo) { setError(e.message); onError(e.message); } })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [id, desde, hasta, onError, revision]);

  const analisis = useMemo(() => analizarHistorico(serie, rangoCargado?.desde, rangoCargado?.hasta), [serie, rangoCargado]);
  const provincia = (rangoCargado?.id || id) === 'toda_provincia';
  const periodos = analisis.periodos;
  const nombreEscala = { dia: 'día', mes: 'mes', anio: 'año' }[analisis.escala];
  const ventana = VENTANA_GRAFICOS[analisis.escala];
  const lluviaObservada = useMemo(() => serie.reduce((s, f) => s + (f.precipitacion ?? 0), 0), [serie]);
  const diasLluvia = useMemo(() => serie.filter(f => f.precipitacion >= 1).length, [serie]);
  const paginas = Math.max(1, Math.ceil(serie.length / 50));
  const filas = useMemo(() => serie.slice().reverse().slice(pagina * 50, (pagina + 1) * 50), [serie, pagina]);
  const columnasBase = publico ? CAMPOS_DIARIOS.filter(([campo]) => ['fecha', 'temperatura_maxima', 'temperatura_minima', 'precipitacion'].includes(campo)) : CAMPOS_DIARIOS;
  const columnas = provincia ? CAMPOS_DIARIOS.filter(([campo]) => ['fecha', 'temperatura_maxima', 'temperatura_minima', 'temperatura_media', 'precipitacion'].includes(campo)).map(([campo, nombre]) => [campo,
    campo === 'precipitacion' ? 'Lluvia suma de las zonas (mm)' : campo === 'fecha' ? nombre : `${nombre} (media de las zonas)`]) : columnasBase;
  const gruposGraficos = publico ? [['', provincia ? GRAFICOS_PUBLICOS.slice(0, 2) : GRAFICOS_PUBLICOS]] : [
    ['Temperatura', provincia ? [GRAFICOS_TECNICOS[0], GRAFICOS_TECNICOS[7]] : [GRAFICOS_TECNICOS[0], GRAFICOS_TECNICOS[3], GRAFICOS_TECNICOS[7]]],
    ['Precipitación', provincia ? [GRAFICOS_TECNICOS[1]] : GRAFICOS_TECNICOS.slice(1, 3).concat(GRAFICOS_TECNICOS.slice(4, 7))],
    ...(!provincia ? [['Otras variables atmosféricas', GRAFICOS_TECNICOS.slice(8)]] : []),
  ];
  const columnasPeriodos = ['Período', 'Cob. temp.', 'Cob. lluvia', 'Máx. media °C', 'Mín. media °C', provincia ? 'Suma de las zonas (mm)' : 'Lluvia mm',
    ...(!provincia ? ['Días ≥ 1 mm', 'R10', 'R20', 'Rx1 mm', 'CDD', 'CWD'] : [])];
  const filasPeriodos = periodos.map(p => [p.clave, `${formatoNumero(p.coberturaTemp)}%`, `${formatoNumero(p.coberturaLluvia)}%`,
    p.tmax, p.tmin, p.lluvia, ...(!provincia ? [p.diasLluvia, p.r10, p.r20, p.rx1, p.cdd, p.cwd] : [])].map((v, i) => i < 3 ? v : formatoNumero(v)));

  function rango(anios) {
    if (!estacion?.hasta) return;
    setDesde(anios === 0 ? estacion.desde : restarAnios(estacion.hasta, anios));
    setHasta(estacion.hasta);
  }

  function descargarCsv() {
    const encabezados = columnas.map(([campo, nombre]) => provincia ? nombre : campo).join(';');
    const cuerpo = serie.map(f => columnas.map(([campo]) => f[campo] ?? '').join(';')).join('\n');
    const blob = new Blob([`\uFEFF${encabezados}\n${cuerpo}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `historico-${id}-${desde}-${hasta}.csv`;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className={`historico-observatorio ${publico ? 'historico-observatorio--publico' : ''}`}>
    <header className="historico-observatorio__cabecera">
      <div>
        <h2>{publico ? 'Histórico del tiempo en Misiones' : 'Observatorio histórico de Misiones'}</h2>
        <p>{provincia ? 'Serie conjunta de las estaciones del norte, centro y sur.' : 'Datos diarios por estación.'} Elegí un período para explorar las series y consultar la tabla.</p>
      </div>
      {estacion && <div className="historico-observatorio__cobertura">{estacion.zona} · {estacion.nombre}<small>{estacion.desde} al {estacion.hasta}</small></div>}
    </header>

    <div className="historico-observatorio__controles">
      <label className="field"><span>Zona</span><select value={id} onChange={e => setId(e.target.value)}>
        {estaciones.map(e => <option key={e.id} value={e.id}>{e.zona} · {e.nombre}</option>)}
      </select></label>
      <CampoFecha label="Desde" value={desde} min={estacion?.desde || undefined} max={hasta || undefined} onChange={setDesde} />
      <CampoFecha label="Hasta" value={hasta} min={desde || undefined} max={new Date().toISOString().slice(0, 10)} onChange={setHasta} />
      <div className="historico-observatorio__atajos" aria-label="Períodos rápidos">
        <button type="button" onClick={() => rango(1)}>1 año</button>
        <button type="button" onClick={() => rango(10)}>10 años</button>
        <button type="button" onClick={() => rango(30)}>30 años</button>
        <button type="button" onClick={() => rango(0)}>Todo</button>
      </div>
    </div>
    {error && <p className="risk-message risk-message--error" role="alert">{error}</p>}
    {desde > hasta && <p className="risk-message risk-message--error" role="alert">La fecha inicial debe ser anterior a la final.</p>}
    {cargando && <p role="status">Actualizando el período…</p>}
    {rangoCargado && <>
      <div className="historico-observatorio__resumen">
        <div><strong><Numero valor={serie.length} /></strong><span>días con registro</span></div>
        <div><strong><Numero valor={lluviaObservada} decimales={1} sufijo=" mm" /></strong><span>{provincia ? 'suma de lluvia de las zonas' : 'lluvia observada'}</span></div>
        <div><strong><Numero valor={diasLluvia} /></strong><span>{provincia ? 'días con lluvia en alguna zona' : 'días con ≥ 1 mm'}</span></div>
        <div><strong>{nombreEscala}</strong><span>escala de los gráficos</span></div>
      </div>
      <p className="historico-observatorio__nota">Los gráficos cambian automáticamente entre días, meses y años según el rango. Los acumulados y promedios de un período solo se trazan con al menos {coberturaMinima * 100}% de días válidos para esa variable; la tabla conserva cada observación disponible.</p>
      {provincia && <p className="historico-observatorio__aviso">“Toda la provincia” suma la precipitación y promedia las temperaturas de las estaciones que existían en cada fecha, siempre que todas hayan informado ese día: Iguazú y Posadas desde 1961, y Bernardo de Irigoyen desde 1984. Antes de 1984 la serie combina solo esas dos estaciones, así que los totales de lluvia de antes y después de 1984 no son directamente comparables. La suma en mm compara puntos de observación; no representa la lluvia areal ni el volumen de agua caído sobre toda Misiones.</p>}
      {gruposGraficos.map(([grupo, graficos]) => <section className="historico-observatorio__grupo" key={grupo || 'publico'}>
        {grupo && <h3>{grupo}</h3>}
        <div className="historico-observatorio__graficos">
          {graficos.map(g => <HistoricoMetricChart key={g.titulo} titulo={provincia && g.series[0]?.campo === 'lluvia' ? 'Suma de lluvia de las zonas' : g.titulo} subtitulo={`Por ${nombreEscala}`} datos={periodos} ventana={ventana}
            series={g.series} unidad={g.unidad} tipo={g.tipo} />)}
        </div>
      </section>)}
      {!publico && !provincia && <RosaVientos filas={serie} nombre={estacion?.nombre || ''} />}
      {!publico && <GraficoPersonalizado ventana={ventana} datos={periodos} provincia={provincia} zona={estacion?.zona || ''} desde={desde} hasta={hasta} />}
      {!publico && analisis.ciclo?.some(m => m.mesesTemp >= 10 || m.mesesLluvia >= 10) && <section className="historico-observatorio__comparacion">
        <h3>Ciclo anual medio del período elegido</h3>
        <p className="historico-observatorio__nota">Promedio por mes calendario calculado con los meses que alcanzan 90% de cobertura. Es descriptivo del rango seleccionado.</p>
        <div className="historico-observatorio__graficos">
          <HistoricoMetricChart titulo="Temperatura media por mes" subtitulo="Promedio del rango" datos={analisis.ciclo.filter(m => m.mesesTemp >= 10)} series={[{ campo: 'tmedia', nombre: 'Media', color: ROJO }]} unidad="°C" ciclo />
          <HistoricoMetricChart titulo="Lluvia media por mes" subtitulo="Promedio del rango" datos={analisis.ciclo.filter(m => m.mesesLluvia >= 10)} series={[{ campo: 'lluvia', nombre: 'Acumulado medio', color: LLUVIA }]} unidad="mm" tipo="barra" ciclo />
        </div>
      </section>}
      {!publico && <ComparacionZonas desde={desde} hasta={hasta} />}
      {!publico && !provincia && <AnomaliasHistoricas estacionId={id} anuales={analisis.anuales} />}
      {!publico && <details className="historico-observatorio__metodo">
        <summary>Definiciones y cobertura</summary>
        <p>R10 y R20 cuentan días con al menos 10 y 20 mm. Rx1 es la lluvia máxima de un día. CDD y CWD son las rachas máximas de días consecutivos con menos de 1 mm y al menos 1 mm. SDII es el acumulado de días lluviosos dividido por el número de esos días. La amplitud térmica es máxima menos mínima del mismo día.</p>
        <p>El umbral de 90% es una regla de visualización de este panel. Las cifras son resúmenes descriptivos de observaciones originales: no se han homogeneizado ni corregido, y no deben citarse como normales climatológicas oficiales.</p>
        <p>Referencias: <a href="https://www.climdex.org/learn/indices/" target="_blank" rel="noreferrer">índices Climdex / ETCCDI</a> y <a href="https://wmo.int/wmo-climatological-normals" target="_blank" rel="noreferrer">normales climatológicas de la OMM</a>.</p>
      </details>}
      {!publico && <section className="historico-observatorio__periodos">
        <div className="historico-observatorio__tabla-header"><h3>Resumen por {nombreEscala}</h3><BotonTablaPdf titulo={`Resumen por ${nombreEscala} · ${estacion?.zona} · ${desde} a ${hasta}`} columnas={columnasPeriodos} filas={filasPeriodos} disabled={!filasPeriodos.length} /></div>
        <div className="historico-tabla-scroll"><table className="historico-tabla">
          <thead><tr><th>Período</th><th>Cob. temp.</th><th>Cob. lluvia</th><th>Máx. media °C</th><th>Mín. media °C</th><th>{provincia ? 'Suma de las zonas (mm)' : 'Lluvia mm'}</th>
            {!provincia && <><th>Días ≥ 1 mm</th><th>R10</th><th>R20</th><th>Rx1 mm</th><th>CDD</th><th>CWD</th></>}</tr></thead>
          <tbody>{periodos.map(p => <tr key={p.clave}>{[
            p.clave, `${formatoNumero(p.coberturaTemp)}%`, `${formatoNumero(p.coberturaLluvia)}%`,
            p.tmax, p.tmin, p.lluvia, ...(!provincia ? [p.diasLluvia, p.r10, p.r20, p.rx1, p.cdd, p.cwd] : []),
          ].map((v, i) => <td key={i}>{i < 3 ? v : formatoNumero(v)}</td>)}</tr>)}</tbody>
        </table></div>
      </section>}
      <div className="historico-observatorio__tabla-header"><h3>Observaciones diarias</h3><div>
        <span>{serie.length.toLocaleString('es-AR')} filas · 50 por página</span>
        {!publico && <button type="button" className="btn" disabled={!serie.length} onClick={descargarCsv}>Descargar CSV del rango</button>}
        <BotonTablaPdf titulo={`Observaciones diarias · ${estacion?.zona} · ${desde} a ${hasta}`} columnas={columnas.map(([, nombre]) => nombre)} filas={serie.map(f => columnas.map(([campo]) => campo === 'fecha' ? f.fecha : formatoNumero(f[campo])))} disabled={!serie.length} />
      </div></div>
      <div className="historico-tabla-scroll"><table className="historico-tabla">
        <thead><tr>{columnas.map(([, nombre]) => <th key={nombre} scope="col">{nombre}</th>)}</tr></thead>
        <tbody>{filas.map(f => <tr key={f.fecha}>{columnas.map(([campo]) => <td key={campo}>{campo === 'fecha' ? f.fecha : formatoNumero(f[campo])}</td>)}</tr>)}</tbody>
      </table></div>
      {serie.length === 0 && <p role="status">No hay observaciones para la zona y el período elegidos.</p>}
      {serie.length > 50 && <div className="historico-paginacion">
        <button type="button" className="btn" disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>Más recientes</button>
        <span>Página {pagina + 1} de {paginas}</span>
        <button type="button" className="btn" disabled={pagina >= paginas - 1} onClick={() => setPagina(p => p + 1)}>Más antiguos</button>
      </div>}
      <p className="historico-observatorio__credito">Gráficos adaptados de <a href="https://rosencharts.com/" target="_blank" rel="noreferrer">Rosen Charts</a>.</p>
    </>}
  </section>;
}
