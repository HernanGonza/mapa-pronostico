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
import { colorPorCondicion, fxDeCondicion } from "../lib/condiciones";
import { WindParticleLayer } from "../lib/windParticles";
import { generarCapaClima, horaActual, horaActualFrac } from "../lib/campoClima";
import { CapaClimaAnimada } from "../lib/capaClimaAnim";
import { tiempoRelativo } from "../lib/tiempoRelativo";
import WeatherIcon from "./WeatherIcon";
import Legend from "./Legend";
import LayerPanel from "./LayerPanel";
import CinematicFX from "./CinematicFX";

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

// Paletas de cielo por momento del día (hora local 0..24). Se interpola
// entre las dos más cercanas. `estrellas` marca noche/atardecer para el
// campo de estrellas.
const CIELOS = [
  { h: 0, bg: "#080d18", sky: "#0a1020", horiz: "#141d33", fog: "#0a0f1c", estrellas: 1 },
  { h: 5.5, bg: "#1a1a33", sky: "#243050", horiz: "#8a5a6e", fog: "#3a2f42", estrellas: 0.5 },
  { h: 7, bg: "#c9a27a", sky: "#7aa6d6", horiz: "#e6b98a", fog: "#d8c3ad", estrellas: 0 },
  { h: 12, bg: "#a9c4dd", sky: "#5b9bd8", horiz: "#c9dcec", fog: "#d5e2ee", estrellas: 0 },
  { h: 17.5, bg: "#b98d6a", sky: "#6f9fd0", horiz: "#e0a878", fog: "#d3bfa9", estrellas: 0 },
  { h: 19.5, bg: "#5a3a4a", sky: "#3a3f64", horiz: "#c26a52", fog: "#4a3444", estrellas: 0.4 },
  { h: 21, bg: "#12172a", sky: "#141d33", horiz: "#2a2140", fog: "#10131f", estrellas: 0.9 },
  { h: 24, bg: "#080d18", sky: "#0a1020", horiz: "#141d33", fog: "#0a0f1c", estrellas: 1 },
];

function mezclarHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round((pa >> 16) + ((pb >> 16) - (pa >> 16)) * t);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function cieloParaHora(hora) {
  const hh = ((hora % 24) + 24) % 24;
  let i = 0;
  while (i < CIELOS.length - 1 && CIELOS[i + 1].h <= hh) i++;
  const a = CIELOS[i];
  const b = CIELOS[Math.min(i + 1, CIELOS.length - 1)];
  const t = b.h === a.h ? 0 : (hh - a.h) / (b.h - a.h);
  return {
    bg: mezclarHex(a.bg, b.bg, t),
    sky: mezclarHex(a.sky, b.sky, t),
    horiz: mezclarHex(a.horiz, b.horiz, t),
    fog: mezclarHex(a.fog, b.fog, t),
    estrellas: a.estrellas + (b.estrellas - a.estrellas) * t,
  };
}

function alturaPorTemperatura(tmax) {
  const n = parseFloat(tmax);
  if (Number.isNaN(n)) return 0;
  // Relieve sutil: lo justo para leerse en 3D sin que los municipios altos
  // tapen a los de atrás en la cámara giratoria del modo águila.
  return Math.max(0, n) * 34;
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
    intro = false,
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
  // El slider de hora solo "manda" una vez que el operador lo movió; hasta
  // entonces las capas siguen la hora real (si no, arrancan renderizando
  // la hora 0 y se ve un "acomodamiento" feo al aparecer).
  const sliderTocadoRef = useRef(false);
  const selectedIdRef = useRef(null);
  const horaRef = useRef(0);
  // Getter de hora (fraccionaria) para las capas animadas: sigue el vivo
  // cuando el slider está en "ahora", o la hora elegida si se movió.
  const horaGetterRef = useRef(() => 0);
  const motivoSalidaAguilaRef = useRef(null); // "boton" | "gesto"

  // MapLibre v5 con fuentes solo-GeoJSON a veces deja un frame "colgado":
  // se agregan capas / se cambia feature-state y no se repinta. Un redraw
  // sincrónico puntual lo resuelve. Se llama en eventos discretos (capa
  // nueva, dato nuevo, cambio de hora), NO en loop.
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

  // Ejecuta `fn(map)`; si el estilo todavía no está listo, `addSource` tira
  // "Style is not done loading" — lo atrapamos y reintentamos hasta que
  // funcione. `fn` debe ser idempotente (chequear getSource/getLayer).
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
          console.warn("[BaseMap] conEstilo se rindió:", e.message);
          return;
        }
        setTimeout(intentar, 80); // reintenta hasta ~32 s
      }
    };
    intentar();
    return () => {
      cancel = true;
    };
  }, []);

  const [mapReady, setMapReady] = useState(false);
  const [baseListas, setBaseListas] = useState(false); // capas base agregadas
  const [webglOk] = useState(soportaWebGL);
  const [activo, setActivo] = useState(null);
  const [capas, setCapas] = useState(CAPAS_DEFAULT);
  const [hora, setHora] = useState(0);
  // Modo águila: null = apagado · "provincia" = sobrevuelo de toda Misiones
  // · <id de municipio> = sobrevuelo de ese municipio con su clima.
  const [aguila, setAguila] = useState(null);
  const sobrevuelo = aguila != null;
  const relativo = useMemo(() => tiempoRelativo(publicadoEn), [publicadoEn]);

  const horaAhora = useMemo(() => (clima ? horaActual(clima) : 0), [clima]);

  // Hora de reloj (0..24) del momento que se está mostrando — para pintar
  // el cielo (día / atardecer / noche estrellada).
  const horaReloj = useMemo(() => {
    // Sin slider tocado: hora real fraccionaria (transición suave del cielo).
    if (clima && !sliderTocadoRef.current) return horaActualFrac(clima) % 24;
    const iso = clima?.horas?.[hora];
    if (iso) {
      const [, t] = iso.split("T");
      const [H, M] = t.split(":").map(Number);
      return H + (M || 0) / 60;
    }
    const n = new Date();
    return n.getHours() + n.getMinutes() / 60;
  }, [clima, hora]);
  useEffect(() => {
    if (clima) {
      const h = horaActual(clima);
      setHora(h);
      horaRef.current = h;
    }
  }, [clima]);
  useEffect(() => {
    // Si el slider vuelve a "ahora", deja de mandar (sigue el vivo).
    if (hora === horaAhora) sliderTocadoRef.current = false;
    horaRef.current = sliderTocadoRef.current || !clima ? hora : horaActualFrac(clima);
  }, [hora, horaAhora, clima]);

  const onHora = useCallback((h) => {
    sliderTocadoRef.current = true;
    setHora(h);
  }, []);

  // El getter que usan las capas animadas: hasta que el operador toca el
  // slider, siguen la hora real (fraccionaria → mapa "en vivo").
  useEffect(() => {
    horaGetterRef.current = () => {
      if (!clima) return 0;
      return sliderTocadoRef.current ? hora : horaActualFrac(clima);
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

  // Centro geográfico de la provincia (bbox de todos los municipios) para
  // el "modo águila".
  const centroProvincia = useMemo(() => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const { c } of centroides.values()) {
      if (c[0] < x0) x0 = c[0];
      if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1];
      if (c[1] > y1) y1 = c[1];
    }
    return Number.isFinite(x0)
      ? [(x0 + x1) / 2, (y0 + y1) / 2]
      : CENTRO_MISIONES;
  }, [centroides]);

  // Efecto de primer plano (modo águila) del municipio que la cámara está
  // sobrevolando: se recalcula en cada frame del vuelo con el punto al que
  // mira la cámara, así la lluvia "entra" al acercarse a un municipio con
  // tormenta y se despeja sobre uno soleado.
  const fxRef = useRef({ lluvia: 0, rayos: false, sol: false });
  const fxEnPunto = useCallback((lng, lat) => {
    let mejor = null;
    let min = Infinity;
    for (const [id, info] of centroides) {
      const d = (info.c[0] - lng) ** 2 + (info.c[1] - lat) ** 2;
      if (d < min) {
        min = d;
        mejor = id;
      }
    }
    const cond = mejor
      ? datosPorId.current.get(mejor)?.pronostico?.CONDICION
      : null;
    return fxDeCondicion(cond);
  }, [centroides]);

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

  // Entra al modo águila sobre un municipio concreto (doble click o botón
  // de la tarjeta).
  const irAModoAguila = useCallback((id) => {
    if (id) setAguila(id);
  }, []);

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
          "sky-horizon-blend": 0.5,
          "horizon-color": "#24384a",
          "horizon-fog-blend": 0.5,
          "fog-color": "#0c141c",
          "fog-ground-blend": 0.2,
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

    // MapLibre v5 con fuentes solo-GeoJSON a veces deja el loop de render
    // "colgado" y el mapa no pinta hasta que el usuario arrastra. Un
    // desplazamiento imperceptible de la cámara (lo mismo que hace un
    // drag) lo destraba. Se hace un puñado de veces al arrancar — NADA de
    // loop perpetuo (eso mataba la performance).
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
    const despertar = () => {
      destrabar();
      iniciar();
    };
    // OJO: `styledata` dispara con cada addSource/addLayer del setup (~10
    // veces) y después basta. NO escuchar `sourcedata` — los sources
    // `canvas` animados lo emiten en CADA frame y nos metía en un
    // jumpTo+redraw por frame (= "super lento").
    let setupListo = false;
    const onSetup = () => {
      if (!setupListo && mapRef.current === map) despertar();
    };
    map.once("load", despertar);
    map.on("styledata", onSetup);

    const burst = [
      0, 60, 130, 220, 330, 460, 620, 820, 1050, 1350, 1750, 2300, 3000, 4000,
      5500, 8000, 12000,
    ].map((ms) => setTimeout(despertar, ms));
    // Después de 14 s el mapa ya pintó: cortamos toda la maquinaria de
    // arranque para no gastar nada en régimen.
    const finSetup = setTimeout(() => {
      setupListo = true;
      map.off("styledata", onSetup);
    }, 14000);

    // El contenedor puede tener 0px al crear el mapa (layout/fuentes aún
    // cargando); MapLibre entonces no pinta hasta un resize.
    const ro = new ResizeObserver(() => {
      try {
        map.resize();
      } catch {
        /* noop */
      }
      destrabar();
    });
    ro.observe(mapContainerRef.current);

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
      marcarSucio(animado ? 6000 : 800);
    };

    const alEstarListo = () => {
      if (mapRef.current !== map) return;
      setMapReady(true);
      map.resize();
      marcarSucio(8000);

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
      yaListo = true;
      // `conEstilo` en cada efecto ya espera a que el estilo esté cargado
      // de verdad antes de hacer addSource, así que acá no bloqueamos.
      alEstarListo();
    }
    // Red de seguridad: si `load` no dispara (stall del loop de render),
    // arrancamos igual a los 1.2 s.
    setTimeout(iniciar, 1200);

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
      burst.forEach(clearTimeout);
      clearTimeout(finSetup);
      ro.disconnect();
      map.off("styledata", onSetup);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Países + rótulos (livianos, entran ya) ---
  useEffect(() => {
    if (!mundoGeojson) return undefined;
    return conEstilo((map) => {
    if (map.getSource("mundo")) return;
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
    marcarSucio(3000);
    });
  }, [mundoGeojson, paisesLabels, conEstilo, marcarSucio]);

  // --- Provincias/estados + sus rótulos ---
  //     Difiere ~1.2 s: el geojson es grande (~1 MB) y teselarlo bloquea
  //     el hilo — que primero pinten Misiones y los países.
  useEffect(() => {
    if (!provincias) return undefined;
    let cancel;
    const t = setTimeout(() => {
      cancel = conEstilo((map) => {
      if (map.getSource("provincias")) return;
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
      marcarSucio(3000);
      });
    }, 1200);
    return () => {
      clearTimeout(t);
      cancel?.();
    };
  }, [provincias, provinciasLabels, conEstilo, marcarSucio]);

  // --- Municipios de Misiones ---
  useEffect(() => {
    if (!municipiosGeojson) return undefined;
    return conEstilo((map) => {
    if (map.getLayer("municipios-outline")) return;
    if (map.getSource("municipios")) return;

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
        if (e.features?.[0]) irAModoAguila(e.features[0].properties.id);
      });
    }
    ordenarCapas(map);
    marcarSucio(3000);
    setBaseListas(true);
    });
  }, [municipiosGeojson, interactive, seleccionar, irAModoAguila, conEstilo, marcarSucio]);

  // --- Datos por municipio (altura/color/nube) ---
  //     Se auto-reintenta hasta que la fuente `municipios` está — así el
  //     color NO depende del timing de las otras capas.
  useEffect(() => {
    if (!pronostico) return undefined;
    let cancel = false;

    const nuevo = new Map();
    for (const m of pronostico) nuevo.set(m.id, m);
    datosPorId.current = nuevo;

    const aplicar = () => {
      const map = mapRef.current;
      if (cancel || !map) return;
      if (!map.getSource("municipios") || !map.getLayer("municipios-fill")) {
        setTimeout(aplicar, 150);
        return;
      }
      for (const m of pronostico) {
        const p = m.pronostico;
        const fx = p ? fxDeCondicion(p.CONDICION) : null;
        map.setFeatureState(
          { source: "municipios", id: m.id },
          p
            ? {
                height: alturaPorTemperatura(p.TMAX),
                color: colorPorCondicion(p.CONDICION),
                nube: fx.lluvia,
                tormenta: fx.rayos ? 1 : 0,
              }
            : { height: 0, color: COLOR_SIN_DATO, nube: 0, tormenta: 0 }
        );
      }
      if (selectedIdRef.current)
        setActivo(nuevo.get(selectedIdRef.current) || null);
      marcarSucio();
    };
    aplicar();

    return () => {
      cancel = true;
    };
  }, [pronostico, marcarSucio]);

  // --- Temperatura: capa raster estática (imagen), debajo del mapa ---
  useEffect(() => {
    if (!baseListas || !clima) return undefined;
    return conEstilo((map) => {
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
    marcarSucio(1200);
    });
  }, [baseListas, clima, capas.temp, hora, conEstilo, marcarSucio]);

  // --- Nubosidad y lluvia: capas ANIMADAS que se desplazan con el viento
  //     (canvas source, por encima del mapa). ---
  useEffect(() => {
    if (!baseListas || !clima || prefiereMenosMovimiento) return undefined;
    return conEstilo((map) => {
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
    marcarSucio(1500);
    });
  }, [baseListas, clima, capas.nubes, capas.lluvia, conEstilo, marcarSucio]);

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
    if (!map || !baseListas || !clima || !windCanvasRef.current || prefiereMenosMovimiento)
      return;

    windLayerRef.current?.destroy();
    windLayerRef.current = new WindParticleLayer(
      map,
      windCanvasRef.current,
      clima,
      () => horaRef.current
    );
    if (capas.viento && !sobrevuelo) windLayerRef.current.start();

    return () => {
      windLayerRef.current?.destroy();
      windLayerRef.current = null;
    };
  }, [clima, baseListas]); // eslint-disable-line react-hooks/exhaustive-deps

  // Encender/apagar el viento sin recrear la capa. En modo águila se apaga:
  // la cámara con mucho pitch rotando hace que las partículas parezcan un
  // vórtice/tornado sobre la provincia — no tiene sentido meteorológico.
  useEffect(() => {
    const wl = windLayerRef.current;
    if (!wl) return;
    if (capas.viento && !sobrevuelo) wl.start();
    else wl.stop();
    marcarSucio(1500);
  }, [capas.viento, sobrevuelo, marcarSucio]);

  // --- Cielo según la hora: día, atardecer, noche estrellada ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !baseListas) return;
    const c = cieloParaHora(horaReloj);
    try {
      map.setSky?.({
        "sky-color": c.sky,
        "sky-horizon-blend": 0.6,
        "horizon-color": c.horiz,
        "horizon-fog-blend": 0.55,
        "fog-color": c.fog,
        "fog-ground-blend": 0.35,
      });
      if (map.getLayer("background")) {
        map.setPaintProperty("background", "background-color", c.bg);
      }
    } catch {
      /* estilo aún no listo */
    }
    marcarSucio(1500);
  }, [baseListas, horaReloj, marcarSucio]);

  // En modo águila achatamos el relieve de los municipios: con la cámara
  // rasante y girando, los altos tapan a los de atrás.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !baseListas || !map.getLayer("municipios-fill")) return;
    const alto = ["coalesce", ["feature-state", "height"], 0];
    try {
      map.setPaintProperty(
        "municipios-fill",
        "fill-extrusion-height",
        sobrevuelo ? ["*", alto, 0.18] : alto
      );
    } catch {
      /* noop */
    }
    marcarSucio(1200);
  }, [baseListas, sobrevuelo, marcarSucio]);


  // --- Modo águila: la cámara baja a ras de las nubes (pitch alto) y
  //     sobrevuela en un orbital lento — toda la provincia (`aguila ===
  //     "provincia"`) o un municipio puntual (`aguila === <id>`), mirando
  //     siempre al centro. El mapa queda abajo, el cielo/nubes arriba, y
  //     CinematicFX agrega la lluvia y los rayos del clima de abajo.
  //     Un gesto del usuario lo corta; el botón lo cierra y endereza. ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !baseListas || aguila == null) return;

    const muni = aguila !== "provincia" ? centroides.get(aguila) : null;
    const [cx, cy] = muni ? muni.c : centroProvincia;
    // Órbita chica y más cerca para un municipio; amplia para la provincia.
    const RX = muni ? 0.07 : 0.62;
    const RY = muni ? 0.055 : 0.46;
    const PERIODO = muni ? 30000 : 64000;
    const PITCH = 78;
    const ZOOM = muni ? 10.8 : 8.15;

    // FX dinámico: siempre el del municipio que está bajo la cámara (para
    // un municipio puntual, ése; en la provincia, el que se sobrevuela).
    fxRef.current = fxEnPunto(cx, cy);

    let raf = 0;
    let vivo = true;
    let t0 = 0;

    map.flyTo({
      center: [cx + RX, cy],
      zoom: ZOOM,
      pitch: PITCH,
      bearing: -90,
      duration: 3000,
      curve: 1.5,
      essential: true,
    });

    const volar = (now) => {
      if (!vivo) return;
      if (!t0) t0 = now;
      const a = ((now - t0) / PERIODO) * Math.PI * 2;
      const lng = cx + RX * Math.cos(a);
      const lat = cy + RY * Math.sin(a);
      const bearing = (Math.atan2(cx - lng, cy - lat) * 180) / Math.PI;
      map.jumpTo({ center: [lng, lat], bearing, pitch: PITCH, zoom: ZOOM });
      fxRef.current = fxEnPunto(lng, lat); // sigue al municipio bajo la cámara
      marcarSucio(300);
      raf = requestAnimationFrame(volar);
    };
    const t = setTimeout(() => {
      if (vivo) raf = requestAnimationFrame(volar);
    }, 3100);

    const salirPorGesto = () => {
      motivoSalidaAguilaRef.current = "gesto";
      setAguila(null);
    };
    map.on("dragstart", salirPorGesto);
    map.on("wheel", salirPorGesto);

    return () => {
      vivo = false;
      clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
      map.off("dragstart", salirPorGesto);
      map.off("wheel", salirPorGesto);
      map.stop();
      if (motivoSalidaAguilaRef.current !== "gesto") {
        map.flyTo({
          center: CENTRO_MISIONES,
          zoom: ZOOM_INICIAL,
          pitch: PITCH_INICIAL,
          bearing: BEARING_INICIAL,
          duration: 2400,
          curve: 1.5,
          essential: true,
        });
        marcarSucio(2800);
      }
      motivoSalidaAguilaRef.current = null;
    };
  }, [aguila, baseListas, centroides, centroProvincia, fxEnPunto, marcarSucio]);

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
        hidden={!capas.viento || sobrevuelo}
      />

      <CinematicFX active={sobrevuelo} sampler={() => fxRef.current} />

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
          onHora={onHora}
        />
      )}

      <Legend startOpen={typeof window !== "undefined" && window.innerWidth > 640} />

      {interactive && (
        <button
          className={`eagle-btn ${sobrevuelo ? "eagle-btn--on" : ""}`}
          onClick={() => setAguila((a) => (a == null ? "provincia" : null))}
          aria-pressed={sobrevuelo}
          title="Sobrevolar la provincia (doble click en un municipio para verlo de cerca)"
        >
          <span className="eagle-btn__icon" aria-hidden>
            {sobrevuelo ? "■" : "🦅"}
          </span>
          {sobrevuelo ? "Salir del modo águila" : "Modo águila"}
        </button>
      )}

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
            onClick={() => irAModoAguila(selectedIdRef.current)}
          >
            🦅 Ver en modo águila
          </button>
        </div>
      )}
    </div>
  );
});

export default BaseMap;
