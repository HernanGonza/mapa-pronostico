import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import maplibregl from "maplibre-gl";
import { API_URL } from "../config";
import { soportaWebGL } from "../lib/soportaWebGL";
import { BASEMAP_STYLES } from "./BaseMap";
import { prepararEstilo } from "../lib/mapStyle";

const CENTRO_MISIONES = [-54.8, -27.0];
const ZOOM_INICIAL = 7.4;
const ETIQUETAS = { localidad: "Localidad", municipio: "Municipio", fecha: "Fecha", confidence: "Confianza", frp: "Potencia" };

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

  const marcarSucio = useCallback(() => {
    const m = mapRef.current;
    if (!m) return;
    try {
      m._frameRequest = null;
      m.redraw();
    } catch {
      /* el estilo todavía no está listo */
    }
  }, []);

  const conEstilo = useCallback((fn) => {
    let cancel = false;
    let intentos = 0;
    const intentar = () => {
      if (cancel) return;
      const map = mapRef.current;
      if (!map) {
        setTimeout(intentar, 120);
        return;
      }
      try {
        fn(map);
      } catch (e) {
        intentos++;
        if (intentos > 400) {
          console.warn("[PointsMap] conEstilo se rindió:", e.message);
          return;
        }
        setTimeout(intentar, 80);
      }
    };
    intentar();
    return () => {
      cancel = true;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    capturePng() {
      const map = mapRef.current;
      if (!map) return null;
      map.redraw();
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
      preserveDrawingBuffer: enableCapture,
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
    map.setStyle(BASEMAP_STYLES.positron, { transformStyle: prepararEstilo });

    // Mismo destrabe que BaseMap: fuentes solo-GeoJSON a veces dejan el
    // primer frame sin pintar hasta el próximo drag del usuario.
    const destrabar = () => {
      if (mapRef.current !== map) return;
      try {
        const c = map.getCenter();
        map.jumpTo({ center: [c.lng + 1e-6, c.lat] });
        map._frameRequest = null;
        map.redraw();
      } catch {
        /* estilo no listo aún */
      }
    };
    let setupListo = false;
    const onSetup = () => {
      if (!setupListo && mapRef.current === map) destrabar();
    };
    map.once("load", destrabar);
    map.on("styledata", onSetup);
    const burst = [0, 60, 130, 220, 330, 460, 620, 820, 1050, 1350, 1750, 2300, 3000, 4000].map((ms) =>
      setTimeout(destrabar, ms)
    );
    const finSetup = setTimeout(() => {
      setupListo = true;
      map.off("styledata", onSetup);
    }, 12000);

    const ro = new ResizeObserver(() => {
      try {
        map.resize();
      } catch {
        /* noop */
      }
      destrabar();
    });
    ro.observe(mapContainerRef.current);

    mapRef.current = map;
    return () => {
      burst.forEach(clearTimeout);
      clearTimeout(finSetup);
      ro.disconnect();
      map.off("styledata", onSetup);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OpenFreeMap ya aporta países, provincias, fronteras y rótulos. No se
  // agregan capas oscuras propias: así esta vista comparte exactamente la
  // misma base cartográfica que pronóstico y riesgo.

  // --- Puntos (focos) ---
  useEffect(() => {
    return conEstilo((map) => {
      const geojson = puntos || { type: "FeatureCollection", features: [] };
      if (map.getSource("focos")) {
        map.getSource("focos").setData(geojson);
      } else {
        map.addSource("focos", { type: "geojson", data: geojson });
        map.addLayer({
          id: "focos-calor",
          type: "heatmap",
          source: "focos",
          maxzoom: 12,
          paint: {
            "heatmap-weight": ["interpolate", ["linear"], ["get", "Intensidad"], 0, 0, 1, 0.35, 100, 1],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 5, 0.8, 10, 1.8],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 5, 16, 10, 30],
            "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(255, 209, 102, 0)", 0.2, "#ffd166", 0.45, "#ff7b25", 0.8, "#e31a1c", 1, "#8b0000"],
            "heatmap-opacity": 0.78,
          },
        });
        map.addLayer({
          id: "focos-punto",
          type: "circle",
          source: "focos",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4, 10, 9],
            "circle-color": ["interpolate", ["linear"], ["get", "Intensidad"], 0, "#ffd166", 25, "#ff7b25", 100, "#e31a1c"],
            "circle-stroke-color": "#fff3e6",
            "circle-stroke-width": 1,
            "circle-opacity": 0.9,
          },
        });
        map.addLayer({
          id: "focos-eco",
          type: "circle",
          source: "focos",
          paint: {
            "circle-radius": 7,
            "circle-color": "rgba(255, 123, 37, 0)",
            "circle-stroke-color": ["interpolate", ["linear"], ["get", "Intensidad"], 0, "#ffd166", 25, "#ff7b25", 100, "#e31a1c"],
            "circle-stroke-width": 2,
            "circle-opacity": 0.7,
          },
        });
        map.on("mouseenter", "focos-punto", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "focos-punto", () => (map.getCanvas().style.cursor = ""));
        map.on("click", "focos-punto", (e) => {
          setActivo(e.features[0]?.properties || null);
        });
      }
      marcarSucio();
    });
  }, [puntos, conEstilo, marcarSucio]);

  // Pulso sutil sobre los focos: ayuda a identificar que son alertas activas
  // sin convertir el mapa en una animación pesada.
  useEffect(() => {
    const timer = setInterval(() => {
      const map = mapRef.current;
      if (!map?.getLayer("focos-punto")) return;
      const fase = (Date.now() % 1600) / 1600;
      const pulso = 0.82 + Math.sin(fase * Math.PI * 2) * 0.12;
      const eco = fase < 0.5 ? fase * 2 : 2 - fase * 2;
      try {
        map.setPaintProperty("focos-punto", "circle-opacity", pulso);
        map.setPaintProperty("focos-punto", "circle-stroke-width", 1 + (pulso - 0.7) * 2);
        if (map.getLayer("focos-eco")) {
          map.setPaintProperty("focos-eco", "circle-radius", 7 + eco * 18);
          map.setPaintProperty("focos-eco", "circle-opacity", 0.72 * (1 - eco));
        }
      } catch { /* el estilo puede estar cambiando */ }
    }, 90);
    return () => clearInterval(timer);
  }, []);

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
            {Object.entries(activo).map(([k, v]) => (
              <li key={k}>
                <b>{ETIQUETAS[k] || k}:</b> {String(v)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

export default PointsMap;
