import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { soportaWebGL } from "../lib/soportaWebGL";
import { BASEMAP_STYLE, prepararEstilo } from "../lib/mapStyle";
import { MAP_LOCALE_ES } from "../lib/mapLocale";
import { getMunicipiosGeojson } from "../api";
import { ESCALA } from "../lib/precipitacionesCalculo";

const CENTRO = [-54.6, -27.0];

/**
 * Mapa de las estaciones de la tabla de precipitaciones. `estaciones`: [{ clave, nombre, lat, lng, color }].
 * El color es el del último dato; al tocar una estación se avisa con `onSeleccionar(clave)`.
 */
export default function PrecipitacionesMap({ estaciones, seleccionada, onSeleccionar, embed = false }) {
  const contenedor = useRef(null), mapRef = useRef(null), syncRef = useRef(null), fiteado = useRef(false);
  const [webglOk] = useState(soportaWebGL);
  const datos = useRef({}); datos.current = { estaciones, seleccionada };
  const accion = useRef(); accion.current = onSeleccionar;

  useEffect(() => {
    if (!contenedor.current || mapRef.current || !webglOk) return;
    const map = new maplibregl.Map({ container: contenedor.current, style: null, center: CENTRO, zoom: 7, dragRotate: false, pitchWithRotate: false, touchPitch: false, attributionControl: false, cooperativeGestures: embed, locale: MAP_LOCALE_ES });
    map.touchZoomRotate?.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Datos: Dirección General de Alerta Temprana" }), "bottom-right");
    map.on("error", (e) => { const msg = e?.error?.message || ""; if (!/40\d|Failed to fetch|AbortError/.test(msg)) console.warn("[PrecipitacionesMap]", msg); });
    mapRef.current = map;
    let listo = false;
    const sync = () => {
      if (!listo) return;
      const { estaciones: es, seleccionada: sel } = datos.current;
      const fc = { type: "FeatureCollection", features: (es || []).map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { id: p.clave, color: p.color, sel: p.clave === sel, nombre: p.nombre } })) };
      if (map.getSource("estaciones")) map.getSource("estaciones").setData(fc);
      else {
        map.addSource("estaciones", { type: "geojson", data: fc });
        map.addLayer({ id: "est-aro", type: "circle", source: "estaciones", filter: ["==", ["get", "sel"], true], paint: { "circle-radius": 14, "circle-color": "#ffffff", "circle-stroke-color": "#21130d", "circle-stroke-width": 2.5 } });
        map.addLayer({ id: "est-punto", type: "circle", source: "estaciones", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 6, 11, 10], "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": 0.95 } });
        map.addLayer({ id: "est-nombre", type: "symbol", source: "estaciones", minzoom: 8.5, layout: { "text-field": ["get", "nombre"], "text-size": 11, "text-offset": [0, 1.3], "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#21130d", "text-halo-color": "#fff", "text-halo-width": 1.5 } });
      }
      if (!fiteado.current && fc.features.length) {
        const b = new maplibregl.LngLatBounds();
        fc.features.forEach((f) => b.extend(f.geometry.coordinates));
        map.fitBounds(b, { padding: 60, duration: 0, maxZoom: 9 });
        fiteado.current = true;
      }
    };
    syncRef.current = sync;
    map.on("style.load", () => {
      listo = true;
      getMunicipiosGeojson().then((d) => {
        if (!mapRef.current || map.getSource("municipios")) return;
        map.addSource("municipios", { type: "geojson", data: d });
        map.addLayer({ id: "mun-linea", type: "line", source: "municipios", paint: { "line-color": "#4a6b58", "line-width": 1, "line-dasharray": [3, 2] } }, map.getLayer("est-aro") ? "est-aro" : undefined);
      }).catch(() => {});
      sync();
    });
    map.on("mouseenter", "est-punto", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "est-punto", () => { map.getCanvas().style.cursor = ""; });
    map.on("click", (e) => { const f = map.queryRenderedFeatures(e.point, { layers: ["est-punto"] })[0]; if (f) accion.current?.(f.properties.id); });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(contenedor.current);
    map.setStyle(BASEMAP_STYLE, { transformStyle: prepararEstilo });
    return () => { ro.disconnect(); syncRef.current = null; mapRef.current = null; map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { syncRef.current?.(); }, [estaciones, seleccionada]);
  useEffect(() => {
    const p = estaciones?.find((x) => x.clave === seleccionada);
    if (p && mapRef.current) mapRef.current.easeTo({ center: [p.lng, p.lat], zoom: Math.max(mapRef.current.getZoom(), 9), duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionada]);

  if (!webglOk) return <div className="base-map base-map--fallback cuencas-claro">Tu navegador necesita WebGL activo para mostrar el mapa.</div>;
  return <div className={`base-map cuencas-claro${embed ? " base-map--embed" : ""}`}>
    <div ref={contenedor} className="base-map__canvas-container" />
    <div className="map-title"><img src="/brand/ecologia-flor.png" alt="" width={32} height={32} /><div><strong>Precipitaciones en Misiones</strong></div></div>
    <div className="map-legend"><div className="risk-legend">
      <strong>Lluvia del último día con dato</strong>
      <div className="map-key__items">{ESCALA.map(([d, c, t]) => <span key={d}><i style={{ background: c, borderRadius: "50%" }} /> {t}</span>)}<span><i style={{ background: "#8793a0", borderRadius: "50%" }} /> Sin datos en 10 días</span></div>
    </div></div>
  </div>;
}
