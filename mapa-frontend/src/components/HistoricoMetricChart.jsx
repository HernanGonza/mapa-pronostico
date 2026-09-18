import { useEffect, useRef, useState } from 'react';
import { AreaSeries, createChart, HistogramSeries, LineSeries } from 'lightweight-charts';

export default function HistoricoMetricChart({ titulo, subtitulo, datos, series, unidad = '', tipo = 'linea' }) {
  const ref = useRef(null);
  const [detalle, setDetalle] = useState('');
  const clave = `historico-grafico:${titulo}:${subtitulo}:${series.map(s => s.campo).join(',')}`;
  const opciones = series.length === 1 ? ['linea', 'barra', 'area', 'puntos'] : ['linea', 'area', 'puntos'];
  const [vista, setVista] = useState(() => {
    try {
      const guardada = localStorage.getItem(clave);
      return opciones.includes(guardada) ? guardada : tipo;
    } catch { return tipo; }
  });

  function cambiarVista(valor) {
    setVista(valor);
    try { localStorage.setItem(clave, valor); } catch { /* almacenamiento opcional */ }
  }

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
      ref: chart.addSeries(vista === 'barra' ? HistogramSeries : vista === 'area' ? AreaSeries : LineSeries, {
        color: s.color, title: s.nombre, lineWidth: 2, lastValueVisible: false, priceLineVisible: false,
        ...(vista === 'barra' ? { priceFormat: { type: 'volume' } } : {}),
        ...(vista === 'area' ? { lineColor: s.color, topColor: `${s.color}55`, bottomColor: `${s.color}08` } : {}),
        ...(vista === 'puntos' ? { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 3 } : {}),
      }),
    }));
    for (const s of creadas) {
      s.ref.setData(datos.filter(d => Number.isFinite(d[s.campo])).map(d => ({ time: d.fecha, value: d[s.campo] })));
    }
    chart.timeScale().fitContent();
    const actualizarTema = () => {
      const actual = getComputedStyle(document.documentElement);
      chart.applyOptions({
        layout: { textColor: actual.getPropertyValue('--text').trim() || '#f6f3ec' },
        grid: { horzLines: { color: actual.getPropertyValue('--border').trim() || '#66736a' } },
      });
    };
    const observador = new MutationObserver(actualizarTema);
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
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
    return () => { observador.disconnect(); chart.remove(); };
  }, [datos, series, vista, unidad]);

  return <section className="historico-metrica" aria-label={titulo}>
    <div className="historico-metrica__header"><h3>{titulo}</h3><div><span>{subtitulo}</span><label>
      <select value={vista} onChange={e => cambiarVista(e.target.value)} aria-label={`Tipo de gráfico para ${titulo}`}>
        {opciones.map(opcion => <option key={opcion} value={opcion}>{({ linea: 'Líneas', barra: 'Barras', area: 'Área', puntos: 'Puntos' })[opcion]}</option>)}
      </select>
    </label></div></div>
    <div className="historico-metrica__leyenda">{series.map(s => <span key={s.campo}><i style={{ background: s.color }} />{s.nombre}</span>)}</div>
    {datos.some(d => series.some(s => Number.isFinite(d[s.campo])))
      ? <div ref={ref} className="historico-metrica__grafico" />
      : <p className="historico-metrica__vacio">Sin cobertura suficiente en este período.</p>}
    <p className="historico-metrica__detalle" aria-live="off">{detalle || 'Pasá el cursor sobre el gráfico para ver valores.'}</p>
  </section>;
}
