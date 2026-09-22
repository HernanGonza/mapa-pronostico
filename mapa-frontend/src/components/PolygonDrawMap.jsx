import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { soportaWebGL } from "../lib/soportaWebGL";
import { BASEMAP_STYLE, prepararEstilo } from "../lib/mapStyle";

const CENTRO_MISIONES = [-54.8, -27.0];
const ZOOM_INICIAL = 7.4;

const VACIO = { type: "FeatureCollection", features: [] };

function geojsonDePuntos(puntos) {
  const linea = puntos.length >= 2
    ? [{ type: "Feature", geometry: { type: "LineString", coordinates: puntos.length >= 3 ? [...puntos, puntos[0]] : puntos }, properties: {} }]
    : [];
  const relleno = puntos.length >= 3
    ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[...puntos, puntos[0]]] }, properties: {} }]
    : [];
  const marcadores = puntos.map((p, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: { i } }));
  return { type: "FeatureCollection", features: [...relleno, ...linea, ...marcadores] };
}

/**
 * Mapa para dibujar a mano el polígono de referencia de un aviso a muy
 * corto plazo (o mostrar el que ya vino del CAP del SMN): click agrega un
 * vértice, arrastrar un vértice existente lo mueve. Sobre los límites
 * municipales (`municipios`, GeoJSON) para que el polígono tenga
 * referencia geográfica real. El polígono viaja al backend como
 * coordenadas (no como captura de pantalla): la placa se dibuja entera en
 * el servidor, sobre el mapa vectorial de Alerta Meteorológica (ver
 * generateAvisoCortoPlazoMap) — este mapa es sólo para que el operador
 * elija/dibuje el área. `colorPoligono` es el violeta propio del SMN/ACP
 * (#8b3fc4, ver alertas automáticas) en avisos a muy corto plazo; en otros
 * usos (HistoricoPage) queda el rosa/magenta de siempre.
 */
const PolygonDrawMap = forwardRef(function PolygonDrawMap({ puntos, onChange, municipios, readOnly = false, colorPoligono = "#c9346c" }, ref) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [webglOk] = useState(soportaWebGL);
  const [listo, setListo] = useState(false);
  const puntosRef = useRef(puntos);
  puntosRef.current = puntos;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const municipiosRef = useRef(municipios);
  municipiosRef.current = municipios;
  const colorPoligonoRef = useRef(colorPoligono);
  colorPoligonoRef.current = colorPoligono;
  const arrastrandoRef = useRef(null);

  useImperativeHandle(ref, () => ({
    capturePng() {
      const map = mapRef.current;
      if (!map) return null;
      map.triggerRepaint();
      return map.getCanvas().toDataURL("image/png");
    },
  }));

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !webglOk) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: null,
      center: CENTRO_MISIONES,
      zoom: ZOOM_INICIAL,
      pitch: 0,
      bearing: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
      cooperativeGestures: readOnly,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    map.touchZoomRotate?.disableRotation();
    if (!readOnly) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("error", (e) => {
      const msg = e?.error?.message || "";
      if (!/40\d|Failed to fetch|AbortError/.test(msg)) console.warn("[PolygonDrawMap] error:", msg);
    });
    map.setStyle(BASEMAP_STYLE, { transformStyle: prepararEstilo });

    map.on("style.load", () => {
      if (municipiosRef.current) {
        map.addSource("municipios-limite", { type: "geojson", data: municipiosRef.current });
        // Relleno verde tenue sobre los 79 municipios: sin esto, Misiones se
        // pierde contra Brasil/Paraguay/Corrientes en el fondo "positron"
        // (todo blanco/gris) — con el mapa capturado como placa, hace falta
        // que la provincia se distinga a simple vista.
        map.addLayer({ id: "municipios-limite-relleno", type: "fill", source: "municipios-limite", paint: { "fill-color": "#3e6c51", "fill-opacity": 0.16 } });
        map.addLayer({ id: "municipios-limite-linea", type: "line", source: "municipios-limite", paint: { "line-color": "#345345", "line-width": 1, "line-opacity": 0.55 } });
        map.addLayer({ id: "municipios-limite-label", type: "symbol", source: "municipios-limite", minzoom: 7.5,
          layout: { "text-field": ["get", "nombre"], "text-font": ["Noto Sans Regular"], "text-size": 10.5, "text-max-width": 8 },
          paint: { "text-color": "#5a6b5d", "text-halo-color": "#ffffff", "text-halo-width": 1.2 } });
      }
      const color = colorPoligonoRef.current;
      map.addSource("poligono-dibujo", { type: "geojson", data: geojsonDePuntos(puntosRef.current) });
      map.addLayer({ id: "poligono-relleno", type: "fill", source: "poligono-dibujo", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": color, "fill-opacity": 0.22 } });
      map.addLayer({ id: "poligono-linea", type: "line", source: "poligono-dibujo", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": color, "line-width": 3 } });
      map.addLayer({ id: "poligono-puntos", type: "circle", source: "poligono-dibujo", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 6, "circle-color": "#fff", "circle-stroke-color": color, "circle-stroke-width": 2 } });
      setListo(true);
    });

    if (!readOnly) {
      map.on("mouseenter", "poligono-puntos", () => { map.getCanvas().style.cursor = "grab"; });
      map.on("mouseleave", "poligono-puntos", () => { if (arrastrandoRef.current === null) map.getCanvas().style.cursor = ""; });

      map.on("mousedown", (e) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ["poligono-puntos"] })[0];
        if (!hit) return;
        e.preventDefault();
        arrastrandoRef.current = hit.properties.i;
        map.dragPan.disable();
        map.getCanvas().style.cursor = "grabbing";
      });
      map.on("mousemove", (e) => {
        if (arrastrandoRef.current === null) return;
        const nuevos = puntosRef.current.map((p, i) =>
          i === arrastrandoRef.current ? [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))] : p
        );
        onChangeRef.current(nuevos);
      });
      const soltar = () => {
        if (arrastrandoRef.current === null) return;
        arrastrandoRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = "";
      };
      map.on("mouseup", soltar);
      map.on("mouseleave", soltar);

      map.on("click", (e) => {
        if (arrastrandoRef.current !== null) return;
        const hit = map.queryRenderedFeatures(e.point, { layers: ["poligono-puntos"] })[0];
        if (hit) return; // click sobre un vértice existente: no agrega uno nuevo
        const actuales = puntosRef.current;
        const nuevos = [...actuales, [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))]];
        onChangeRef.current(nuevos);
      });
    }

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(mapContainerRef.current);
    mapRef.current = map;
    return () => { ro.disconnect(); mapRef.current = null; map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!listo) return;
    mapRef.current?.getSource("poligono-dibujo")?.setData(geojsonDePuntos(puntos));
  }, [puntos, listo]);

  if (!webglOk) {
    return (
      <div className="base-map base-map--fallback">
        <div><strong>Tu navegador no puede mostrar el mapa.</strong><p>Necesitás un navegador con WebGL activo (Chrome, Firefox o Edge).</p></div>
      </div>
    );
  }

  return (
    <div className="base-map polygon-draw-map">
      <div ref={mapContainerRef} className="base-map__canvas-container" />
      {!readOnly && (
        <div className="polygon-draw-map__toolbar" role="group" aria-label="Herramientas de dibujo" data-capture-ignore>
          <span className="polygon-draw-map__contador">
            {puntos.length === 0 ? "Hacé click en el mapa para empezar a dibujar" : `${puntos.length} punto${puntos.length === 1 ? "" : "s"} · arrastrá un punto para moverlo`}
          </span>
          <button type="button" className="btn" disabled={puntos.length === 0} onClick={() => onChange(puntos.slice(0, -1))}>Deshacer último punto</button>
          <button type="button" className="btn" disabled={puntos.length === 0} onClick={() => onChange([])}>Reiniciar</button>
        </div>
      )}
    </div>
  );
});

export default PolygonDrawMap;
