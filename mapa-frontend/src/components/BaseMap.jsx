import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import maplibregl from "maplibre-gl";
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

// Vista inicial: el globo entero, con Sudamérica de frente.
const VISTA_GLOBO = { center: [-58, -18], zoom: 1.5, pitch: 0, bearing: 0 };

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

// Puntos donde cae el rótulo de cada territorio vecino.
const ROTULOS_REGION = [
  { texto: "PARAGUAY", lngLat: [-56.0, -26.4] },
  { texto: "BRASIL", lngLat: [-53.2, -26.0] },
  { texto: "CORRIENTES", lngLat: [-56.4, -28.1] },
  { texto: "BRASIL", lngLat: [-53.6, -27.6] },
];

const BaseMap = forwardRef(function BaseMap(
  {
    municipiosGeojson,
    mundoGeojson,
    pronostico,
    viento,
    titulo,
    publicadoEn,
    interactive = true,
    intro = true,
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
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#0b1a28" },
          },
        ],
        sky: {
          "sky-color": "#0a1622",
          "sky-horizon-blend": 0.5,
          "horizon-color": "#20303f",
          "horizon-fog-blend": 0.5,
          "fog-color": "#0a1016",
          "fog-ground-blend": 0.2,
          "atmosphere-blend": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            1,
            6,
            0.4,
            9,
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
      // Las teselas del DEM fuera de Misiones dan 404 — es esperable.
      const msg = e?.error?.message || "";
      if (!/40\d|Failed to fetch|AbortError/.test(msg)) {
        console.warn("[BaseMap] error de MapLibre:", msg);
      }
    });

    // `load` puede no dispararse si alguna tesela del DEM falla; por eso
    // gatillamos con el estilo listo, no con los tiles.
    let introHecha = false;
    const alEstarListo = () => {
      if (mapRef.current !== map || introHecha) return;
      introHecha = true;
      // Sin `setTerrain`: el relieve real desplaza la proyección y
      // descoloca los marcadores. El hillshade da textura suficiente y la
      // extrusión de los municipios aporta el 3D que importa (temperatura).
      setMapReady(true);
      if (!arranqueDirecto) {
        // Se mantiene un instante sobre el globo y después baja a Misiones.
        setTimeout(() => {
          if (mapRef.current !== map) return;
          map.flyTo({
            center: CENTRO_MISIONES,
            zoom: ZOOM_INICIAL,
            pitch: PITCH_INICIAL,
            bearing: BEARING_INICIAL,
            duration: 4200,
            curve: 1.5,
            essential: true,
          });
        }, 700);
      }
    };
    map.once("load", alEstarListo);
    // Red de seguridad por si `load` no llega (teselas DEM con 404).
    map.once("styledata", () => setTimeout(alEstarListo, 1200));

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

  // --- Mundo con división política (todos los países) + rótulos ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !mundoGeojson || map.getSource("mundo")) return;

    map.addSource("mundo", { type: "geojson", data: mundoGeojson });

    // Tierra firme (plana).
    map.addLayer({
      id: "mundo-fill",
      type: "fill",
      source: "mundo",
      paint: { "fill-color": "#22352b" },
    });
    // Límites políticos de todo el globo — bien marcados.
    map.addLayer({
      id: "mundo-line",
      type: "line",
      source: "mundo",
      paint: {
        "line-color": "#9fb6a6",
        "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.8, 4, 1.3, 9, 2],
        "line-opacity": 0.9,
      },
    });

    const rotulos = ROTULOS_REGION.map(({ texto, lngLat }) => {
      const el = document.createElement("div");
      el.className = "region-label";
      el.textContent = texto;
      return new maplibregl.Marker({ element: el })
        .setLngLat(lngLat)
        .addTo(map);
    });

    return () => rotulos.forEach((r) => r.remove());
  }, [mapReady, mundoGeojson]);

  // --- Capa de municipios ---
  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !mapReady ||
      !municipiosGeojson ||
      map.getSource("municipios")
    )
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

    // Arranca cuando la cámara está quieta, para no competir con la
    // animación de entrada (globo → Misiones).
    let cancelado = false;
    const arrancar = () => {
      if (!cancelado) windLayerRef.current?.start();
    };
    if (map.isMoving()) {
      map.once("moveend", arrancar);
      setTimeout(arrancar, 8000); // por las dudas
    } else {
      arrancar();
    }

    return () => {
      cancelado = true;
      map.off("moveend", arrancar);
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
