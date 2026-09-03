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

const CENTRO_MISIONES = [-54.8, -27.0];
const ZOOM_INICIAL = 7.4;

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
      style: {
        version: 8,
        glyphs: `${API_URL}/glyphs/{fontstack}/{range}.pbf`,
        sources: {},
        layers: [{ id: "background", type: "background", paint: { "background-color": "#0e2233" } }],
      },
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

  // --- Fondo: mundo + provincias ---
  useEffect(() => {
    if (!mundoGeojson) return undefined;
    return conEstilo((map) => {
      if (map.getSource("mundo")) return;
      map.addSource("mundo", { type: "geojson", data: mundoGeojson });
      map.addLayer({ id: "mundo-fill", type: "fill", source: "mundo", paint: { "fill-color": "#31513d" } });
      map.addLayer({
        id: "mundo-line",
        type: "line",
        source: "mundo",
        paint: { "line-color": "#b7cabd", "line-width": 1, "line-opacity": 0.9 },
      });
      if (paisesLabels) {
        map.addSource("paises-labels", { type: "geojson", data: paisesLabels });
        map.addLayer({
          id: "paises-labels",
          type: "symbol",
          source: "paises-labels",
          maxzoom: 6.5,
          layout: {
            "text-field": ["get", "nombre"],
            "text-font": ["Metropolis Regular"],
            "text-size": 11,
            "text-transform": "uppercase",
          },
          paint: { "text-color": "#dbe6dd", "text-halo-color": "#0e1a16", "text-halo-width": 1.4 },
        });
      }
      if (provincias) {
        map.addSource("provincias", { type: "geojson", data: provincias });
        map.addLayer({
          id: "provincias-line",
          type: "line",
          source: "provincias",
          paint: { "line-color": "#8aa294", "line-width": 0.8, "line-dasharray": [2, 1.6] },
        });
      }
      if (provinciasLabels) {
        map.addSource("provincias-labels", { type: "geojson", data: provinciasLabels });
        map.addLayer({
          id: "provincias-labels",
          type: "symbol",
          source: "provincias-labels",
          minzoom: 3.8,
          layout: { "text-field": ["get", "nombre"], "text-font": ["Metropolis Regular"], "text-size": 11 },
          paint: { "text-color": "#d6e2da", "text-halo-color": "#0b1512", "text-halo-width": 1.6 },
        });
      }
      marcarSucio();
    });
  }, [mundoGeojson, paisesLabels, provincias, provinciasLabels, conEstilo, marcarSucio]);

  // --- Puntos (focos) ---
  useEffect(() => {
    return conEstilo((map) => {
      const geojson = puntos || { type: "FeatureCollection", features: [] };
      if (map.getSource("focos")) {
        map.getSource("focos").setData(geojson);
      } else {
        map.addSource("focos", { type: "geojson", data: geojson });
        map.addLayer({
          id: "focos-punto",
          type: "circle",
          source: "focos",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3, 10, 7],
            "circle-color": "#ff5a1f",
            "circle-stroke-color": "#fff3e6",
            "circle-stroke-width": 1,
            "circle-opacity": 0.85,
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
                <b>{k}:</b> {String(v)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

export default PointsMap;
