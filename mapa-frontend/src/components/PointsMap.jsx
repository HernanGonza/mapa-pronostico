import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import maplibregl from "maplibre-gl";
import { soportaWebGL } from "../lib/soportaWebGL";
import { BASEMAP_STYLE, prepararEstilo } from "../lib/mapStyle";

const CENTRO_MISIONES = [-54.8, -27.0];
const ZOOM_INICIAL = 7.4;
const ETIQUETAS = {
  municipio: "Municipio",
  departamento: "Departamento",
  fecha: "Fecha",
  hora: "Hora",
  satelite: "Satélite",
  confidence: "Confianza",
  frp: "Potencia (FRP)",
  vinculadoAANP: "¿Área protegida?",
  anpNombre: "Área protegida",
  Intensidad: "Intensidad",
};

/**
 * Mapa liviano de puntos sobre el mismo fondo (mundo + provincias) que
 * BaseMap, para datasets que no son "un valor por municipio" — hoy,
 * alertas de incendio. Si en el futuro riesgo-incendios también pinta
 * puntos/celdas en vez de un choropleth por municipio, se reutiliza.
 *
 * No comparte código con BaseMap a propósito: esa lógica está ligada al
 * modelo municipios+pronóstico y es la que usa /embed hoy; tocarla acá
 * arriesga esa ruta sin necesidad.
 */
const PointsMap = forwardRef(function PointsMap(
  { mundoGeojson, paisesLabels, provincias, provinciasLabels, puntos, titulo, enableCapture = false },
  ref
) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [webglOk] = useState(soportaWebGL);
  const [activo, setActivo] = useState(null);

  const puntosRef = useRef(puntos);
  puntosRef.current = puntos;
  const syncRef = useRef(null);

  useImperativeHandle(ref, () => ({
    async capturePng() {
      const map = mapRef.current;
      if (!map) return null;
      if (!map.loaded() || !map.areTilesLoaded()) {
        await new Promise((resolve, reject) => {
          const done = () => { clearTimeout(timer); map.off('idle', done); resolve(); };
          const timer = setTimeout(() => { map.off('idle', done); reject(new Error('El mapa sigue cargando. Reintentá en unos segundos.')); }, 10000);
          map.on('idle', done); map.triggerRepaint();
        });
      }
      await new Promise(resolve => { map.once('render', resolve); map.triggerRepaint(); });
      const mapCanvas = map.getCanvas();
      const out = document.createElement("canvas");
      out.width = mapCanvas.width;
      out.height = mapCanvas.height;
      out.getContext("2d").drawImage(mapCanvas, 0, 0);
      return out.toDataURL("image/png");
    },
  }));

  // --- Inicialización (una vez), igual workaround de arranque que BaseMap ---
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
      canvasContextAttributes: { preserveDrawingBuffer: enableCapture },
    });
    map.touchZoomRotate?.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "Focos: NASA FIRMS · Límites: Natural Earth (Misiones)",
      }),
      "bottom-right"
    );

    map.on("error", (e) => {
      const msg = e?.error?.message || "";
      if (!/40\d|Failed to fetch|AbortError/.test(msg)) console.warn("[PointsMap] error:", msg);
    });
    // Usa la misma cartografía base que pronóstico y riesgo.
    map.setStyle(BASEMAP_STYLE, { transformStyle: prepararEstilo });

    mapRef.current = map;
    const sync = () => {
      if (!map.isStyleLoaded()) return;
      const geojson = puntosRef.current || {type: 'FeatureCollection', features: []};
      if (map.getSource('focos')) { map.getSource('focos').setData(geojson); return; }
      map.addSource('focos', {type: 'geojson', data: geojson});
      const color = ['interpolate', ['linear'], ['coalesce', ['get', 'Intensidad'], 0], 0, '#ffd166', 25, '#ff7b25', 100, '#e31a1c'];
      map.addLayer({id: 'focos-eco', type: 'circle', source: 'focos', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 7, 10, 13],
        'circle-color': color, 'circle-opacity': 0.18,
      }});
      map.addLayer({id: 'focos-punto', type: 'circle', source: 'focos', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 10, 9],
        'circle-color': color, 'circle-stroke-color': '#fff3e6', 'circle-stroke-width': 1, 'circle-opacity': 0.95,
      }});
    };
    syncRef.current = sync;
    map.on('style.load', sync);
    map.on('mouseenter', 'focos-punto', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'focos-punto', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'focos-punto', e => setActivo(e.features?.[0]?.properties || null));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(mapContainerRef.current);
    return () => { ro.disconnect(); syncRef.current = null; mapRef.current = null; map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OpenFreeMap ya aporta países, provincias, fronteras y rótulos. No se
  // agregan capas oscuras propias: así esta vista comparte exactamente la
  // misma base cartográfica que pronóstico y riesgo.

  useEffect(() => { syncRef.current?.(); }, [puntos]);

  if (!webglOk) {
    return (
      <div className="base-map base-map--fallback">
        <div>
          <strong>Tu navegador no puede mostrar el mapa.</strong>
          <p>Necesitás un navegador con WebGL activo (Chrome, Firefox o Edge).</p>
        </div>
      </div>
    );
  }

  return (
    <div className="base-map">
      <div ref={mapContainerRef} className="base-map__canvas-container" />

      {titulo && (
        <div className="map-title">
          <img src="/brand/ecologia-flor.png" alt="" width={30} height={30} />
          <div>
            <strong>{titulo}</strong>
          </div>
        </div>
      )}

      {activo && (
        <div className="info-card" role="dialog" aria-label="Foco de calor">
          <button className="info-card__close" onClick={() => setActivo(null)} aria-label="Cerrar">
            ✕
          </button>
          <ul className="info-card__props">
            {Object.entries(activo)
              .filter(([k, v]) => v != null && v !== "" && !(k === "anpNombre" && !activo.vinculadoAANP))
              .map(([k, v]) => (
                <li key={k}>
                  <b>{ETIQUETAS[k] || k}:</b>{" "}
                  {typeof v === "boolean" ? (v ? "Sí" : "No") : String(v)}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
});

export default PointsMap;
