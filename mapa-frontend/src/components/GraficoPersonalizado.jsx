import { useMemo, useRef, useState } from 'react';
import RosenSeriesChart from './RosenSeriesChart';
import RosenScatterChart from './RosenScatterChart';
import BotonPdf from './BotonPdf';
import BotonTablaPdf from './BotonTablaPdf';
import Grafico3D from './Grafico3D';

const VARIABLES = [
  { campo: 'tmax', nombre: 'Temperatura máxima media', unidad: '°C', color: '#dd6175' },
  { campo: 'tmin', nombre: 'Temperatura mínima media', unidad: '°C', color: '#5aa8e8' },
  { campo: 'tmedia', nombre: 'Temperatura media', unidad: '°C', color: '#79ac7b' },
  { campo: 'dtr', nombre: 'Amplitud térmica', unidad: '°C', color: '#ab85c4' },
  { campo: 'lluvia', nombre: 'Precipitación acumulada', unidad: 'mm', color: '#1688b0' },
  { campo: 'rx1', nombre: 'Máxima lluvia diaria', unidad: 'mm', color: '#4980c2' },
  { campo: 'diasLluvia', nombre: 'Días con lluvia', unidad: 'días', color: '#1688b0' },
  { campo: 'r10', nombre: 'Días ≥ 10 mm', unidad: 'días', color: '#608ab1' },
  { campo: 'r20', nombre: 'Días ≥ 20 mm', unidad: 'días', color: '#7663a1' },
  { campo: 'cdd', nombre: 'Racha seca', unidad: 'días', color: '#b98316' },
  { campo: 'cwd', nombre: 'Racha lluviosa', unidad: 'días', color: '#548561' },
  { campo: 'humedad', nombre: 'Humedad relativa', unidad: '%', color: '#4e90be' },
  { campo: 'viento', nombre: 'Viento medio', unidad: 'm/s', color: '#5172ab' },
  { campo: 'heliofania', nombre: 'Heliofanía', unidad: 'h', color: '#b98316' },
  { campo: 'nubosidad', nombre: 'Nubosidad', unidad: 'octavos', color: '#7663a1' },
  { campo: 'presion', nombre: 'Presión en estación', unidad: 'hPa', color: '#548561' },
];

export default function GraficoPersonalizado({ datos, provincia, zona, desde, hasta }) {
  const ref = useRef(null);
  const disponibles = useMemo(() => VARIABLES.filter(v => !provincia || ['tmax', 'tmin', 'tmedia', 'lluvia'].includes(v.campo)), [provincia]);
  const [tipo, setTipo] = useState('linea');
  const [campoX, setCampoX] = useState('tmax');
  const [campoY, setCampoY] = useState('tmin');
  const [campoTamano, setCampoTamano] = useState('lluvia');
  const [campoSegundo, setCampoSegundo] = useState('');
  const variableX = disponibles.find(v => v.campo === campoX) || disponibles[0];
  const variableY = disponibles.find(v => v.campo === campoY) || disponibles[1];
  const variableTamano = disponibles.find(v => v.campo === campoTamano) || disponibles[0];
  const segundo = disponibles.find(v => v.campo === campoSegundo && v.unidad === variableX.unidad);
  const tresD = tipo === 'dispersion3d';
  const disperso = tipo === 'dispersion' || tipo === 'burbujas' || tresD;
  const columnas = disperso ? [variableX, variableY, ...(['burbujas', 'dispersion3d'].includes(tipo) ? [variableTamano] : [])] : [variableX, ...(tipo !== 'barra' && segundo ? [segundo] : [])];
  const filas = datos.map(d => [d.clave || d.fecha, ...columnas.map(v => Number.isFinite(d[v.campo]) ? d[v.campo] : '')]);
  const titulo = `Gráfico personalizado · ${zona} · ${desde} a ${hasta}`;

  return <section className="historico-observatorio__personalizado">
    <div className="historico-observatorio__tabla-header"><h3>Armá tu gráfico</h3><BotonTablaPdf titulo={`Datos del gráfico personalizado · ${zona} · ${desde} a ${hasta}`} columnas={['Período', ...columnas.map(v => `${v.nombre} (${v.unidad})`)]} filas={filas} disabled={!filas.length} /></div>
    <div className="historico-observatorio__controles historico-personalizado__controles">
      <label className="field"><span>Tipo</span><select value={tipo} onChange={e => setTipo(e.target.value)}><option value="linea">Líneas</option><option value="area">Área</option><option value="barra">Barras</option><option value="puntos">Puntos</option><option value="dispersion">Dispersión</option><option value="burbujas">Burbujas</option><option value="dispersion3d">Dispersión 3D</option></select></label>
      <label className="field"><span>{disperso ? 'Eje X' : 'Variable'}</span><select value={variableX.campo} onChange={e => { setCampoX(e.target.value); setCampoSegundo(''); }}>{disponibles.map(v => <option key={v.campo} value={v.campo}>{v.nombre} ({v.unidad})</option>)}</select></label>
      {disperso ? <>
        <label className="field"><span>Eje Y</span><select value={variableY.campo} onChange={e => setCampoY(e.target.value)}>{disponibles.map(v => <option key={v.campo} value={v.campo}>{v.nombre} ({v.unidad})</option>)}</select></label>
        {['burbujas', 'dispersion3d'].includes(tipo) && <label className="field"><span>{tresD ? 'Eje Z' : 'Tamaño'}</span><select value={variableTamano.campo} onChange={e => setCampoTamano(e.target.value)}>{disponibles.filter(v => tresD || v.unidad !== '°C').map(v => <option key={v.campo} value={v.campo}>{v.nombre} ({v.unidad})</option>)}</select></label>}
      </> : tipo !== 'barra' && <label className="field"><span>Segunda variable (misma unidad)</span><select value={segundo?.campo || ''} onChange={e => setCampoSegundo(e.target.value)}><option value="">Ninguna</option>{disponibles.filter(v => v.campo !== variableX.campo && v.unidad === variableX.unidad).map(v => <option key={v.campo} value={v.campo}>{v.nombre}</option>)}</select></label>}
    </div>
    <div ref={ref} className="historico-metrica historico-personalizado__resultado">
      <div className="historico-metrica__header"><h3>{tresD ? `${variableX.nombre}, ${variableY.nombre} y ${variableTamano.nombre}` : disperso ? `${variableY.nombre} y ${variableX.nombre}` : columnas.map(v => v.nombre).join(' y ')}</h3>{!tresD && <BotonPdf elementoRef={ref} titulo={titulo} />}</div>
      {!disperso && <div className="historico-metrica__leyenda">{columnas.map(v => <span key={v.campo}><i style={{ background: v.color }} />{v.nombre} ({v.unidad})</span>)}</div>}
      {tresD ? <Grafico3D datos={datos} x={variableX} y={variableY} z={variableTamano} titulo={titulo} /> : disperso ? <RosenScatterChart datos={datos} xCampo={variableX.campo} yCampo={variableY.campo} tamanoCampo={tipo === 'burbujas' ? variableTamano.campo : null} xNombre={`${variableX.nombre} (${variableX.unidad})`} yNombre={`${variableY.nombre} (${variableY.unidad})`} tamanoNombre={variableTamano.nombre} /> :
        <RosenSeriesChart datos={datos} series={columnas.map(v => ({ campo: v.campo, nombre: v.nombre, color: v.color }))} vista={tipo} unidad={variableX.unidad} height={280} />}
    </div>
  </section>;
}
