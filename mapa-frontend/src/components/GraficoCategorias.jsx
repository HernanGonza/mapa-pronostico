import { useRef, useState } from 'react';
import { arc, pie, scaleLinear } from 'd3';
import BotonPdf from './BotonPdf';

const COLORES = ['#358a75', '#e7a142', '#567eb5', '#aa719b', '#dd7162', '#7f9160', '#7b76bd', '#c79255'];
const OPCIONES = { barras: 'Barras', dona: 'Anillo', embudo: 'Embudo', tabla: 'Tabla' };

export default function GraficoCategorias({ titulo, filas }) {
  const exportRef = useRef(null);
  const clave = `historico-categorias:${titulo}`;
  const [vista, setVista] = useState(() => {
    try { return OPCIONES[localStorage.getItem(clave)] ? localStorage.getItem(clave) : 'barras'; }
    catch { return 'barras'; }
  });
  const total = filas.reduce((s, d) => s + d.cantidad, 0);
  const anchoBarra = scaleLinear().domain([0, Math.max(1, ...filas.map(d => d.cantidad))]).range([0, 100]);
  // Adaptación del gráfico de anillo de Rosen Charts a categorías dinámicas.
  // https://rosencharts.com/r/donut-charts.json
  const sectores = pie().value(d => d.cantidad).sort(null).padAngle(0.015)(filas);
  const dibujarArco = arc().innerRadius(48).outerRadius(73).cornerRadius(2);

  return <div ref={exportRef} className="historico-card historico-categorias">
    <div className="historico-categorias__header"><h2>{titulo}</h2><BotonPdf elementoRef={exportRef} titulo={titulo} /><label>
      <select value={vista} aria-label={`Tipo de gráfico para ${titulo}`} onChange={e => {
        setVista(e.target.value);
        try { localStorage.setItem(clave, e.target.value); } catch { /* almacenamiento opcional */ }
      }}>
        {Object.entries(OPCIONES).map(([valor, nombre]) => <option key={valor} value={valor}>{nombre}</option>)}
      </select>
    </label></div>
    {!filas.length ? <p className="admin-panel__hint">Sin datos todavía.</p> : vista === 'barras' ?
      <ul className="historico-barras">
        {filas.map((d, i) => <li key={d.etiqueta}>
          <span title={d.etiqueta}>{d.etiqueta}</span>
          <div className="historico-barra"><div style={{ width: `${anchoBarra(d.cantidad)}%`, background: COLORES[i % COLORES.length] }} /></div>
          <span>{d.cantidad}</span>
        </li>)}
      </ul> : vista === 'dona' ?
      <div className="historico-categorias__dona">
        <svg className="historico-categorias__anillo" viewBox="-85 -85 170 170" role="img" aria-label={`${titulo}: ${filas.map(d => `${d.etiqueta} ${d.cantidad}`).join(', ')}`}>
          {sectores.map((d, i) => <path key={d.data.etiqueta} d={dibujarArco(d)} fill={COLORES[i % COLORES.length]} />)}
          <text textAnchor="middle" y="1" className="historico-categorias__total">{total}</text>
          <text textAnchor="middle" y="18" className="historico-categorias__total-etiqueta">eventos</text>
        </svg>
        <ul className="historico-categorias__leyenda">{filas.map((d, i) => <li key={d.etiqueta}><i style={{ background: COLORES[i % COLORES.length] }} /><span>{d.etiqueta}</span><b>{d.cantidad}</b></li>)}</ul>
      </div> : vista === 'embudo' ?
      <div className="historico-categorias__embudo" aria-label={`${titulo}, ordenado por cantidad`}>
        {[...filas].sort((a, b) => b.cantidad - a.cantidad).map((d, i) => <div key={d.etiqueta} style={{ width: `${Math.max(42, anchoBarra(d.cantidad))}%`, background: COLORES[i % COLORES.length] }} title={`${d.etiqueta}: ${d.cantidad}`}><span>{d.etiqueta}</span><b>{d.cantidad}</b></div>)}
      </div> :
      <table className="historico-tabla"><thead><tr><th>Categoría</th><th>Eventos</th><th>Porcentaje</th></tr></thead><tbody>
        {filas.map(d => <tr key={d.etiqueta}><td>{d.etiqueta}</td><td>{d.cantidad}</td><td>{(d.cantidad / total * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %</td></tr>)}
      </tbody></table>}
  </div>;
}
