import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { toPng } from "html-to-image";
import { soportaWebGL } from "../lib/soportaWebGL";
import { BASEMAP_STYLE, prepararEstilo } from "../lib/mapStyle";
import { tiempoRelativo, fechaLarga } from "../lib/tiempoRelativo";

const SIN_DATO = "#d5dbd5";

const BaseMap = forwardRef(function BaseMap({
  poligonos, datos = [], colorDe, renderInfo, campoEtiqueta = "nombre",
  leyenda, titulo, publicadoEn, fechaPronostico, interactive = true, enableCapture = false,
  regionLabel = 'Misiones',
}, ref) {
  const containerRef = useRef(null);
  const rootRef = useRef(null);
  const mapRef = useRef(null);
  const syncRef = useRef(null);
  const fittedRef = useRef(false);
  const fitRef = useRef(null);
  const [webglOk] = useState(soportaWebGL);
  const [selected, setSelected] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const actual = useRef({});
  actual.current = { poligonos, datos, colorDe, campoEtiqueta, selected };
  const activo = datos.find(d => String(d.id) === selected);

  useEffect(() => {
    if (!webglOk || !containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current, style: null,
      center: [-54.8, -27], zoom: 7.4, interactive,
      dragRotate: false, pitchWithRotate: false, touchPitch: false,
      canvasContextAttributes: { preserveDrawingBuffer: enableCapture },
      attributionControl: false,
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: false,
      customAttribution: "Datos: Ministerio de Ecología y RNR · Misiones",
    }), "bottom-right");
    if (interactive) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const sync = () => {
      if (!map.isStyleLoaded()) return;
      const { poligonos: geo, datos: rows, colorDe: color, campoEtiqueta: label, selected: id } = actual.current;
      if (!geo) return;
      // Los colores se actualizan junto con los datos de cada zona.
      const byId = new Map(rows.map(d => [String(d.id), d]));
      const painted = { ...geo, features: geo.features.map(f => ({ ...f,
        properties: { ...f.properties, color: color?.(byId.get(String(f.properties.id))) || SIN_DATO,
          selected: String(f.properties.id) === id },
      })) };
      if (map.getSource("zonas")) map.getSource("zonas").setData(painted);
      else map.addSource("zonas", { type: "geojson", data: painted });
      if (!map.getLayer("zonas-fill")) {
        // Sobre el terreno, debajo de los nombres del fondo.
        const before = map.getStyle().layers.find(l => l.type === "symbol")?.id;
        map.addLayer({ id: "zonas-fill", type: "fill", source: "zonas",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.78 } }, before);
        map.addLayer({ id: "zonas-outline", type: "line", source: "zonas",
          paint: { "line-color": "#345345", "line-width": 1, "line-opacity": 0.7 } }, before);
        map.addLayer({ id: "zonas-selected", type: "line", source: "zonas",
          filter: ["==", ["get", "selected"], true],
          paint: { "line-color": "#162f25", "line-width": 3 } });
        map.addLayer({ id: "zonas-label", type: "symbol", source: "zonas", minzoom: 6.5,
          layout: { "text-field": ["get", label], "text-font": ["Noto Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 6.5, 10, 11, 14], "text-max-width": 9 },
          paint: { "text-color": "#162f25", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } });
      }
      fitRef.current = () => {
        const bounds = new maplibregl.LngLatBounds();
        const walk = a => typeof a[0] === "number" ? bounds.extend(a) : a.forEach(walk);
        geo.features.forEach(f => walk(f.geometry.coordinates));
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: { top: 100, bottom: 155, left: 45, right: 45 }, duration: 0, maxZoom: 8 });
      };
      if (!fittedRef.current) { fitRef.current(); fittedRef.current = true; }
      map.triggerRepaint();
    };
    syncRef.current = sync;
    const loaded = () => { setError(""); sync(); };
    const idle = () => { setReady(!!map.getLayer("zonas-fill")); };
    const failed = () => { setError("No se pudo cargar parte del mapa. Revisá la conexión e intentá recargar la página."); };
    map.on("style.load", loaded);
    map.on("idle", idle);
    map.on("error", failed);
    map.on("click", e => {
      if (!interactive || !map.getLayer("zonas-fill")) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: ["zonas-fill"] })[0];
      setSelected(hit ? String(hit.properties.id) : null);
    });
    map.on("mouseenter", "zonas-fill", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "zonas-fill", () => { map.getCanvas().style.cursor = ""; });
    const ro = new ResizeObserver(() => { map.resize(); fitRef.current?.(); });
    ro.observe(containerRef.current);
    map.setStyle(BASEMAP_STYLE, { transformStyle: prepararEstilo });
    if (import.meta.env.DEV) window.__map = map;
    return () => { ro.disconnect(); syncRef.current = null; mapRef.current = null; fittedRef.current = false; fitRef.current = null; map.remove(); };
    // El mapa vive durante el montaje; los datos se sincronizan por separado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const sync = () => syncRef.current?.();
    if (map?.isStyleLoaded()) sync();
    else map?.once("idle", sync);
    return () => { map?.off("idle", sync); };
  }, [poligonos, datos, colorDe, campoEtiqueta, selected]);

  async function esperarMapa() {
    const map = mapRef.current;
    if (!map || !enableCapture) throw new Error("El mapa no está disponible para capturar.");
    if (!map.loaded() || !map.areTilesLoaded()) {
      await new Promise((resolve, reject) => {
        const done = () => { clearTimeout(timer); map.off("idle", done); resolve(); };
        const timer = setTimeout(() => { map.off("idle", done); reject(new Error("El mapa sigue cargando. Esperá unos segundos y reintentá.")); }, 15000);
        map.on("idle", done);
        map.triggerRepaint();
      });
    }
    if (!map.getLayer("zonas-fill")) throw new Error("Todavía no hay zonas en el mapa.");
    await new Promise(resolve => { map.once("render", resolve); map.triggerRepaint(); });
    return map;
  }
  useImperativeHandle(ref, () => ({
    async capturePng() { const map = await esperarMapa(); return map.getCanvas().toDataURL("image/png"); },
    async capturarConOverlay() {
      await esperarMapa();
      await document.fonts.ready;
      return toPng(rootRef.current, { pixelRatio: 2, filter: node => !node.hasAttribute?.("data-capture-ignore") && !node.classList?.contains("maplibregl-ctrl-group") });
    },
  }));

  if (!webglOk) return <div className="base-map base-map--fallback">Tu navegador necesita WebGL activo para mostrar el mapa.</div>;
  return <div className="base-map" ref={rootRef}>
    <div ref={containerRef} className="base-map__canvas-container" />
    {titulo && <div className="map-title"><img src="/brand/ecologia-flor.png" alt="" width={32} height={32} />
      <div><strong>{titulo}</strong><span className="map-title__meta">{regionLabel} · {publicadoEn ? `Publicado ${tiempoRelativo(publicadoEn)} · ${fechaPronostico || fechaLarga(publicadoEn)}` : "Vista previa · sin publicar"}</span></div></div>}
    {(!ready || error) && <div className="map-status" role="status" data-capture-ignore>{error || "Cargando mapa…"}</div>}
    {activo && renderInfo && <div className="map-info" data-capture-ignore>{renderInfo(activo, { onCerrar: () => setSelected(null) })}</div>}
    {leyenda && <div className="map-legend">{leyenda}</div>}
  </div>;
});
export default BaseMap;
