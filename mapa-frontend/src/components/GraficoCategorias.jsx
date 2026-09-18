import { useState } from 'react';

const COLORES = ['#358a75', '#e7a142', '#567eb5', '#aa719b', '#dd7162', '#7f9160', '#7b76bd', '#c79255'];
const OPCIONES = { barras: 'Barras', dona: 'Anillo', tabla: 'Tabla' };

export default function GraficoCategorias({ titulo, filas }) {
  const clave = `historico-categorias:${titulo}`;
  const [vista, setVista] = useState(() => {
    try { return OPCIONES[localStorage.getItem(clave)] ? localStorage.getItem(clave) : 'barras'; }
    catch { return 'barras'; }
  });
  const total = filas.reduce((s, d) => s + d.cantidad, 0);
  const maximo = Math.max(1, ...filas.map(d => d.cantidad));
  let acumulado = 0;
  const sectores = filas.map((d, i) => {
    const inicio = acumulado;
    acumulado += total ? d.cantidad / total * 100 : 0;
    return `${COLORES[i % COLORES.length]} ${inicio}% ${acumulado}%`;
  });

  return <div className="historico-card historico-categorias">
    <div className="historico-categorias__header"><h2>{titulo}</h2><label>
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
          <div className="historico-barra"><div style={{ width: `${d.cantidad / maximo * 100}%`, background: COLORES[i % COLORES.length] }} /></div>
          <span>{d.cantidad}</span>
        </li>)}
      </ul> : vista === 'dona' ?
      <div className="historico-categorias__dona">
        <div className="historico-categorias__anillo" style={{ background: `conic-gradient(${sectores.join(', ')})` }} role="img" aria-label={`${titulo}: ${filas.map(d => `${d.etiqueta} ${d.cantidad}`).join(', ')}`}>
          <div><strong>{total}</strong><small>eventos</small></div>
        </div>
        <ul className="historico-categorias__leyenda">{filas.map((d, i) => <li key={d.etiqueta}><i style={{ background: COLORES[i % COLORES.length] }} /><span>{d.etiqueta}</span><b>{d.cantidad}</b></li>)}</ul>
      </div> :
      <table className="historico-tabla"><thead><tr><th>Categoría</th><th>Eventos</th><th>Porcentaje</th></tr></thead><tbody>
        {filas.map(d => <tr key={d.etiqueta}><td>{d.etiqueta}</td><td>{d.cantidad}</td><td>{(d.cantidad / total * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %</td></tr>)}
      </tbody></table>}
  </div>;
}
