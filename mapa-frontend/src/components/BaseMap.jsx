import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import tippy from "tippy.js";
import "tippy.js/dist/tippy.css";
import "tippy.js/animations/scale-extreme.css";
import { API_URL } from "../config";
import { colorPorCondicion } from "../lib/condiciones";
import { tiempoRelativo } from "../lib/tiempoRelativo";
import { soportaWebGL } from "../lib/soportaWebGL";
import MunicipioInfo from "./MunicipioInfo";

const CENTRO_MISIONES = [-54.8, -27.0];
const ZOOM_INICIAL = 7.4;

const COLOR_SIN_DATO = "#c9d3a3";

// Orden canónico de capas (de abajo hacia arriba). Se reaplica cada vez
// que se agrega una capa, así el z-order siempre queda bien.
const ORDEN_CAPAS = [
  "background",
  "mundo-fill",
  "mundo-line",
  "provincias-line",
  "municipios-fill",
  // El contorno y el nombre de los municipios quedan SIEMPRE arriba.
  "municipios-outline",
  "municipios-label",
  "paises-labels",
  "provincias-labels",
];

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
    titulo,
    publicadoEn,
    interactive = true,
    enableCapture = false,
  },
  ref
) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const datosPorId = useRef(new Map());
  const selectedIdRef = useRef(null);
  const tippyRef = useRef(null);
  const tippyRootRef = useRef(null);
  const puntoLngLatRef = useRef(null);

  // MapLibre v5 con fuentes solo-GeoJSON a veces deja un frame "colgado":
  // se agregan capas / se cambia feature-state y no se repinta. Un redraw
  // sincrónico puntual lo resuelve. Se llama en eventos discretos (capa
  // nueva, dato nuevo), NO en loop.
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

  const [webglOk] = useState(soportaWebGL);
  const [activo, setActivo] = useState(null);
  const relativo = useMemo(() => tiempoRelativo(publicadoEn), [publicadoEn]);

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
      setActivo(datosPorId.current.get(String(id)) || null);
    } else {
      setActivo(null);
    }
  }, []);

  // --- Inicialización del mapa (una vez) ---
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !webglOk) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        glyphs: `${API_URL}/glyphs/{fontstack}/{range}.pbf`,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#0e2233" },
          },
        ],
      },
      center: CENTRO_MISIONES,
      zoom: ZOOM_INICIAL,
      pitch: 0,
      bearing: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      touchZoomRotate: interactive,
      scrollZoom: interactive,
      dragPan: interactive,
      keyboard: interactive,
      attributionControl: false,
      preserveDrawingBuffer: enableCapture,
    });
    map.touchZoomRotate?.disableRotation();

    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          "Datos: Dirección General de Alerta Temprana (Ministerio de Ecología y RNR, Misiones) · Límites: Natural Earth / Ordenamiento Territorial (Misiones)",
      }),
      "bottom-right"
    );
    if (interactive) {
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right"
      );
    }

    map.on("error", (e) => {
      const msg = e?.error?.message || "";
      if (!/40\d|Failed to fetch|AbortError/.test(msg)) {
        console.warn("[BaseMap] error de MapLibre:", msg);
      }
    });

    // Popover del municipio seleccionado: un solo tippy con posición
    // "virtual" (sin DOM real de referencia) que vamos reubicando a mano
    // sobre las coordenadas del municipio tocado — así no choca más con
    // los controles de zoom (antes era un <div> con position:absolute
    // fijo arriba a la derecha, pisando el NavigationControl).
    const contenidoEl = document.createElement("div");
    const root = createRoot(contenidoEl);
    tippyRootRef.current = root;
    const tip = tippy(mapContainerRef.current, {
      trigger: "manual", // el show/hide lo maneja seleccionar(), no clicks genéricos sobre el mapa
      interactive: true,
      appendTo: document.body,
      theme: "municipio",
      arrow: true,
      animation: "scale-extreme",
      duration: [180, 150],
      placement: "right",
      offset: [0, 14],
      maxWidth: 300,
      content: contenidoEl,
      getReferenceClientRect: () => new DOMRect(0, 0, 0, 0),
      onHidden: () => seleccionar(null),
    });
    tippyRef.current = tip;

    const reposicionarPopover = () => {
      const lngLat = puntoLngLatRef.current;
      if (!lngLat || !tippyRef.current) return;
      const p = map.project(lngLat);
      const rect = mapContainerRef.current.getBoundingClientRect();
      const x = rect.left + p.x;
      const y = rect.top + p.y;
      tippyRef.current.setProps({
        getReferenceClientRect: () => new DOMRect(x, y, 0, 0),
      });
    };
    map.on("move", reposicionarPopover);

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
    // OJO: `styledata` dispara con cada addSource/addLayer del setup (~10
    // veces) y después basta.
    let setupListo = false;
    const onSetup = () => {
      if (!setupListo && mapRef.current === map) destrabar();
    };
    map.once("load", destrabar);
    map.on("styledata", onSetup);

    const burst = [
      0, 60, 130, 220, 330, 460, 620, 820, 1050, 1350, 1750, 2300, 3000, 4000,
      5500, 8000, 12000,
    ].map((ms) => setTimeout(destrabar, ms));
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

    mapRef.current = map;
    if (import.meta.env?.DEV) window.__map = map;
    return () => {
      burst.forEach(clearTimeout);
      clearTimeout(finSetup);
      ro.disconnect();
      map.off("styledata", onSetup);
      map.off("move", reposicionarPopover);
      tip.destroy();
      root.unmount();
      tippyRef.current = null;
      tippyRootRef.current = null;
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
    marcarSucio();
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
      marcarSucio();
      });
    }, 1200);
    return () => {
      clearTimeout(t);
      cancel?.();
    };
  }, [provincias, provinciasLabels, conEstilo, marcarSucio]);

  // --- Municipios de Misiones (plano: relleno por condición + contorno +
  //     nombre) ---
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
      type: "fill",
      source: "municipios",
      paint: {
        "fill-color": ["coalesce", ["feature-state", "color"], COLOR_SIN_DATO],
        "fill-opacity": 0.82,
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

    // Nombre del municipio, siempre legible sobre el relleno.
    map.addLayer({
      id: "municipios-label",
      type: "symbol",
      source: "municipios",
      minzoom: 6.6,
      layout: {
        "text-field": ["get", "nombre"],
        "text-font": ["Metropolis Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 6.6, 9, 11, 14],
        "text-max-width": 7,
      },
      paint: {
        "text-color": "#12241c",
        "text-halo-color": "rgba(255,255,255,0.82)",
        "text-halo-width": 1.2,
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
        if (hit.length) {
          puntoLngLatRef.current = e.lngLat;
          seleccionar(hit[0].properties.id);
        } else {
          seleccionar(null);
        }
      });
    }
    ordenarCapas(map);
    marcarSucio();
    });
  }, [municipiosGeojson, interactive, seleccionar, conEstilo, marcarSucio]);

  // --- Datos por municipio (color por condición) ---
  //     Se auto-reintenta hasta que la fuente `municipios` está — así el
  //     color NO depende del timing de las otras capas.
  useEffect(() => {
    if (!pronostico) return undefined;
    let cancel = false;

    const nuevo = new Map();
    for (const m of pronostico) nuevo.set(String(m.id), m);
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
        map.setFeatureState(
          { source: "municipios", id: m.id },
          { color: p ? colorPorCondicion(p.CONDICION) : COLOR_SIN_DATO }
        );
      }
      if (selectedIdRef.current)
        setActivo(nuevo.get(String(selectedIdRef.current)) || null);
      marcarSucio();
    };
    aplicar();

    return () => {
      cancel = true;
    };
  }, [pronostico, marcarSucio]);

  // --- Mostrar/ocultar el popover del municipio seleccionado ---
  useEffect(() => {
    const tip = tippyRef.current;
    const root = tippyRootRef.current;
    const map = mapRef.current;
    if (!tip || !root) return;

    if (activo) {
      root.render(
        <MunicipioInfo municipio={activo} onCerrar={() => seleccionar(null)} />
      );
      const lngLat = puntoLngLatRef.current;
      if (lngLat && map) {
        const p = map.project(lngLat);
        const rect = mapContainerRef.current.getBoundingClientRect();
        tip.setProps({
          getReferenceClientRect: () =>
            new DOMRect(rect.left + p.x, rect.top + p.y, 0, 0),
        });
      }
      tip.show();
    } else {
      tip.hide();
    }
  }, [activo, seleccionar]);

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
            {relativo && (
              <span className="map-title__meta">actualizado {relativo}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default BaseMap;
