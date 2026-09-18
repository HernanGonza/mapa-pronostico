import { useEffect, useRef, useState } from 'react';
import { exportarImagenPdf } from '../lib/exportarPdf';

export default function Grafico3D({ datos, x, y, z, titulo }) {
  const ref = useRef(null);
  const plotlyRef = useRef(null);
  const [plotly, setPlotly] = useState(null);
  const [error, setError] = useState('');
  const [exportando, setExportando] = useState(false);
  const filas = datos.filter(d => [x, y, z].every(v => Number.isFinite(d[v.campo])));
  useEffect(() => {
    let activo = true;
    import('plotly.js-gl3d-dist-min').then(mod => { if (activo) setPlotly(() => mod.default || mod); })
      .catch(e => { if (activo) setError(e.message); });
    return () => { activo = false; if (plotlyRef.current && ref.current) plotlyRef.current.purge(ref.current); };
  }, []);
  useEffect(() => {
    if (!plotly || !ref.current || !filas.length) return;
    plotlyRef.current = plotly;
    const color = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#21130d';
    plotly.react(ref.current, [{
        type: 'scatter3d', mode: 'markers',
        x: filas.map(d => d[x.campo]), y: filas.map(d => d[y.campo]), z: filas.map(d => d[z.campo]),
        text: filas.map(d => d.clave || d.fecha), hovertemplate: '%{text}<br>X: %{x}<br>Y: %{y}<br>Z: %{z}<extra></extra>',
        marker: { size: 4, color: filas.map(d => d[z.campo]), colorscale: 'Viridis', opacity: 0.8 },
      }], {
        autosize: true, height: 370, margin: { l: 0, r: 0, b: 0, t: 0 },
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color },
        scene: { xaxis: { title: `${x.nombre} (${x.unidad})`, color }, yaxis: { title: `${y.nombre} (${y.unidad})`, color }, zaxis: { title: `${z.nombre} (${z.unidad})`, color } },
        uirevision: 'historico-3d',
      }, { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['toImage'] });
  }, [plotly, datos, x, y, z]);
  return <div className="historico-3d">
    <div className="historico-3d__acciones"><span>{filas.length.toLocaleString('es-AR')} períodos con las tres variables · arrastrá para girar</span>
      <button type="button" disabled={exportando || !filas.length} onClick={async () => {
        if (!plotlyRef.current || !ref.current) return;
        setExportando(true); setError('');
        try {
          const imagen = await plotlyRef.current.toImage(ref.current, { format: 'png', width: 1200, height: 760 });
          await exportarImagenPdf(imagen, titulo);
        } catch (e) { setError(e.message || 'No se pudo generar el PDF'); }
        finally { setExportando(false); }
      }}>{exportando ? 'Generando…' : 'Exportar PDF'}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <div ref={ref} className="historico-3d__lienzo" style={{ display: filas.length ? undefined : 'none' }} />
    {!filas.length && <p className="historico-metrica__vacio">No hay períodos con las tres variables disponibles.</p>}
  </div>;
}
