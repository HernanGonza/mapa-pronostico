import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import maplibregl from "maplibre-gl";
import { API_URL } from "../config";
import { colorPorCondicion } from "../lib/condiciones";
import { WindParticleLayer } from "../lib/windParticles";
import { tiempoRelativo } from "../lib/tiempoRelativo";
import WeatherIcon from "./WeatherIcon";
import Legend from "./Legend";

// MapLibre usa [lng, lat], al revés que Leaflet
const CENTRO_MISIONES = [-54.8, -27.0];
const ZOOM_INICIAL = 7.4;
const PITCH_INICIAL = 50;
const BEARING_INICIAL = -8;

// Vista inicial del intro: Sudamérica desde arriba (se ve la curvatura
// del globo) y de ahí baja a Misiones.
const VISTA_GLOBO = { center: [-58, -22], zoom: 2.6, pitch: 0, bearing: 0 };

const COLOR_SIN_DATO = "#c9d3a3";

const prefiereMenosMovimiento =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** MapLibre GL v4 sacó `maplibregl.supported()`; chequeamos WebGL a mano. */
function soportaWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext("webgl") || c.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

/**
 * Altura de extrusión en función de la temperatura máxima. Escala de
 * visualización (no metros): a esta escala de mapa una altura real sería
 * invisible. El factor es bajo a propósito para que las columnas no se
 * tapen entre sí — el color (condición) es la variable principal, la
 * altura (temperatura) es secundaria.
 */
function alturaPorTemperatura(tmax) {
  const n = parseFloat(tmax);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, n) * 90;
}

const BaseMap = forwardRef(function BaseMap(
  {
    municipiosGeojson,
    mundoGeojson,
    paisesLabels,
    provincias,
    provinciasLabels,
    pronostico,
    viento,
    titulo,
    publicadoEn,
    interactive = true,
    // El intro cinematográfico (globo → Misiones) quedó desactivado por
    // defecto: era inestable con toda la data cargando a la vez. El mapa
    // abre directo en Misiones; se puede alejar para ver el globo.
    intro = false,
    enableCapture = false,
  },
  ref
) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const windCanvasRef = useRef(null);
  const windLayerRef = useRef(null);
  const datosPorId = useRef(new Map());
  const selectedIdRef = useRef(null);

  const [mapReady, setMapReady] = useState(false);
  const [webglOk] = useState(soportaWebGL);
  const [activo, setActivo] = useState(null); // municipio "abierto" en la tarjeta
  const relativo = useMemo(() => tiempoRelativo(publicadoEn), [publicadoEn]);

  useImperativeHandle(ref, () => ({
    capturePng() {
      const map = mapRef.current;
      if (!map) return null;
      const mapCanvas = map.getCanvas();
      const out = document.createElement("canvas");
      out.width = mapCanvas.width;
      out.height = mapCanvas.height;
      const ctx = out.getContext("2d");
      ctx.drawImage(mapCanvas, 0, 0);
      if (windCanvasRef.current) {
        ctx.drawImage(windCanvasRef.current, 0, 0, out.width, out.height);
      }
      return out.toDataURL("image/png");
    },
  }));

  function seleccionar(id) {
    const map = mapRef.current;
    if (selectedIdRef.current && map?.getSource("municipios")) {
      map.setFeatureState(
        { source: "municipios", id: selectedIdRef.current },
        { selected: false }
      );
    }
    selectedIdRef.current = id;
    if (id && map?.getSource("municipios")) {
      map.setFeatureState({ source: "municipios", id }, { selected: true });
      setActivo(datosPorId.current.get(id) || null);
    } else {
      setActivo(null);
    }
  }

  // --- Inicialización del mapa (una vez) ---
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !webglOk) return;

    const arranqueDirecto = prefiereMenosMovimiento || !interactive || !intro;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        // Proyección de globo (estilo earth.nullschool): al alejarse se ve
        // la Tierra como esfera, al acercarse se aplana sola.
        projection: { type: "globe" },
        glyphs: `${API_URL}/glyphs/{fontstack}/{range}.pbf`,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#0e2233" },
          },
        ],
        sky: {
          "sky-color": "#0a1622",
          "sky-horizon-blend": 0.4,
          "horizon-color": "#24384a",
          "horizon-fog-blend": 0.4,
          "fog-color": "#0c141c",
          "fog-ground-blend": 0.1,
          // Poco velo atmosférico sobre la superficie: si no, el globo se
          // ve como una bola azul lisa sin continentes.
          "atmosphere-blend": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            0.4,
            4,
            0.15,
            7,
            0,
          ],
        },
      },
      center: arranqueDirecto ? CENTRO_MISIONES : VISTA_GLOBO.center,
      zoom: arranqueDirecto ? ZOOM_INICIAL : VISTA_GLOBO.zoom,
      pitch: arranqueDirecto ? PITCH_INICIAL : VISTA_GLOBO.pitch,
      bearing: arranqueDirecto ? BEARING_INICIAL : VISTA_GLOBO.bearing,
      // Rotación e inclinación libres en todos los ejes.
      maxPitch: 85,
      dragRotate: interactive,
      touchZoomRotate: interactive,
      touchPitch: interactive,
      scrollZoom: interactive,
      dragPan: interactive,
      doubleClickZoom: interactive,
      keyboard: interactive,
      attributionControl: false,
      preserveDrawingBuffer: enableCapture,
    });

    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          "Viento: Open-Meteo · Relieve y límites: Subsecretaría de Ordenamiento Territorial (Misiones)",
      }),
      "bottom-right"
    );
    if (interactive) {
      map.addControl(
        new maplibregl.NavigationControl({ visualizePitch: true }),
        "top-right"
      );
    }

    map.on("error", (e) => {
      const msg = e?.error?.message || "";
      if (!/40\d|Failed to fetch|AbortError/.test(msg)) {
        console.warn("[BaseMap] error de MapLibre:", msg);
      }
    });

    // MapLibre v5 (globo) a veces no repinta al terminar de cargar una
    // fuente GeoJSON y el mapa queda en blanco hasta que algo lo toca.
    map.on("sourcedata", () => map.triggerRepaint());
    map.on("styledata", () => map.triggerRepaint());

    const alEstarListo = () => {
      if (mapRef.current !== map) return;
      setMapReady(true);
      let n = 0;
      const kick = setInterval(() => {
        if (mapRef.current !== map || n++ > 24) return clearInterval(kick);
        map.triggerRepaint();
      }, 300);
      if (!arranqueDirecto) {
        setTimeout(() => {
          if (mapRef.current !== map) return;
          map.flyTo({
            center: CENTRO_MISIONES,
            zoom: ZOOM_INICIAL,
            pitch: PITCH_INICIAL,
            bearing: BEARING_INICIAL,
            duration: 3400,
            curve: 1.5,
            essential: true,
          });
        }, 600);
      }
    };
    if (map.isStyleLoaded()) alEstarListo();
    else map.once("load", alEstarListo);

    // Con el globo alejado, los marcadores HTML (estaciones, rótulos) se
    // proyectan mal — se ocultan por debajo de cierto zoom.
    const onZoomGlobo = () => {
      mapContainerRef.current?.parentElement?.classList.toggle(
        "base-map--lejos",
        map.getZoom() < 4
      );
    };
    map.on("zoom", onZoomGlobo);
    onZoomGlobo();

    mapRef.current = map;
    if (import.meta.env?.DEV) window.__map = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- División política: países + provincias/estados + rótulos ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !mundoGeojson || map.getSource("mundo")) return;

    const FUENTE = ["Metropolis Regular"];
    // Los países y provincias van DEBAJO de los municipios de Misiones.
    const bajoMunicipios = map.getLayer("municipios-fill")
      ? "municipios-fill"
      : undefined;

    // Países: tierra firme + fronteras (todo el globo).
    map.addSource("mundo", { type: "geojson", data: mundoGeojson });
    map.addLayer(
      {
        id: "mundo-fill",
        type: "fill",
        source: "mundo",
        paint: { "fill-color": "#3a5a45" },
      },
      bajoMunicipios
    );
    map.addLayer(
      {
        id: "mundo-line",
        type: "line",
        source: "mundo",
        paint: {
          "line-color": "#b7cabd",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            0.9,
            4,
            1.6,
            9,
            2.4,
          ],
          "line-opacity": 0.95,
        },
      },
      bajoMunicipios
    );

    // Provincias / estados de los vecinos (influyen en el clima de Misiones).
    map.addSource("provincias", { type: "geojson", data: provincias });
    map.addLayer(
      {
        id: "provincias-line",
        type: "line",
        source: "provincias",
        minzoom: 3.5,
        paint: {
          "line-color": "#8aa294",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 9, 1.4],
          "line-opacity": 0.7,
          "line-dasharray": [2, 1.5],
        },
      },
      bajoMunicipios
    );

    // Rótulos de países.
    map.addSource("paises-labels", { type: "geojson", data: paisesLabels });
    map.addLayer({
      id: "paises-labels",
      type: "symbol",
      source: "paises-labels",
      maxzoom: 6.5,
      layout: {
        "text-field": ["get", "nombre"],
        "text-font": FUENTE,
        "text-size": ["interpolate", ["linear"], ["zoom"], 1.5, 10, 5, 15],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.12,
        "text-max-width": 7,
      },
      paint: {
        "text-color": "#dbe6dd",
        "text-halo-color": "#0e1a16",
        "text-halo-width": 1.4,
        "text-opacity": 0.85,
      },
    });

    // Rótulos de provincias/estados.
    map.addSource("provincias-labels", {
      type: "geojson",
      data: provinciasLabels,
    });
    map.addLayer({
      id: "provincias-labels",
      type: "symbol",
      source: "provincias-labels",
      minzoom: 3.8,
      layout: {
        "text-field": ["get", "nombre"],
        "text-font": FUENTE,
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 15],
        "text-letter-spacing": 0.06,
        "text-max-width": 8,
      },
      paint: {
        "text-color": "#d6e2da",
        "text-halo-color": "#0b1512",
        "text-halo-width": 1.6,
        "text-opacity": ["interpolate", ["linear"], ["zoom"], 3.8, 0.6, 5.5, 1],
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mundoGeojson, provincias, paisesLabels, provinciasLabels]);

  // --- Capa de municipios ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !municipiosGeojson || map.getSource("municipios"))
      return;

    map.addSource("municipios", {
      type: "geojson",
      data: municipiosGeojson,
      promoteId: "id",
    });

    map.addLayer({
      id: "municipios-fill",
      type: "fill-extrusion",
      source: "municipios",
      paint: {
        "fill-extrusion-height": ["coalesce", ["feature-state", "height"], 0],
        "fill-extrusion-base": 0,
        "fill-extrusion-color": [
          "coalesce",
          ["feature-state", "color"],
          COLOR_SIN_DATO,
        ],
        "fill-extrusion-opacity": 0.9,
        "fill-extrusion-vertical-gradient": true,
      },
    });

    // Contorno marcado entre municipios: muchos comparten color (misma
    // condición), así que la línea es lo que los separa visualmente.
    map.addLayer({
      id: "municipios-outline",
      type: "line",
      source: "municipios",
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "#ffffff",
          "#f4efe2",
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          2.8,
          1.3,
        ],
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          1,
          0.75,
        ],
      },
    });

    if (interactive) {
      map.on("mouseenter", "municipios-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "municipios-fill", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", (e) => {
        const hit = map.queryRenderedFeatures(e.point, {
          layers: ["municipios-fill"],
        });
        if (hit.length) seleccionar(hit[0].properties.id);
        else seleccionar(null);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, municipiosGeojson, interactive]);

  // --- Datos por municipio (altura/color) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !pronostico || !map.getSource("municipios"))
      return;

    const nuevo = new Map();
    for (const m of pronostico) {
      nuevo.set(m.id, m);
      const p = m.pronostico;
      map.setFeatureState(
        { source: "municipios", id: m.id },
        p
          ? {
              height: alturaPorTemperatura(p.TMAX),
              color: colorPorCondicion(p.CONDICION),
            }
          : { height: 0, color: COLOR_SIN_DATO }
      );
    }
    datosPorId.current = nuevo;
    if (selectedIdRef.current) setActivo(nuevo.get(selectedIdRef.current) || null);
  }, [pronostico, mapReady]);

  // --- Partículas de viento ---
  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !mapReady ||
      !viento ||
      !windCanvasRef.current ||
      prefiereMenosMovimiento
    )
      return;

    windLayerRef.current?.destroy();
    windLayerRef.current = new WindParticleLayer(
      map,
      windCanvasRef.current,
      viento
    );

    // Arranca ya: el propio loop no dibuja mientras la cámara se mueve
    // (evita los trazos largos durante el intro).
    windLayerRef.current.start();

    return () => {
      windLayerRef.current?.destroy();
      windLayerRef.current = null;
    };
  }, [viento, mapReady]);

  if (!webglOk) {
    return (
      <div className="base-map base-map--fallback">
        <div>
          <strong>Tu navegador no puede mostrar el mapa 3D.</strong>
          <p>
            Necesitás un navegador con WebGL activo (Chrome, Firefox o Edge
            actualizados).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="base-map">
      <div ref={mapContainerRef} className="base-map__canvas-container" />
      <canvas ref={windCanvasRef} className="base-map__wind-canvas" />

      {titulo && (
        <div className="map-title">
          <img src="/brand/ecologia-flor.png" alt="" width={30} height={30} />
          <div>
            <strong>{titulo}</strong>
            {relativo && (
              <span className="map-title__meta">actualizado {relativo}</span>
            )}
          </div>
        </div>
      )}

      <Legend startOpen={typeof window !== "undefined" && window.innerWidth > 640} />

      {activo && (
        <div className="info-card" role="dialog" aria-label={`Pronóstico de ${activo.nombre}`}>
          <button
            className="info-card__close"
            onClick={() => seleccionar(null)}
            aria-label="Cerrar"
          >
            ✕
          </button>
          <h3 className="info-card__nombre">{activo.nombre}</h3>

          {!activo.esOficial && activo.estacionReferencia && (
            <p className="info-card__ref">
              Dato de la estación más cercana:{" "}
              <b>{activo.estacionReferencia}</b> ({activo.distanciaKm} km)
            </p>
          )}
          {activo.esOficial && (
            <p className="info-card__ref info-card__ref--oficial">
              Estación oficial de Alerta Temprana
            </p>
          )}

          {activo.pronostico ? (
            <div className="info-card__prono">
              <WeatherIcon condicion={activo.pronostico.CONDICION} size={56} />
              <div>
                <div className="info-card__temps">
                  <span className="info-card__tmin">
                    {activo.pronostico.TMIN}°
                  </span>
                  <span className="info-card__tmax">
                    {activo.pronostico.TMAX}°
                  </span>
                </div>
                <div className="info-card__cond">
                  {activo.pronostico.CONDICION}
                </div>
              </div>
            </div>
          ) : (
            <p className="info-card__ref">Sin pronóstico publicado todavía.</p>
          )}
        </div>
      )}
    </div>
  );
});

export default BaseMap;
