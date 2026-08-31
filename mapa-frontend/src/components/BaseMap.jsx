import {
  forwardRef,
  useCallback,
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
import { generarCapaClima, horaActual, horaActualFrac } from "../lib/campoClima";
import { CapaClimaAnimada } from "../lib/capaClimaAnim";
import { tiempoRelativo } from "../lib/tiempoRelativo";
import WeatherIcon from "./WeatherIcon";
import Legend from "./Legend";
import LayerPanel from "./LayerPanel";
import StreetViewPanel from "./StreetViewPanel";

const CENTRO_MISIONES = [-54.8, -27.0];
const ZOOM_INICIAL = 7.4;
const PITCH_INICIAL = 48;
const BEARING_INICIAL = -7;

// Vista inicial del intro cinematográfico: Sudamérica desde el espacio.
const VISTA_GLOBO = { center: [-58, -20], zoom: 2.4, pitch: 0, bearing: 0 };

const COLOR_SIN_DATO = "#c9d3a3";

// Orden canónico de capas (de abajo hacia arriba). Se reaplica cada vez
// que se agrega una capa, así el z-order siempre queda bien.
const ORDEN_CAPAS = [
  "background",
  "mundo-fill",
  "mundo-line",
  "provincias-line",
  "capa-temp",
  "municipios-fill",
  // Nubes y lluvia van POR ENCIMA del relleno: se ven pasar sobre los
  // municipios, como en un mapa del tiempo de TV...
  "capa-nubes",
  "capa-lluvia",
  // ...pero el contorno de los municipios queda SIEMPRE por encima.
  "municipios-outline",
  "municipios-label",
  "paises-labels",
  "provincias-labels",
];

const CAPAS_DEFAULT = { nubes: true, lluvia: false, viento: true, temp: false };

const prefiereMenosMovimiento =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

function alturaPorTemperatura(tmax) {
  const n = parseFloat(tmax);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, n) * 90;
}

/** Centroide (promedio de vértices del anillo exterior). */
function centroide(feature) {
  const g = feature.geometry;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  let x = 0;
  let y = 0;
  let k = 0;
  for (const poly of polys) {
    for (const [px, py] of poly[0]) {
      x += px;
      y += py;
      k += 1;
    }
  }
  return k ? [x / k, y / k] : null;
}

function ordenarCapas(map) {
  for (let i = ORDEN_CAPAS.length - 1; i >= 0; i--) {
    const id = ORDEN_CAPAS[i];
    if (!map.getLayer(id)) continue;
    const despues = ORDEN_CAPAS.slice(i + 1).find((x) => map.getLayer(x));
    try {
      map.moveLayer(id, despues);
    } catch {
      /* noop */
    }
  }
}

const BaseMap = forwardRef(function BaseMap(
  {
    municipiosGeojson,
    mundoGeojson,
    paisesLabels,
    provincias,
    provinciasLabels,
    pronostico,
    clima,
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
  const capasAnimRef = useRef({}); // { nubes: CapaClimaAnimada, lluvia: ... }
  const datosPorId = useRef(new Map());
  const selectedIdRef = useRef(null);
  const horaRef = useRef(0);
  // Getter de hora (fraccionaria) para las capas animadas: sigue el vivo
  // cuando el slider está en "ahora", o la hora elegida si se movió.
  const horaGetterRef = useRef(() => 0);

  const [mapReady, setMapReady] = useState(false);
  const [webglOk] = useState(soportaWebGL);
  const [activo, setActivo] = useState(null);
  const [capas, setCapas] = useState(CAPAS_DEFAULT);
  const [hora, setHora] = useState(0);
  const [streetView, setStreetView] = useState(null); // { nombre, lngLat }
  const relativo = useMemo(() => tiempoRelativo(publicadoEn), [publicadoEn]);

  const horaAhora = useMemo(() => (clima ? horaActual(clima) : 0), [clima]);
  useEffect(() => {
    if (clima) {
      const h = horaActual(clima);
      setHora(h);
      horaRef.current = h;
    }
  }, [clima]);
  useEffect(() => {
    horaRef.current = hora;
  }, [hora]);

  // El getter que usan las capas animadas: en "ahora" devuelve la hora
  // fraccionaria real (mapa en vivo); si el operador movió el slider,
  // devuelve esa hora fija.
  useEffect(() => {
    horaGetterRef.current = () => {
      if (!clima) return hora;
      return hora === horaAhora ? horaActualFrac(clima) : hora;
    };
  }, [clima, hora, horaAhora]);

  const centroides = useMemo(() => {
    const m = new Map();
    for (const f of municipiosGeojson?.features || []) {
      const c = centroide(f);
      if (c) m.set(f.properties.id, { c, nombre: f.properties.nombre });
    }
    return m;
  }, [municipiosGeojson]);

  useImperativeHandle(ref, () => ({
    capturePng() {
      const map = mapRef.current;
      if (!map) return null;
      map.redraw(); // fuerza un render sincrónico antes de leer el buffer
      const mapCanvas = map.getCanvas();
      const out = document.createElement("canvas");
      out.width = mapCanvas.width;
      out.height = mapCanvas.height;
      const ctx = out.getContext("2d");
      ctx.drawImage(mapCanvas, 0, 0);
      if (windCanvasRef.current && capas.viento) {
        ctx.drawImage(windCanvasRef.current, 0, 0, out.width, out.height);
      }
      return out.toDataURL("image/png");
    },
  }));

  const seleccionar = useCallback((id) => {
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
  }, []);

  const irANivelCalle = useCallback(
    (id) => {
      const map = mapRef.current;
      const info = centroides.get(id);
      if (!map || !info) return;
      const [lng, lat] = info.c;
      map.flyTo({
        center: [lng, lat],
        zoom: 14.5,
        pitch: 72,
        bearing: (Math.random() * 60 - 30) | 0,
        duration: 2800,
        curve: 1.6,
        essential: true,
      });
      setTimeout(() => setStreetView({ nombre: info.nombre, lngLat: [lng, lat] }), 2400);
    },
    [centroides]
  );

  const toggleCapa = useCallback((id) => {
    setCapas((c) => ({ ...c, [id]: !c[id] }));
  }, []);

  // --- Inicialización del mapa (una vez) ---
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !webglOk) return;

    const arranqueDirecto = prefiereMenosMovimiento || !interactive || !intro;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
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
      maxPitch: 85,
      dragRotate: interactive,
      touchZoomRotate: interactive,
      touchPitch: interactive,
      scrollZoom: interactive,
      dragPan: interactive,
      doubleClickZoom: false, // el doble click lo usamos para "nivel calle"
      keyboard: interactive,
      attributionControl: false,
      preserveDrawingBuffer: enableCapture,
    });

    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          "Clima: Open-Meteo · Límites: Natural Earth / Ordenamiento Territorial (Misiones)",
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

    map.on("sourcedata", () => map.triggerRepaint());
    map.on("styledata", () => map.triggerRepaint());

    // MapLibre v5 + globo + solo fuentes GeoJSON: el loop de render por rAF
    // se frena y deja el estilo "a medio cargar", el evento `load` sin
    // disparar y el flyTo congelado — peor todavía si la pestaña no está
    // visible (rAF suspendido). Forzamos renders sincrónicos desde ya,
    // mientras haya carga o movimiento pendiente.
    let ticks = 0;
    const bomba = setInterval(() => {
      if (mapRef.current !== map || ticks++ > 900) return clearInterval(bomba);
      if (ticks < 25) map.resize();
      const ocupado = map.isMoving() || !map.loaded() || !map.isStyleLoaded();
      if (ocupado) map.redraw();
      iniciar(); // no-op una vez que el estilo terminó de cargar
    }, 33);

    const irAMisiones = (animado) => {
      if (mapRef.current !== map) return;
      const destino = {
        center: CENTRO_MISIONES,
        zoom: ZOOM_INICIAL,
        pitch: PITCH_INICIAL,
        bearing: BEARING_INICIAL,
      };
      if (animado) map.flyTo({ ...destino, duration: 4200, curve: 1.42, essential: true });
      else map.jumpTo(destino);
    };

    const alEstarListo = () => {
      if (mapRef.current !== map) return;
      setMapReady(true);
      map.resize();

      if (!arranqueDirecto) {
        setTimeout(() => irAMisiones(true), 700);
        // Red de seguridad: si a los 9 s no llegó (pestaña oculta, stall),
        // saltamos directo a Misiones.
        setTimeout(() => {
          if (mapRef.current !== map) return;
          const d = Math.hypot(
            map.getCenter().lng - CENTRO_MISIONES[0],
            map.getCenter().lat - CENTRO_MISIONES[1]
          );
          if (d > 1.5) irAMisiones(false);
        }, 9000);
      }
    };
    let yaListo = false;
    function iniciar() {
      if (yaListo || mapRef.current !== map) return;
      // El estilo tiene que estar realmente cargado antes de que las capas
      // empiecen a hacer addSource (si no, "Style is not done loading").
      if (!map.isStyleLoaded()) return;
      yaListo = true;
      alEstarListo();
    }
    map.once("load", iniciar);

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
      clearInterval(bomba);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Países + rótulos (livianos, entran ya) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !mundoGeojson || map.getSource("mundo")) return;
    const FUENTE = ["Metropolis Regular"];

    map.addSource("mundo", { type: "geojson", data: mundoGeojson });
    map.addLayer({
      id: "mundo-fill",
      type: "fill",
      source: "mundo",
      paint: { "fill-color": "#31513d" },
    });
    map.addLayer({
      id: "mundo-line",
      type: "line",
      source: "mundo",
      paint: {
        "line-color": "#b7cabd",
        "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.8, 4, 1.5, 9, 2.2],
        "line-opacity": 0.9,
      },
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
    }
    ordenarCapas(map);
  }, [mapReady, mundoGeojson, paisesLabels]);

  // --- Provincias/estados + sus rótulos (más pesado: entra tras el intro) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !provincias || map.getSource("provincias")) return;

    let cancel = false;
    const agregar = () => {
      if (cancel || !mapRef.current || map.getSource("provincias")) return;
      const FUENTE = ["Metropolis Regular"];
      map.addSource("provincias", { type: "geojson", data: provincias });
      map.addLayer({
        id: "provincias-line",
        type: "line",
        source: "provincias",
        minzoom: 3.5,
        paint: {
          "line-color": "#8aa294",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 9, 1.4],
          "line-opacity": 0.65,
          "line-dasharray": [2, 1.6],
        },
      });
      if (provinciasLabels) {
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
            "text-letter-spacing": 0.05,
            "text-max-width": 8,
          },
          paint: {
            "text-color": "#d6e2da",
            "text-halo-color": "#0b1512",
            "text-halo-width": 1.6,
            "text-opacity": ["interpolate", ["linear"], ["zoom"], 3.8, 0.6, 5.5, 1],
          },
        });
      }
      ordenarCapas(map);
    };

    if (map.isMoving()) {
      map.once("moveend", () => setTimeout(agregar, 150));
      setTimeout(agregar, 7000);
    } else {
      setTimeout(agregar, 250);
    }
    return () => {
      cancel = true;
    };
  }, [mapReady, provincias, provinciasLabels]);

  // --- Municipios de Misiones ---
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
        "fill-extrusion-opacity": 0.92,
        "fill-extrusion-vertical-gradient": true,
      },
    });

    // Contorno de municipios: SIEMPRE visible.
    map.addLayer({
      id: "municipios-outline",
      type: "line",
      source: "municipios",
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "#ffffff",
          "#eef0e6",
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          3,
          1.2,
        ],
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          1,
          0.8,
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
      map.on("dblclick", "municipios-fill", (e) => {
        e.preventDefault();
        if (e.features?.[0]) irANivelCalle(e.features[0].properties.id);
      });
    }
    ordenarCapas(map);
  }, [mapReady, municipiosGeojson, interactive, seleccionar, irANivelCalle]);

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

  // --- Temperatura: capa raster estática (imagen), debajo del mapa ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !clima) return;
    const id = "capa-temp";
    if (capas.temp) {
      const img = generarCapaClima(clima, "temp", hora);
      if (map.getSource(id)) {
        map.getSource(id).updateImage(img);
      } else {
        map.addSource(id, { type: "image", ...img });
        map.addLayer({
          id,
          type: "raster",
          source: id,
          paint: {
            "raster-opacity": 0.55,
            "raster-fade-duration": 250,
            "raster-resampling": "linear",
          },
        });
        ordenarCapas(map);
      }
    } else if (map.getLayer(id)) {
      map.removeLayer(id);
      map.removeSource(id);
    }
  }, [mapReady, clima, capas.temp, hora]);

  // --- Nubosidad y lluvia: capas ANIMADAS que se desplazan con el viento
  //     (canvas source, por encima del mapa). ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !clima || prefiereMenosMovimiento) return;

    for (const capa of ["nubes", "lluvia"]) {
      const id = `capa-${capa}`;
      const activa = capas[capa];
      const inst = capasAnimRef.current[capa];

      if (activa && !inst) {
        const canvas = document.createElement("canvas");
        const cca = new CapaClimaAnimada(map, canvas, clima, capa, () =>
          horaGetterRef.current()
        );
        cca.start();
        capasAnimRef.current[capa] = cca;
        if (!map.getSource(id)) {
          map.addSource(id, {
            type: "canvas",
            canvas,
            coordinates: cca.coordinates,
            animate: true,
          });
          map.addLayer({
            id,
            type: "raster",
            source: id,
            paint: {
              "raster-opacity": capa === "nubes" ? 0.9 : 0.85,
              "raster-fade-duration": 0,
              "raster-resampling": "linear",
            },
          });
          ordenarCapas(map);
        }
      } else if (!activa && inst) {
        inst.destroy();
        delete capasAnimRef.current[capa];
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      } else if (activa && inst) {
        inst.actualizarGrilla(clima);
        if (map.getSource(id)) map.getSource(id).setCoordinates(inst.coordinates);
      }
    }
  }, [mapReady, clima, capas.nubes, capas.lluvia]);

  useEffect(
    () => () => {
      for (const k of Object.keys(capasAnimRef.current)) {
        capasAnimRef.current[k]?.destroy();
      }
      capasAnimRef.current = {};
    },
    []
  );

  // --- Partículas de viento ---
  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !mapReady ||
      !clima ||
      !windCanvasRef.current ||
      prefiereMenosMovimiento
    )
      return;

    windLayerRef.current?.destroy();
    windLayerRef.current = new WindParticleLayer(
      map,
      windCanvasRef.current,
      clima,
      () => horaRef.current
    );
    if (capas.viento) windLayerRef.current.start();

    return () => {
      windLayerRef.current?.destroy();
      windLayerRef.current = null;
    };
  }, [clima, mapReady]);

  // Encender/apagar el viento sin recrear la capa.
  useEffect(() => {
    const wl = windLayerRef.current;
    if (!wl) return;
    if (capas.viento) wl.start();
    else wl.stop();
  }, [capas.viento]);

  if (!webglOk) {
    return (
      <div className="base-map base-map--fallback">
        <div>
          <strong>Tu navegador no puede mostrar el mapa 3D.</strong>
          <p>Necesitás un navegador con WebGL activo (Chrome, Firefox o Edge).</p>
        </div>
      </div>
    );
  }

  return (
    <div className="base-map">
      <div ref={mapContainerRef} className="base-map__canvas-container" />
      <canvas
        ref={windCanvasRef}
        className="base-map__wind-canvas"
        hidden={!capas.viento}
      />

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

      {interactive && clima && (
        <LayerPanel
          capas={capas}
          onToggle={toggleCapa}
          horas={clima.horas}
          hora={hora}
          horaAhora={horaAhora}
          onHora={setHora}
        />
      )}

      <Legend startOpen={typeof window !== "undefined" && window.innerWidth > 640} />

      {activo && (
        <div
          className="info-card"
          role="dialog"
          aria-label={`Pronóstico de ${activo.nombre}`}
        >
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
                <div className="info-card__cond">{activo.pronostico.CONDICION}</div>
              </div>
            </div>
          ) : (
            <p className="info-card__ref">Sin pronóstico publicado todavía.</p>
          )}

          <button
            className="info-card__calle"
            onClick={() => irANivelCalle(selectedIdRef.current)}
          >
            Ver a nivel calle ↓
          </button>
        </div>
      )}

      {streetView && (
        <StreetViewPanel
          nombre={streetView.nombre}
          lngLat={streetView.lngLat}
          onClose={() => setStreetView(null)}
        />
      )}
    </div>
  );
});

export default BaseMap;
