import { useEffect, useMemo, useState } from 'react';
import { area, line, scaleLinear, scaleUtc } from 'd3';
import AnimatedPath from './AnimatedPath';

// Adaptación de Rosen Charts para series meteorológicas y datos faltantes.
// Fuente: https://rosencharts.com/r/line-charts.json
// Devuelve [ref, ancho]. `ref` es un callback ref: si el nodo medido se desmonta y vuelve a montarse
// (p. ej. al paginar), el observer se re-engancha solo en vez de quedar pegado a un nodo muerto.
function useAncho() {
  const [nodo, setNodo] = useState(null);
  const [ancho, setAncho] = useState(620);
  useEffect(() => {
    if (!nodo) return undefined;
    const medir = () => setAncho(Math.max(250, Math.round(nodo.getBoundingClientRect().width)));
    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(nodo);
    return () => observer.disconnect();
  }, [nodo]);
  return [setNodo, ancho];
}

const numero = value => Number(value).toLocaleString('es-AR', { maximumFractionDigits: 1 });
const fechaCorta = date => new Intl.DateTimeFormat('es-AR', { year: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);

// Ciclo anual (12 meses promedio, sin año real): el eje y el detalle muestran sólo el mes.
const soloMes = date => new Intl.DateTimeFormat('es-AR', { month: 'short', timeZone: 'UTC' }).format(date).replace('.', '');
const mesLargo = fecha => new Intl.DateTimeFormat('es-AR', { month: 'long', timeZone: 'UTC' }).format(new Date(`${fecha}T00:00:00Z`));

export default function RosenSeriesChart({ datos, series, vista = 'linea', unidad = '', height = 230, ciclo = false }) {
  const [ref, ancho] = useAncho();
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
  const barra = Math.max(1, Math.min(36, w / Math.max(filas.length, 1) * 0.74));
  // Las barras se centran en su fecha: sin este margen la primera/última se salen del área y tapan el eje vertical.
  const margenBarras = vista === 'barra' ? barra / 2 + 2 : 0;
  const x = scaleUtc().domain(inicio === fin ? [new Date(inicio - 43200000), new Date(fin + 43200000)] : [new Date(inicio), new Date(fin)]).range([margenBarras, w - margenBarras]);
  const minimo = Math.min(0, ...valores);
  const maximo = Math.max(0, ...valores);
  const y = scaleLinear().domain(minimo === maximo ? [minimo - 1, maximo + 1] : [minimo, maximo]).nice(4).range([h, 0]);
  const ticksX = ciclo ? filas.map(d => new Date(d.instante)).filter((_, i) => w >= 480 || i % 2 === 0) : x.ticks(Math.min(6, Math.max(2, Math.floor(w / 95))));
  const ticksY = y.ticks(4);
  const activo = indiceActivo == null ? null : filas[indiceActivo];

  // El contenedor medido por useAncho tiene que existir SIEMPRE: si se desmontara al no haber datos
  // (p. ej. un tramo sin cobertura al paginar), el observer quedaría pegado a un nodo muerto y el
  // gráfico volvería a dibujarse con un ancho viejo (chico).
  return <div ref={ref} className="rosen-chart">
    {!hayDatos ? <p className="historico-metrica__vacio">Sin cobertura suficiente en este período.</p> : <>
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
    </>}
  </div>;
}
