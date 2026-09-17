import { useEffect, useRef } from "react";
import { createChart, LineSeries } from "lightweight-charts";

// Mismos colores institucionales que ya usa el mapa de pronóstico
// (generateMap.js, back) para TMIN/TMAX — así el gráfico histórico se ve
// coherente con el resto de las placas.
const COLOR_TMAX = "#872338";
const COLOR_TMIN = "#063970";

function colorTexto() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
  return v || "#21130d";
}
function colorBorde() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--border").trim();
  return v || "#e2ded4";
}

/** Gráfico de líneas TMIN/TMAX por día, para una serie de
 * `registrosClimaticosStore.obtenerSerie` (`[{fecha, tmin, tmax}, ...]`).
 * Se usa tanto en el panel (`HistoricoPage`) como en `/embed/historico`. */
export default function SerieClimaticaChart({ serie }) {
  const containerRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: colorTexto() },
      grid: { vertLines: { visible: false }, horzLines: { color: colorBorde() } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      localization: { locale: "es-AR" },
    });
    const tmax = chart.addSeries(LineSeries, { color: COLOR_TMAX, lineWidth: 2, title: "TMAX" });
    const tmin = chart.addSeries(LineSeries, { color: COLOR_TMIN, lineWidth: 2, title: "TMIN" });
    seriesRef.current = { chart, tmax, tmin };

    // El toggle de tema (ThemeToggle) no dispara ningún evento propio —
    // observar el atributo es más simple que sumar un event bus solo
    // para esto.
    const observer = new MutationObserver(() => {
      chart.applyOptions({ layout: { textColor: colorTexto() }, grid: { horzLines: { color: colorBorde() } } });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => { observer.disconnect(); chart.remove(); };
  }, []);

  useEffect(() => {
    const refs = seriesRef.current;
    if (!refs || !serie) return;
    refs.tmax.setData(serie.filter((p) => p.tmax != null).map((p) => ({ time: p.fecha, value: p.tmax })));
    refs.tmin.setData(serie.filter((p) => p.tmin != null).map((p) => ({ time: p.fecha, value: p.tmin })));
    refs.chart.timeScale().fitContent();
  }, [serie]);

  return (
    <div className="historico-chart-wrap">
      <div ref={containerRef} className="historico-chart" />
      {serie && serie.length === 0 && (
        <div className="admin-map-area__vacio" role="status">No hay datos para esta estación en el rango elegido.</div>
      )}
    </div>
  );
}
