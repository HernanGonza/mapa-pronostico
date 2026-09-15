import { useEffect, useRef, useState } from "react";
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
 * corto plazo: click agrega un vértice, se previsualiza línea + relleno
 * en vivo. Es sólo para escribir el texto con precisión — el polígono NO
 * se dibuja en la placa final (esa sale de generateRecomendaciones, texto
 * libre sobre el fondo elegido), pero sí viaja al backend para guardarse.
 */
export default function PolygonDrawMap({ puntos, onChange }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [webglOk] = useState(soportaWebGL);
  const [listo, setListo] = useState(false);
  const puntosRef = useRef(puntos);
  puntosRef.current = puntos;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
    });
    map.touchZoomRotate?.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("error", (e) => {
      const msg = e?.error?.message || "";
      if (!/40\d|Failed to fetch|AbortError/.test(msg)) console.warn("[PolygonDrawMap] error:", msg);
    });
    map.setStyle(BASEMAP_STYLE, { transformStyle: prepararEstilo });

    map.on("style.load", () => {
      map.addSource("poligono-dibujo", { type: "geojson", data: geojsonDePuntos(puntosRef.current) });
      map.addLayer({ id: "poligono-relleno", type: "fill", source: "poligono-dibujo", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#c9346c", "fill-opacity": 0.22 } });
      map.addLayer({ id: "poligono-linea", type: "line", source: "poligono-dibujo", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#c9346c", "line-width": 3 } });
      map.addLayer({ id: "poligono-puntos", type: "circle", source: "poligono-dibujo", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 6, "circle-color": "#fff", "circle-stroke-color": "#c9346c", "circle-stroke-width": 2 } });
      setListo(true);
    });

    map.on("click", (e) => {
      const actuales = puntosRef.current;
      const nuevos = [...actuales, [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))]];
      onChangeRef.current(nuevos);
    });

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
      <div className="polygon-draw-map__toolbar" role="group" aria-label="Herramientas de dibujo">
        <span className="polygon-draw-map__contador">{puntos.length === 0 ? "Hacé click en el mapa para empezar a dibujar" : `${puntos.length} punto${puntos.length === 1 ? "" : "s"}`}</span>
        <button type="button" className="btn" disabled={puntos.length === 0} onClick={() => onChange(puntos.slice(0, -1))}>Deshacer último punto</button>
        <button type="button" className="btn" disabled={puntos.length === 0} onClick={() => onChange([])}>Reiniciar</button>
      </div>
    </div>
  );
}
