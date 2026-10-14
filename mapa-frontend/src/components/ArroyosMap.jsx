import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { soportaWebGL } from "../lib/soportaWebGL";
import { BASEMAP_STYLE, prepararEstilo } from "../lib/mapStyle";
import { MAP_LOCALE_ES } from "../lib/mapLocale";

const CENTRO = [-54.6, -27.0];
export const COLOR_ESTADO = { normal: "#237346", vigilancia: "#d99a00", alerta: "#d9622b", corte: "#b42332", sin_umbral: "#3b6ea5", sin_datos: "#8793a0", sin_sensor: "#c3cad2" };

/**
 * Mapa de los puntos de monitoreo de arroyos (módulo Inundaciones). El color es el estado; el punto elegido
 * lleva un aro. Con `onUbicar` el clic en el mapa devuelve [lat, lng] (para cargar la ubicación de un punto)
 * y se marca la posición elegida con `ubicacion`.
 */
export default function ArroyosMap({ puntos, seleccionadoId, onSeleccionar, onUbicar, ubicacion, embed = false }) {
  const contenedor = useRef(null);
  const mapRef = useRef(null);
  const syncRef = useRef(null);
  const fiteado = useRef(false);
  const [webglOk] = useState(soportaWebGL);
  const datos = useRef({}); datos.current = { puntos, seleccionadoId, ubicacion };
  const acciones = useRef({}); acciones.current = { onSeleccionar, onUbicar };

  useEffect(() => {
    if (!contenedor.current || mapRef.current || !webglOk) return;
    const map = new maplibregl.Map({ container: contenedor.current, style: null, center: CENTRO, zoom: 7, dragRotate: false, pitchWithRotate: false, touchPitch: false, attributionControl: false, cooperativeGestures: embed, locale: MAP_LOCALE_ES });
    map.touchZoomRotate?.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Datos: SNIH · Red Hidrológica Nacional" }), "bottom-right");
    map.on("error", (e) => { const msg = e?.error?.message || ""; if (!/40\d|Failed to fetch|AbortError/.test(msg)) console.warn("[ArroyosMap]", msg); });
    mapRef.current = map;
    let listo = false;
    const sync = () => {
      if (!listo) return;
      const { puntos: ps, seleccionadoId: sel, ubicacion: ub } = datos.current;
      const fc = { type: "FeatureCollection", features: (ps || []).map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: { id: p.id, color: COLOR_ESTADO[p.estado.codigo] || COLOR_ESTADO.sin_datos, activo: p.activo !== false, sel: p.id === sel } })) };
      const fcUb = { type: "FeatureCollection", features: ub ? [{ type: "Feature", geometry: { type: "Point", coordinates: [ub[1], ub[0]] }, properties: {} }] : [] };
      if (map.getSource("arroyos")) { map.getSource("arroyos").setData(fc); map.getSource("ubicacion").setData(fcUb); }
      else {
        map.addSource("arroyos", { type: "geojson", data: fc });
        map.addSource("ubicacion", { type: "geojson", data: fcUb });
        map.addLayer({ id: "arroyos-aro", type: "circle", source: "arroyos", filter: ["==", ["get", "sel"], true], paint: { "circle-radius": 13, "circle-color": "#ffffff", "circle-stroke-color": "#21130d", "circle-stroke-width": 2.5 } });
        map.addLayer({ id: "arroyos-punto", type: "circle", source: "arroyos", paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 6, 11, 10],
          "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": ["case", ["get", "activo"], 0.95, 0.4] } });
        map.addLayer({ id: "arroyos-ubicacion", type: "circle", source: "ubicacion", paint: { "circle-radius": 9, "circle-color": "#ffffff", "circle-opacity": 0.2, "circle-stroke-color": "#872338", "circle-stroke-width": 3 } });
      }
      if (!fiteado.current && fc.features.length) {
        const b = new maplibregl.LngLatBounds();
        fc.features.forEach((f) => b.extend(f.geometry.coordinates));
        map.fitBounds(b, { padding: 60, duration: 0, maxZoom: 9 });
        fiteado.current = true;
      }
    };
    syncRef.current = sync;
    map.on("style.load", () => { listo = true; sync(); });
    map.on("mouseenter", "arroyos-punto", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "arroyos-punto", () => { map.getCanvas().style.cursor = acciones.current.onUbicar ? "crosshair" : ""; });
    map.on("click", (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ["arroyos-punto"] })[0];
      if (f) acciones.current.onSeleccionar?.(f.properties.id);
      else if (acciones.current.onUbicar) acciones.current.onUbicar([Number(e.lngLat.lat.toFixed(5)), Number(e.lngLat.lng.toFixed(5))]);
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(contenedor.current);
    map.setStyle(BASEMAP_STYLE, { transformStyle: prepararEstilo });
    return () => { ro.disconnect(); syncRef.current = null; mapRef.current = null; map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { syncRef.current?.(); }, [puntos, seleccionadoId, ubicacion]);
  useEffect(() => { const m = mapRef.current; if (m) m.getCanvas().style.cursor = onUbicar ? "crosshair" : ""; }, [onUbicar]);
  // Al elegir un punto en la lista, el mapa lo centra.
  useEffect(() => {
    const p = puntos?.find((x) => x.id === seleccionadoId);
    if (p && mapRef.current) mapRef.current.easeTo({ center: [p.lng, p.lat], zoom: Math.max(mapRef.current.getZoom(), 9.5), duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionadoId]);

  if (!webglOk) return <div className="base-map base-map--fallback cuencas-claro">Tu navegador necesita WebGL activo para mostrar el mapa.</div>;
  return <div className={`base-map cuencas-claro${embed ? " base-map--embed" : ""}`}>
    <div ref={contenedor} className="base-map__canvas-container" />
    <div className="map-title"><img src="/brand/ecologia-flor.png" alt="" width={32} height={32} /><div><strong>Arroyos de Misiones</strong></div></div>
    <div className="map-legend"><div className="risk-legend">
      <strong>Estado de cada punto</strong>
      <div className="map-key__items">
        {[["normal", "Normal"], ["vigilancia", "Vigilancia"], ["alerta", "Alerta"], ["corte", "Nivel de corte de ruta"], ["sin_umbral", "Sin umbral cargado"], ["sin_datos", "Sin datos recientes"], ["sin_sensor", "Sin sensor"]]
          .map(([c, t]) => <span key={c}><i style={{ background: COLOR_ESTADO[c], borderRadius: "50%" }} /> {t}</span>)}
      </div>
    </div></div>
    {onUbicar && <div className="map-info"><div className="municipio-popover"><p>Hacé clic en el mapa para marcar la ubicación del punto.</p></div></div>}
  </div>;
}
