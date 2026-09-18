import { useEffect, useMemo, useRef, useState } from 'react';
import { scaleLinear, scaleSqrt } from 'd3';

// Adaptación de los gráficos scatter y bubble de Rosen Charts.
// https://rosencharts.com/r/scatter-charts.json
export default function RosenScatterChart({ datos, xCampo, yCampo, tamanoCampo, xNombre, yNombre, tamanoNombre }) {
  const ref = useRef(null);
  const [ancho, setAncho] = useState(620);
  useEffect(() => {
    if (!ref.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setAncho(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const filas = useMemo(() => datos.filter(d => Number.isFinite(d[xCampo]) && Number.isFinite(d[yCampo])), [datos, xCampo, yCampo]);
  if (!filas.length) return <p className="historico-metrica__vacio">No hay períodos con ambas variables disponibles.</p>;
  const alto = 260;
  const m = { l: 48, r: 18, t: 16, b: 34 };
  const w = ancho - m.l - m.r;
  const h = alto - m.t - m.b;
  const xs = filas.map(d => d[xCampo]);
  const ys = filas.map(d => d[yCampo]);
  const escalaX = scaleLinear().domain([Math.min(...xs), Math.max(...xs)]).nice().range([0, w]);
  const escalaY = scaleLinear().domain([Math.min(...ys), Math.max(...ys)]).nice().range([h, 0]);
  const tamanos = tamanoCampo ? filas.map(d => Math.max(0, d[tamanoCampo] || 0)) : [];
  const radio = scaleSqrt().domain([0, Math.max(1, ...tamanos)]).range([3, 12]);
  return <div ref={ref} className="rosen-chart">
    <svg width="100%" height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={`Dispersión de ${yNombre} respecto de ${xNombre}`}>
      <g transform={`translate(${m.l},${m.t})`}>
        {escalaY.ticks(4).map(t => <g key={t} transform={`translate(0,${escalaY(t)})`}><line x2={w} className="rosen-chart__grid" /><text x="-8" dy=".35em" textAnchor="end" className="rosen-chart__axis">{t.toLocaleString('es-AR')}</text></g>)}
        {escalaX.ticks(5).map(t => <text key={t} x={escalaX(t)} y={h + 18} textAnchor="middle" className="rosen-chart__axis">{t.toLocaleString('es-AR')}</text>)}
        {filas.map(d => <circle key={d.fecha} cx={escalaX(d[xCampo])} cy={escalaY(d[yCampo])} r={tamanoCampo ? radio(Math.max(0, d[tamanoCampo] || 0)) : 4} fill="#1688b0" opacity=".62" className="rosen-chart__dato">
          <title>{d.clave || d.fecha}: {xNombre} {d[xCampo]}; {yNombre} {d[yCampo]}{tamanoCampo ? `; ${tamanoNombre} ${d[tamanoCampo] ?? 'sin dato'}` : ''}</title>
        </circle>)}
        <text x={w / 2} y={h + 32} textAnchor="middle" className="rosen-chart__axis">{xNombre}</text>
      </g>
    </svg>
    <p className="historico-metrica__detalle">{filas.length.toLocaleString('es-AR')} períodos con ambas variables · eje vertical: {yNombre}{tamanoCampo ? ` · tamaño: ${tamanoNombre}` : ''}</p>
  </div>;
}
