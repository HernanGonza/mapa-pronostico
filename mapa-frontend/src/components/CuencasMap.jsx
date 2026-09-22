import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { soportaWebGL } from "../lib/soportaWebGL";
import { BASEMAP_STYLE, prepararEstilo } from "../lib/mapStyle";

const CENTRO = [-54.3, -27.5];
const ZOOM_INICIAL = 5.6;
const COLOR_REPRESA = "#D62E42";
const COLOR_PUERTO = "#8b3fc4";

const fecha = value => value ? new Date(value.includes(" ") ? `${value.replace(" ", "T")}Z` : value).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "—";

function featureCollection(puntos, tipo) {
  return {
    type: "FeatureCollection",
    features: (puntos || []).map(p => ({
      type: "Feature",
      // API: coords en [lat, lon]; GeoJSON/MapLibre necesitan [lon, lat].
      geometry: { type: "Point", coordinates: [p.coords[1], p.coords[0]] },
      properties: { ...p, tipo },
    })),
  };
}

/**
 * Mapa de puntos del Monitor de cuencas: represas (defluente, m³/s) y
 * puertos/estaciones de altura de río — mismos datos que el mapa de
 * sig.misiones.gob.ar/mapas/monitor/, re-servidos por nuestro backend
 * (ver mapa-backend/src/lib/cuencas). No hay municipios/departamentos acá:
 * la cuenca cruza varias provincias y países.
 */
export default function CuencasMap({ represas, puertos, titulo, embed = false }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [webglOk] = useState(soportaWebGL);
  const [activo, setActivo] = useState(null);
  const datosRef = useRef({ represas, puertos });
  datosRef.current = { represas, puertos };
  const syncRef = useRef(null);
  const fiteadoRef = useRef(false);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !webglOk) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current, style: null,
      center: CENTRO, zoom: ZOOM_INICIAL,
      dragRotate: false, pitchWithRotate: false, touchPitch: false,
      attributionControl: false,
      cooperativeGestures: embed,
    });
    map.touchZoomRotate?.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true,
      customAttribution: "Datos: SIG Misiones (sig.misiones.gob.ar) · ONS Brasil",
    }), "bottom-right");
    map.on("error", e => { const msg = e?.error?.message || ""; if (!/40\d|Failed to fetch|AbortError/.test(msg)) console.warn("[CuencasMap] error:", msg); });
    mapRef.current = map;
    let estiloListo = false;
    const sync = () => {
      if (!estiloListo) return;
      const { represas: r, puertos: p } = datosRef.current;
      const fcRepresas = featureCollection(r, "represa"), fcPuertos = featureCollection(p, "puerto");
      if (map.getSource("represas")) map.getSource("represas").setData(fcRepresas);
      else {
        map.addSource("represas", { type: "geojson", data: fcRepresas });
        map.addLayer({ id: "represas-punto", type: "circle", source: "represas", paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 6, 9, 12],
          "circle-color": COLOR_REPRESA, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": 0.9,
        } });
      }
      if (map.getSource("puertos")) map.getSource("puertos").setData(fcPuertos);
      else {
        map.addSource("puertos", { type: "geojson", data: fcPuertos });
        map.addLayer({ id: "puertos-punto", type: "circle", source: "puertos", paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.5, 9, 7],
          "circle-color": COLOR_PUERTO, "circle-stroke-color": "#fff", "circle-stroke-width": 1, "circle-opacity": 0.85,
        } });
      }
      if (!fiteadoRef.current && (fcRepresas.features.length || fcPuertos.features.length)) {
        const bounds = new maplibregl.LngLatBounds();
        [...fcRepresas.features, ...fcPuertos.features].forEach(f => bounds.extend(f.geometry.coordinates));
        map.fitBounds(bounds, { padding: 40, duration: 0 });
        fiteadoRef.current = true;
      }
    };
    syncRef.current = sync;
    map.on("style.load", () => { estiloListo = true; sync(); });
    ["puertos-punto", "represas-punto"].forEach(layer => {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
      map.on("click", layer, e => setActivo(e.features?.[0]?.properties || null));
      if (embed) map.on("mouseleave", layer, () => setActivo(null));
    });
    if (embed) map.on("mouseleave", () => setActivo(null));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(mapContainerRef.current);
    map.setStyle(BASEMAP_STYLE, { transformStyle: prepararEstilo });
    return () => { ro.disconnect(); syncRef.current = null; mapRef.current = null; map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { syncRef.current?.(); }, [represas, puertos]);

  if (!webglOk) return <div className="base-map base-map--fallback">Tu navegador necesita WebGL activo para mostrar el mapa.</div>;

  return <div className="base-map">
    <div ref={mapContainerRef} className="base-map__canvas-container" />
    {titulo && <div className="map-title"><img src="/brand/ecologia-flor.png" alt="" width={32} height={32} />
      <div><strong>{titulo}</strong></div></div>}
    <div className="map-legend"><div className="risk-legend">
      <strong>Monitor de cuencas</strong>
      <div className="map-key__items">
        <span><i style={{ background: COLOR_REPRESA, borderRadius: "50%" }} /> Represas (último defluente, m³/s)</span>
        <span><i style={{ background: COLOR_PUERTO, borderRadius: "50%" }} /> Puertos (última altura registrada)</span>
      </div>
      <small>Datos re-servidos desde sig.misiones.gob.ar · seleccioná un punto para ver el detalle.</small>
    </div></div>
    {activo && <div className="map-info"><div className="municipio-popover" role="dialog" aria-label={activo.nombre}>
      <button className="municipio-popover__close" onClick={() => setActivo(null)} aria-label="Cerrar">✕</button>
      <h3>{activo.nombre}</h3>
      {activo.tipo === "represa" ? <>
        <p className="risk-category"><i style={{ background: COLOR_REPRESA }} />Represa</p>
        <p>Defluente: <strong>{Math.round(activo.valor).toLocaleString("es-AR")} m³/s</strong></p>
        <p>Dato de {fecha(activo.fecha)}</p>
      </> : <>
        <p className="risk-category"><i style={{ background: COLOR_PUERTO }} />Puerto · {activo.rio}</p>
        <p>Altura: <strong>{activo.valor} m</strong> · Tendencia: {activo.tendencia || "—"} · Estado: {activo.estado || "—"}</p>
        {activo.nivelAlerta != null && <p>Nivel de alerta: {activo.nivelAlerta} m{activo.nivelEvacuacion != null ? ` · evacuación: ${activo.nivelEvacuacion} m` : ""}</p>}
        <p>Dato de {fecha(activo.fecha)}</p>
      </>}
    </div></div>}
  </div>;
}
