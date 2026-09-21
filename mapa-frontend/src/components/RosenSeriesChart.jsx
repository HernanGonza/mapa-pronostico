import { useEffect, useMemo, useRef, useState } from 'react';
import { area, line, scaleLinear, scaleUtc } from 'd3';
import AnimatedPath from './AnimatedPath';

// Adaptación de Rosen Charts para series meteorológicas y datos faltantes.
// Fuente: https://rosencharts.com/r/line-charts.json
function useAncho(ref) {
  const [ancho, setAncho] = useState(620);
  useEffect(() => {
    if (!ref.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setAncho(Math.max(250, Math.round(entry.contentRect.width))));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return ancho;
}

const numero = value => Number(value).toLocaleString('es-AR', { maximumFractionDigits: 1 });
const fechaCorta = date => new Intl.DateTimeFormat('es-AR', { year: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);

// Ciclo anual (12 meses promedio, sin año real): el eje y el detalle muestran sólo el mes.
const soloMes = date => new Intl.DateTimeFormat('es-AR', { month: 'short', timeZone: 'UTC' }).format(date).replace('.', '');
const mesLargo = fecha => new Intl.DateTimeFormat('es-AR', { month: 'long', timeZone: 'UTC' }).format(new Date(`${fecha}T00:00:00Z`));

export default function RosenSeriesChart({ datos, series, vista = 'linea', unidad = '', height = 230, ciclo = false }) {
  const ref = useRef(null);
  const ancho = useAncho(ref);
  const [indiceActivo, setIndiceActivo] = useState(null);
  const filas = useMemo(() => datos.map(d => ({ ...d, instante: Date.parse(`${d.fecha}T00:00:00Z`) }))
    .filter(d => Number.isFinite(d.instante)).sort((a, b) => a.instante - b.instante), [datos]);
  const valores = filas.flatMap(d => series.map(s => d[s.campo]).filter(Number.isFinite));
  const hayDatos = valores.length > 0;
  const margen = { arriba: 15, derecha: 13, abajo: 28, izquierda: 47 };
  const w = Math.max(1, ancho - margen.izquierda - margen.derecha);
  const h = Math.max(1, height - margen.arriba - margen.abajo);
  const inicio = filas[0]?.instante ?? Date.now();
  const fin = filas.at(-1)?.instante ?? inicio + 86400000;
  const x = scaleUtc().domain(inicio === fin ? [new Date(inicio - 43200000), new Date(fin + 43200000)] : [new Date(inicio), new Date(fin)]).range([0, w]);
  const minimo = Math.min(0, ...valores);
  const maximo = Math.max(0, ...valores);
  const y = scaleLinear().domain(minimo === maximo ? [minimo - 1, maximo + 1] : [minimo, maximo]).nice(4).range([h, 0]);
  const ticksX = ciclo ? filas.map(d => new Date(d.instante)).filter((_, i) => w >= 480 || i % 2 === 0) : x.ticks(Math.min(6, Math.max(2, Math.floor(w / 95))));
  const ticksY = y.ticks(4);
  const barra = Math.max(1, Math.min(36, w / Math.max(filas.length, 1) * 0.74));
  const activo = indiceActivo == null ? null : filas[indiceActivo];

  if (!hayDatos) return <p className="historico-metrica__vacio">Sin cobertura suficiente en este período.</p>;

  return <div ref={ref} className="rosen-chart">
    <svg width="100%" height={height} viewBox={`0 0 ${ancho} ${height}`} role="img" aria-label={`Gráfico de ${vista} con ${filas.length} períodos`}>
      <g transform={`translate(${margen.izquierda},${margen.arriba})`}>
        {ticksY.map(t => <g key={t} transform={`translate(0,${y(t)})`}>
          <line x2={w} className="rosen-chart__grid" />
          <text x={-8} dy="0.35em" textAnchor="end" className="rosen-chart__axis">{numero(t)}</text>
        </g>)}
        {ticksX.map(t => <text key={+t} x={x(t)} y={h + 21} textAnchor="middle" className="rosen-chart__axis">{ciclo ? soloMes(t) : fechaCorta(t)}</text>)}
        {series.map(s => {
          const definida = d => Number.isFinite(d[s.campo]);
          const trayectoria = line().defined(definida).x(d => x(new Date(d.instante))).y(d => y(d[s.campo]))(filas);
          const superficie = area().defined(definida).x(d => x(new Date(d.instante))).y0(y(0)).y1(d => y(d[s.campo]))(filas);
          return <g key={s.campo}>
            <AnimatedPath d={superficie || ''} fill={s.color} opacity={vista === 'area' ? 0.18 : 0} className="rosen-chart__dato" />
            <AnimatedPath d={trayectoria || ''} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" opacity={['linea', 'area'].includes(vista) ? 1 : 0} className="rosen-chart__dato" />
            {filas.filter(definida).map(d => <circle key={d.fecha} cx={x(new Date(d.instante))} cy={y(d[s.campo])} r="2.7" fill={s.color} opacity={vista === 'puntos' ? 1 : 0} className="rosen-chart__dato" />)}
            {filas.filter(definida).map(d => <rect key={d.fecha} x={x(new Date(d.instante)) - barra / 2} y={Math.min(y(0), y(d[s.campo]))} width={barra} height={Math.max(1, Math.abs(y(0) - y(d[s.campo])))} fill={s.color} opacity={vista === 'barra' ? 0.86 : 0} className="rosen-chart__dato" />)}
          </g>;
        })}
        {activo && <line x1={x(new Date(activo.instante))} x2={x(new Date(activo.instante))} y2={h} className="rosen-chart__cursor" />}
        <rect width={w} height={h} fill="transparent" onPointerLeave={() => setIndiceActivo(null)} onPointerMove={e => {
          const caja = e.currentTarget.getBoundingClientRect();
          const fecha = +x.invert((e.clientX - caja.left) / caja.width * w);
          let indice = 0;
          while (indice < filas.length - 1 && Math.abs(filas[indice + 1].instante - fecha) < Math.abs(filas[indice].instante - fecha)) indice++;
          setIndiceActivo(indice);
        }} />
      </g>
    </svg>
    <p className="historico-metrica__detalle">{activo ? `${ciclo ? mesLargo(activo.fecha) : activo.fecha} · ${series.filter(s => Number.isFinite(activo[s.campo])).map(s => `${s.nombre}: ${numero(activo[s.campo])} ${unidad}`).join(' · ')}` : 'Pasá el cursor sobre el gráfico para ver valores.'}</p>
  </div>;
}
