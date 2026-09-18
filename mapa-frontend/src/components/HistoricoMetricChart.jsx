import { useEffect, useRef, useState } from 'react';
import { createChart, HistogramSeries, LineSeries } from 'lightweight-charts';

export default function HistoricoMetricChart({ titulo, subtitulo, datos, series, unidad = '', tipo = 'linea' }) {
  const ref = useRef(null);
  const [detalle, setDetalle] = useState('');

  useEffect(() => {
    if (!ref.current) return undefined;
    const style = getComputedStyle(document.documentElement);
    const chart = createChart(ref.current, {
      autoSize: true,
      height: 230,
      layout: { background: { color: 'transparent' }, textColor: style.getPropertyValue('--text').trim() || '#26313a', attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: style.getPropertyValue('--border').trim() || '#d6dde2' } },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      rightPriceScale: { borderVisible: false },
      localization: { locale: 'es-AR' },
      handleScroll: false,
    });
    const creadas = series.map(s => ({
      ...s,
      ref: chart.addSeries(tipo === 'barra' ? HistogramSeries : LineSeries, {
        color: s.color, title: s.nombre, lineWidth: 2, lastValueVisible: false, priceLineVisible: false,
        ...(tipo === 'barra' ? { priceFormat: { type: 'volume' } } : {}),
      }),
    }));
    for (const s of creadas) {
      s.ref.setData(datos.filter(d => Number.isFinite(d[s.campo])).map(d => ({ time: d.fecha, value: d[s.campo] })));
    }
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove(param => {
      if (!param.time) { setDetalle(''); return; }
      const valores = creadas.map(s => {
        const punto = param.seriesData.get(s.ref);
        return punto ? `${s.nombre}: ${Number(punto.value).toLocaleString('es-AR')} ${unidad}` : null;
      }).filter(Boolean);
      const fecha = typeof param.time === 'string' ? param.time :
        `${param.time.year}-${String(param.time.month).padStart(2, '0')}-${String(param.time.day).padStart(2, '0')}`;
      setDetalle(`${fecha} · ${valores.join(' · ')}`);
    });
    return () => chart.remove();
  }, [datos, series, tipo, unidad]);

  return <section className="historico-metrica" aria-label={titulo}>
    <div className="historico-metrica__header"><h3>{titulo}</h3><span>{subtitulo}</span></div>
    <div className="historico-metrica__leyenda">{series.map(s => <span key={s.campo}><i style={{ background: s.color }} />{s.nombre}</span>)}</div>
    {datos.some(d => series.some(s => Number.isFinite(d[s.campo])))
      ? <div ref={ref} className="historico-metrica__grafico" />
      : <p className="historico-metrica__vacio">Sin cobertura suficiente en este período.</p>}
    <p className="historico-metrica__detalle" aria-live="off">{detalle || 'Pasá el cursor sobre el gráfico para ver valores.'}</p>
  </section>;
}
