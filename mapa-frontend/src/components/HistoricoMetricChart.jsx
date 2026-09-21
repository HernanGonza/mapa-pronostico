import { useRef, useState } from 'react';
import RosenSeriesChart from './RosenSeriesChart';
import BotonPdf from './BotonPdf';

export default function HistoricoMetricChart({ titulo, subtitulo, datos, series, unidad = '', tipo = 'linea', ciclo = false }) {
  const exportRef = useRef(null);
  const clave = `historico-grafico:${titulo}:${subtitulo}:${series.map(s => s.campo).join(',')}`;
  const opciones = series.length === 1 ? ['linea', 'barra', 'area', 'puntos'] : ['linea', 'area', 'puntos'];
  const [vista, setVista] = useState(() => {
    try { const guardada = localStorage.getItem(clave); return opciones.includes(guardada) ? guardada : tipo; }
    catch { return tipo; }
  });
  return <section ref={exportRef} className="historico-metrica" aria-label={titulo}>
    <div className="historico-metrica__header"><h3>{titulo}</h3><div><span>{subtitulo}</span><label>
      <select value={vista} onChange={e => {
        setVista(e.target.value);
        try { localStorage.setItem(clave, e.target.value); } catch { /* almacenamiento opcional */ }
      }} aria-label={`Tipo de gráfico para ${titulo}`}>
        {opciones.map(opcion => <option key={opcion} value={opcion}>{({ linea: 'Líneas', barra: 'Barras', area: 'Área', puntos: 'Puntos' })[opcion]}</option>)}
      </select>
    </label><BotonPdf elementoRef={exportRef} titulo={`${titulo} · ${subtitulo}`} /></div></div>
    <div className="historico-metrica__leyenda">{series.map(s => <span key={s.campo}><i style={{ background: s.color }} />{s.nombre}</span>)}</div>
    <RosenSeriesChart datos={datos} series={series} vista={vista} unidad={unidad} ciclo={ciclo} />
  </section>;
}
