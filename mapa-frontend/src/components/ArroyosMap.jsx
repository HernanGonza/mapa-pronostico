import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { soportaWebGL } from "../lib/soportaWebGL";
import { BASEMAP_STYLE, prepararEstilo } from "../lib/mapStyle";
import { MAP_LOCALE_ES } from "../lib/mapLocale";
import { getCapaArroyos, getMunicipiosGeojson } from "../api";

const CENTRO = [-54.6, -27.0];
export const COLOR_ESTADO = { normal: "#237346", vigilancia: "#d99a00", alerta: "#d9622b", corte: "#b42332", sin_umbral: "#3b6ea5", sin_datos: "#8793a0", sin_sensor: "#c3cad2" };

// Capas de apoyo que se pueden prender y apagar. `ids` son las capas de MapLibre que maneja cada una.
const CAPAS = [
  { id: "municipios", titulo: "Municipios", ids: ["capa-municipios-relleno", "capa-municipios-linea", "capa-municipios-nombre"], cargar: getMunicipiosGeojson },
  { id: "rutas", titulo: "Rutas", ids: ["capa-rutas", "capa-rutas-nombre"], cargar: () => getCapaArroyos("rutas") },
  { id: "puentes", titulo: "Puentes", ids: ["capa-puentes"], cargar: () => getCapaArroyos("puentes") },
  { id: "criticos", titulo: "Puntos críticos de Vialidad", ids: ["capa-criticos"], cargar: () => getCapaArroyos("criticos") },
];
const CLAVE_CAPAS = "arroyos-capas";
const capasGuardadas = () => { try { return { municipios: false, rutas: true, puentes: true, criticos: false, ...JSON.parse(localStorage.getItem(CLAVE_CAPAS) || "{}") }; } catch { return { municipios: false, rutas: true, puentes: true, criticos: false }; } };

/**
 * Mapa de los puntos de monitoreo de arroyos (módulo Inundaciones). El color es el estado; el punto elegido
 * lleva un aro. Con `onUbicar` el clic en el mapa devuelve [lat, lng] (para cargar la ubicación de un punto)
 * y se marca la posición elegida con `ubicacion`.
 */
export default function ArroyosMap({ puntos, seleccionadoId, onSeleccionar, onUbicar, ubicacion, embed = false, selectorCapas = true }) {
  const contenedor = useRef(null);
  const mapRef = useRef(null);
  const syncRef = useRef(null);
  const fiteado = useRef(false);
  const [webglOk] = useState(soportaWebGL);
  const [capas, setCapas] = useState(capasGuardadas);
  const [abierto, setAbierto] = useState(false);
  const capasDatos = useRef({});
  const capasRef = useRef(capas); capasRef.current = capas;
  const capasFn = useRef(null);
  const datos = useRef({}); datos.current = { puntos, seleccionadoId, ubicacion };
  const acciones = useRef({}); acciones.current = { onSeleccionar, onUbicar };

  useEffect(() => {
    if (!contenedor.current || mapRef.current || !webglOk) return;
    const map = new maplibregl.Map({ container: contenedor.current, style: null, center: CENTRO, zoom: 7, dragRotate: false, pitchWithRotate: false, touchPitch: false, attributionControl: false, cooperativeGestures: embed, locale: MAP_LOCALE_ES });
    map.touchZoomRotate?.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Datos: SNIH · Red Hidrológica Nacional" }), "bottom-right");
    map.on("error", (e) => { const msg = e?.error?.message || ""; if (!/40\d|Failed to fetch|AbortError/.test(msg)) console.warn("[ArroyosMap]", msg); });
    mapRef.current = map;
    let listo = false;
    const sync = () => {
      if (!listo) return;
      const { puntos: ps, seleccionadoId: sel, ubicacion: ub } = datos.current;
      const fc = { type: "FeatureCollection", features: (ps || []).map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: { id: p.id, color: COLOR_ESTADO[p.estado.codigo] || COLOR_ESTADO.sin_datos, activo: p.activo !== false, sel: p.id === sel } })) };
      const fcUb = { type: "FeatureCollection", features: ub ? [{ type: "Feature", geometry: { type: "Point", coordinates: [ub[1], ub[0]] }, properties: {} }] : [] };
      if (map.getSource("arroyos")) { map.getSource("arroyos").setData(fc); map.getSource("ubicacion").setData(fcUb); }
      else {
        map.addSource("arroyos", { type: "geojson", data: fc });
        map.addSource("ubicacion", { type: "geojson", data: fcUb });
        map.addLayer({ id: "arroyos-aro", type: "circle", source: "arroyos", filter: ["==", ["get", "sel"], true], paint: { "circle-radius": 13, "circle-color": "#ffffff", "circle-stroke-color": "#21130d", "circle-stroke-width": 2.5 } });
        map.addLayer({ id: "arroyos-punto", type: "circle", source: "arroyos", paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 6, 11, 10],
          "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": ["case", ["get", "activo"], 0.95, 0.4] } });
        map.addLayer({ id: "arroyos-ubicacion", type: "circle", source: "ubicacion", paint: { "circle-radius": 9, "circle-color": "#ffffff", "circle-opacity": 0.2, "circle-stroke-color": "#872338", "circle-stroke-width": 3 } });
      }
      if (!fiteado.current && fc.features.length) {
        const b = new maplibregl.LngLatBounds();
        fc.features.forEach((f) => b.extend(f.geometry.coordinates));
        map.fitBounds(b, { padding: 60, duration: 0, maxZoom: 9 });
        fiteado.current = true;
      }
    };
    syncRef.current = sync;

    // Capas de apoyo: se bajan la primera vez que se prenden y se insertan debajo de los puntos de monitoreo.
    const aplicarCapas = () => {
      if (!listo) return;
      const antes = map.getLayer("arroyos-aro") ? "arroyos-aro" : undefined;
      const fuente = (id, data) => { if (!map.getSource(id)) map.addSource(id, { type: "geojson", data }); };
      const D = capasDatos.current;
      if (D.municipios && !map.getSource("capa-municipios")) {
        fuente("capa-municipios", D.municipios);
        map.addLayer({ id: "capa-municipios-relleno", type: "fill", source: "capa-municipios", paint: { "fill-color": "#237346", "fill-opacity": 0.05 } }, antes);
        map.addLayer({ id: "capa-municipios-linea", type: "line", source: "capa-municipios", paint: { "line-color": "#4a6b58", "line-width": 1, "line-dasharray": [3, 2] } }, antes);
        map.addLayer({ id: "capa-municipios-nombre", type: "symbol", source: "capa-municipios", minzoom: 8.5, layout: { "text-field": ["get", "nombre"], "text-size": 11, "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#2c4a3a", "text-halo-color": "#fff", "text-halo-width": 1.5 } }, antes);
      }
      if (D.rutas && !map.getSource("capa-rutas")) {
        fuente("capa-rutas", D.rutas);
        map.addLayer({ id: "capa-rutas", type: "line", source: "capa-rutas", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["match", ["get", "tipo"], "nacional", "#b42332", "#8a5a1c"], "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.2, 11, 3.2], "line-opacity": 0.85 } }, antes);
        map.addLayer({ id: "capa-rutas-nombre", type: "symbol", source: "capa-rutas", minzoom: 9, layout: { "symbol-placement": "line", "text-field": ["get", "nombre"], "text-size": 11, "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#5b3b0e", "text-halo-color": "#fff", "text-halo-width": 1.5 } }, antes);
      }
      if (D.puentes && !map.getSource("capa-puentes")) {
        fuente("capa-puentes", D.puentes);
        map.addLayer({ id: "capa-puentes", type: "circle", source: "capa-puentes", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 2.5, 11, 6], "circle-color": "#fff", "circle-stroke-color": "#21130d", "circle-stroke-width": 1.8 } }, antes);
      }
      if (D.criticos && !map.getSource("capa-criticos")) {
        fuente("capa-criticos", D.criticos);
        map.addLayer({ id: "capa-criticos", type: "circle", source: "capa-criticos", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3, 11, 7], "circle-color": "#7a2dbf", "circle-opacity": 0.85, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } }, antes);
      }
      for (const c of CAPAS) for (const id of c.ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", capasRef.current[c.id] ? "visible" : "none");
    };
    capasFn.current = aplicarCapas;

    // Cartel al pasar por un puente o punto crítico.
    const cartel = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "280px", offset: 10 });
    const CAPAS_CLICK = ["capa-puentes", "capa-criticos"];
    const sobreCapa = (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ["arroyos-punto", ...CAPAS_CLICK].filter((id) => map.getLayer(id)) })[0];
      if (!f || f.layer.id === "arroyos-punto") { cartel.remove(); return; }
      const p = f.properties, esc = (t) => String(t ?? "").replace(/[<>&]/g, "");
      const titulo = f.layer.id === "capa-puentes" ? `Puente${p.ruta ? ` · ${esc(p.ruta)}` : ""}` : "Punto crítico (Vialidad)";
      const detalle = f.layer.id === "capa-puentes" ? [p.largo ? `${p.largo} m de largo` : "", p.tramos ? `${p.tramos} tramos` : ""].filter(Boolean).join(" · ") : esc(p.nota);
      cartel.setLngLat(f.geometry.coordinates).setHTML(`<strong>${titulo}</strong><br>${esc(p.nombre) || "sin nombre"}${detalle ? `<br><small>${detalle}</small>` : ""}`).addTo(map);
    };
    map.on("mousemove", sobreCapa);
    map.on("mouseout", () => cartel.remove());

    map.on("style.load", () => { listo = true; sync(); aplicarCapas(); });
    map.on("mouseenter", "arroyos-punto", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "arroyos-punto", () => { map.getCanvas().style.cursor = acciones.current.onUbicar ? "crosshair" : ""; });
    map.on("click", (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ["arroyos-punto"] })[0];
      if (f) { acciones.current.onSeleccionar?.(f.properties.id); return; }
      if (!acciones.current.onUbicar) return;
      // Al ubicar un punto, un clic sobre un puente o un punto crítico lo toma con su ruta y su nombre.
      const g = map.queryRenderedFeatures(e.point, { layers: ["capa-puentes", "capa-criticos"].filter((id) => map.getLayer(id)) })[0];
      if (g) { const [lng, lat] = g.geometry.coordinates; acciones.current.onUbicar([lat, lng], { ruta: g.properties.ruta || "", nombre: g.properties.nombre || "" }); }
      else acciones.current.onUbicar([Number(e.lngLat.lat.toFixed(5)), Number(e.lngLat.lng.toFixed(5))]);
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(contenedor.current);
    map.setStyle(BASEMAP_STYLE, { transformStyle: prepararEstilo });
    return () => { ro.disconnect(); syncRef.current = null; mapRef.current = null; map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { syncRef.current?.(); }, [puntos, seleccionadoId, ubicacion]);
  useEffect(() => {
    try { localStorage.setItem(CLAVE_CAPAS, JSON.stringify(capas)); } catch { /* sin almacenamiento */ }
    let vivo = true;
    CAPAS.filter((c) => capas[c.id] && !capasDatos.current[c.id]).forEach((c) => {
      c.cargar().then((d) => { if (vivo) { capasDatos.current[c.id] = d; capasFn.current?.(); } }).catch((e) => console.warn(`[ArroyosMap] capa ${c.id}:`, e.message));
    });
    capasFn.current?.();
    return () => { vivo = false; };
  }, [capas]);
  useEffect(() => { const m = mapRef.current; if (m) m.getCanvas().style.cursor = onUbicar ? "crosshair" : ""; }, [onUbicar]);
  // Al elegir un punto en la lista, el mapa lo centra.
  useEffect(() => {
    const p = puntos?.find((x) => x.id === seleccionadoId);
    if (p && mapRef.current) mapRef.current.easeTo({ center: [p.lng, p.lat], zoom: Math.max(mapRef.current.getZoom(), 9.5), duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionadoId]);

  if (!webglOk) return <div className="base-map base-map--fallback cuencas-claro">Tu navegador necesita WebGL activo para mostrar el mapa.</div>;
  return <div className={`base-map cuencas-claro${embed ? " base-map--embed" : ""}`}>
    <div ref={contenedor} className="base-map__canvas-container" />
    {selectorCapas && <div className={`arr-capas${abierto ? " arr-capas--abierto" : ""}`}>
      <button type="button" className="arr-capas__boton" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>Capas</button>
      {abierto && <div className="arr-capas__lista">
        {CAPAS.map((c) => <label key={c.id}><input type="checkbox" checked={!!capas[c.id]} onChange={(e) => setCapas((x) => ({ ...x, [c.id]: e.target.checked }))} /> {c.titulo}</label>)}
        <small>Rutas y puentes: Dirección Provincial de Vialidad</small>
      </div>}
    </div>}
    <div className="map-title"><img src="/brand/ecologia-flor.png" alt="" width={32} height={32} /><div><strong>Arroyos de Misiones</strong></div></div>
    <div className="map-legend"><div className="risk-legend">
      <strong>Estado de cada punto</strong>
      <div className="map-key__items">
        {[["normal", "Normal"], ["vigilancia", "Vigilancia"], ["alerta", "Alerta"], ["corte", "Nivel de corte de ruta"], ["sin_umbral", "Sin umbral cargado"], ["sin_datos", "Sin datos recientes"], ["sin_sensor", "Sin sensor"]]
          .map(([c, t]) => <span key={c}><i style={{ background: COLOR_ESTADO[c], borderRadius: "50%" }} /> {t}</span>)}
      </div>
    </div></div>
    {onUbicar && <div className="map-info"><div className="municipio-popover"><p>Hacé clic en el mapa para marcar la ubicación del punto.</p></div></div>}
  </div>;
}
