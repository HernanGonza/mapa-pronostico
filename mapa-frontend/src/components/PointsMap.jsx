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
import { getMunicipiosGeojson } from "../api";
import { agregarMunicipios, crearIndiceMunicipios, describirConfianza, INTENSIDADES } from "../lib/alertasIncendio";
import { CICLO_MS, pulsoDeFoco } from "../lib/pulsoFocos";

const CENTRO_MISIONES = [-54.8, -27.0];
const ZOOM_INICIAL = 7.4;
const COLORES_INTENSIDAD = ["#b5a99d", "#f5d35d", "#f6a53d", "#ed6b2f", "#d73b29", "#941c32"];
const ETIQUETAS = {
  municipio: "Municipio",
  departamento: "Departamento",
  fecha: "Fecha",
  hora: "Hora",
  horaArgentina: "Hora (Argentina)",
  satelite: "Satélite",
  confidence: "Confianza",
  frp: "Potencia (FRP, MW)",
  vinculadoAANP: "¿Área protegida?",
  anpNombre: "Área protegida",
  Intensidad: "Intensidad",
};

/**
 * Mapa de puntos sobre los mismos municipios y fondo que BaseMap, para
 * datasets que no son "un valor por municipio" — hoy,
 * focos de calor. Si en el futuro riesgo-incendios también pinta
 * puntos/celdas en vez de un choropleth por municipio, se reutiliza.
 *
 * No comparte código con BaseMap a propósito: esa lógica está ligada al
 * modelo municipios+pronóstico y es la que usa /embed hoy; tocarla acá
 * arriesga esa ruta sin necesidad.
 */
const PointsMap = forwardRef(function PointsMap(
  { puntos, titulo, enableCapture = false },
  ref
) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [webglOk] = useState(soportaWebGL);
  const [activo, setActivo] = useState(null);
  const confianza = describirConfianza(activo?.confidence);

  const puntosRef = useRef(puntos);
  puntosRef.current = puntos;
  const syncRef = useRef(null);
  const municipiosRef = useRef(null);
  const indiceMunicipiosRef = useRef(null);
  const animacionRef = useRef(null);
  const iniciarAnimacionRef = useRef(null);

  useEffect(() => {
    let activo = true;
    getMunicipiosGeojson().then(geo => {
      if (!activo) return;
      municipiosRef.current = geo;
      indiceMunicipiosRef.current = crearIndiceMunicipios(geo);
      syncRef.current?.();
    }).catch(err => console.warn("[PointsMap] no se pudieron cargar los municipios:", err));
    return () => { activo = false; };
  }, []);

  useImperativeHandle(ref, () => ({
    async capturePng() {
      const map = mapRef.current;
      if (!map) return null;
      // La animación mantiene el mapa ocupado; pausarla permite esperar 'idle'.
      cancelAnimationFrame(animacionRef.current);
      animacionRef.current = null;
      try {
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
      } finally {
        iniciarAnimacionRef.current?.();
      }
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
        customAttribution: "Focos de calor: NASA FIRMS · Municipios: Ministerio de Ecología y RNR",
      }),
      "bottom-right"
    );

    map.on("error", (e) => {
      const msg = e?.error?.message || "";
      if (!/40\d|Failed to fetch|AbortError/.test(msg)) console.warn("[PointsMap] error:", msg);
    });
    mapRef.current = map;
    let estiloListo = false;
    const sync = () => {
      // style.load ya permite agregar capas; isStyleLoaded espera también
      // recursos del fondo y retrasa innecesariamente municipios y focos.
      if (!estiloListo) return;
      if (municipiosRef.current && !map.getSource("municipios")) {
        map.addSource("municipios", { type: "geojson", data: municipiosRef.current });
        const before = map.getStyle().layers.find(l => l.type === "symbol")?.id;
        map.addLayer({ id: "municipios-limites", type: "line", source: "municipios",
          paint: { "line-color": "#37675f", "line-width": 1, "line-opacity": 0.85 } }, before);
        map.addLayer({ id: "municipios-nombres", type: "symbol", source: "municipios", minzoom: 6.5,
          layout: { "text-field": ["get", "nombre"], "text-font": ["Noto Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 6.5, 10, 11, 14], "text-max-width": 9 },
          paint: { "text-color": "#1b4339", "text-halo-color": "#e8f5ef", "text-halo-width": 1.5 } }, before);
      }
      const geojson = agregarMunicipios(puntosRef.current, indiceMunicipiosRef.current) || {type: 'FeatureCollection', features: []};
      if (map.getSource('focos')) { map.getSource('focos').setData(geojson); return; }
      map.addSource('focos', {type: 'geojson', data: geojson});
      const color = ['match', ['get', 'Intensidad'], 1, COLORES_INTENSIDAD[1], 2, COLORES_INTENSIDAD[2], 3, COLORES_INTENSIDAD[3], 4, COLORES_INTENSIDAD[4], 5, COLORES_INTENSIDAD[5], COLORES_INTENSIDAD[0]];
      map.addLayer({id: 'focos-eco', type: 'circle', source: 'focos', paint: {
        'circle-radius': 9,
        // Con animación nace transparente (el pulso lo hace aparecer suave); con movimiento reducido queda fijo y visible.
        'circle-color': color, 'circle-opacity': window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.35 : 0,
      }});
      map.addLayer({id: 'focos-punto', type: 'circle', source: 'focos', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 10, 9],
        'circle-color': color, 'circle-stroke-color': '#fff3e6', 'circle-stroke-width': 1, 'circle-opacity': 0.95,
      }});
    };
    syncRef.current = sync;
    map.on('style.load', () => { estiloListo = true; sync(); });
    let ultimoCuadro = 0;
    const animar = (tiempo) => {
      animacionRef.current = null;
      if (tiempo - ultimoCuadro >= 32 && !document.hidden && puntosRef.current?.features?.length && map.getLayer('focos-eco')) {
        ultimoCuadro = tiempo;
        const { radio, opacidad } = pulsoDeFoco((tiempo % CICLO_MS) / CICLO_MS);
        const escala = Math.max(0.65, Math.min(1.5, map.getZoom() / 7));
        map.setPaintProperty('focos-eco', 'circle-radius', radio * escala);
        map.setPaintProperty('focos-eco', 'circle-opacity', opacidad);
      }
      if (!document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && puntosRef.current?.features?.length) animacionRef.current = requestAnimationFrame(animar);
    };
    const iniciarAnimacion = () => {
      if (!animacionRef.current && !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && puntosRef.current?.features?.length) {
        animacionRef.current = requestAnimationFrame(animar);
      }
    };
    iniciarAnimacionRef.current = iniciarAnimacion;
    map.on('style.load', iniciarAnimacion);
    document.addEventListener('visibilitychange', iniciarAnimacion);
    iniciarAnimacion();
    map.on('mouseenter', 'focos-punto', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'focos-punto', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'focos-punto', e => setActivo(e.features?.[0]?.properties || null));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(mapContainerRef.current);
    // Los listeners ya están instalados cuando empieza la carga del estilo.
    map.setStyle(BASEMAP_STYLE, { transformStyle: prepararEstilo });
    return () => { ro.disconnect(); document.removeEventListener('visibilitychange', iniciarAnimacion); cancelAnimationFrame(animacionRef.current); animacionRef.current = null; iniciarAnimacionRef.current = null; syncRef.current = null; mapRef.current = null; map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OpenFreeMap aporta el fondo; encima se ven los municipios y los focos.

  useEffect(() => {
    syncRef.current?.();
    iniciarAnimacionRef.current?.();
  }, [puntos]);

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

      <div className="heat-map-note">
        <strong>¿Qué indica un foco de calor?</strong>
        <span>Es una anomalía térmica detectada por satélite. Marca aproximadamente el centro del píxel observado; por sí sola no confirma un incendio. La <b>intensidad</b> (1 a 5) sale de la potencia del fuego; la <b>confianza</b> (baja, media o alta) dice qué tan seguro está el satélite de que es fuego activo.</span>
        <a href="https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_MODIS_Firehotspots.html" target="_blank" rel="noopener noreferrer">Cómo interpreta NASA FIRMS estos datos ↗</a>
      </div>

      {activo && (
        <div className="info-card" role="dialog" aria-label="Foco de calor"
          style={{ "--foco-color": COLORES_INTENSIDAD[Number(activo.Intensidad)] || COLORES_INTENSIDAD[0] }}>
          <button className="info-card__close" onClick={() => setActivo(null)} aria-label="Cerrar">
            ✕
          </button>
          <div className="info-card__hero">
            <span className="info-card__pulse" aria-hidden="true" />
            <div>
              <span className="info-card__eyebrow">Foco de calor detectado</span>
              <h3 className="info-card__nombre">{activo.municipio || "Municipio por determinar"}</h3>
            </div>
          </div>
          {activo.Intensidad != null && <div className="info-card__level">
            <span>Intensidad</span><strong>{activo.Intensidad}<small> / 5 · {INTENSIDADES[activo.Intensidad] || ""}</small></strong>
          </div>}
          {confianza && <div className={`info-card__level info-card__confianza info-card__confianza--${confianza.nivel}`}>
            <span>Confianza</span><strong>{confianza.etiqueta}{confianza.valor != null && <small> · {confianza.valor} %</small>}</strong>
          </div>}
          <p className="heat-map-note__popup">
            {activo.Intensidad != null && <>La intensidad se calcula con la potencia radiativa del fuego (FRP). </>}
            {confianza ? <>{confianza.detalle} </> : null}
            No mide riesgo de incendio.
          </p>
          <ul className="info-card__props">
            {Object.entries(activo)
              .filter(([k, v]) => v != null && v !== "" && !["municipio", "Intensidad", "confidence"].includes(k) && !(k === "anpNombre" && !activo.vinculadoAANP))
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
