import { useEffect, useMemo, useState } from "react";
import PrecipitacionesMap from "../components/PrecipitacionesMap";
import { getPrecipitaciones } from "../api";
import { REDES, coma, colorDe, ddmm, fechasEntre, hoy, redondear } from "../lib/precipitacionesCalculo";
import "./precipitaciones.css";

// Para el <iframe> del sitio del ministerio: el mapa con las estaciones de la planilla (las que tienen ubicación); al tocar una se ven sus últimos 10 días.
const DIAS = 10;
const sumarDias = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export default function EmbedPrecipitacionesMapaPage() {
  const [datos, setDatos] = useState(null), [error, setError] = useState(""), [sel, setSel] = useState(null);
  useEffect(() => {
    let activo = true;
    const cargar = () => { const h = hoy(); return getPrecipitaciones({ desde: sumarDias(h, -(DIAS - 1)), hasta: h }).then((d) => { if (activo) { setDatos(d); setError(""); } }).catch((e) => { if (activo) setError(e.message); }); };
    cargar(); const t = setInterval(cargar, 10 * 60 * 1000);
    return () => { activo = false; clearInterval(t); };
  }, []);

  // Por estación activa con ubicación: sus 10 días y el último día con dato (de ahí sale el color).
  const { estaciones, sinLugar } = useMemo(() => {
    const porEst = new Map();
    for (const [id, f, mm] of datos?.diarias || []) { if (!porEst.has(id)) porEst.set(id, new Map()); porEst.get(id).set(f, mm); }
    const todas = (datos?.estaciones || []).filter((e) => e.activa).map((e) => {
      const dias = porEst.get(e.id) || new Map(), ultima = [...dias.keys()].sort().pop();
      return { clave: String(e.id), nombre: e.nombre, red: e.red, lat: e.lat, lng: e.lng, dias, ultima, color: colorDe(ultima ? dias.get(ultima) : null) };
    });
    return { estaciones: todas.filter((e) => e.lat != null && e.lng != null), sinLugar: todas.filter((e) => e.lat == null || e.lng == null).length };
  }, [datos]);

  if (!datos) return <div className="base-map base-map--fallback cuencas-claro"><div><strong>Precipitaciones en Misiones</strong><p>{error || "Cargando mapa…"}</p></div></div>;
  const elegida = estaciones.find((e) => e.clave === sel);
  const fechas = fechasEntre(sumarDias(hoy(), -(DIAS - 1)), hoy()).reverse();
  const mayor = elegida ? Math.max(1, ...[...elegida.dias.values()]) : 1;
  const total = elegida ? redondear([...elegida.dias.values()].reduce((s, v) => s + v, 0)) : 0;

  return <div className="embed-risk cuencas-claro">
    {error && <div className="embed-warning" role="status">No se pudo actualizar. Se muestran los últimos datos recibidos.</div>}
    <PrecipitacionesMap embed estaciones={estaciones} seleccionada={sel} onSeleccionar={setSel} />
    {!estaciones.length && <div className="embed-warning" role="status">Todavía no hay estaciones con ubicación cargadas.</div>}
    {elegida && <div className="arroyos-embed-tarjeta"><article className="prec-tarjeta">
      <header><div><strong>{elegida.nombre}</strong><small>{REDES[elegida.red]}</small></div><button type="button" className="prec-tarjeta__x" aria-label="Cerrar" onClick={() => setSel(null)}>✕</button></header>
      <h3>Últimos {DIAS} días</h3>
      {elegida.dias.size ? <>
        <ul className="prec-tarjeta__barras">{fechas.map((f) => { const v = elegida.dias.get(f); return <li key={f}>
          <span>{ddmm(f)}</span>
          <span className="prec-tarjeta__barra">{v != null && <i style={{ width: `${Math.max(2, (v / mayor) * 100)}%`, background: colorDe(v) }} />}</span>
          {v == null ? <b className="sin">s/d</b> : <b>{coma(v)} mm</b>}</li>; })}</ul>
        <p className="prec-tarjeta__pie">Suma de los {DIAS} días: {coma(total)} mm. «s/d» = sin dato.</p>
      </> : <p className="prec-tarjeta__pie">Sin datos cargados en los últimos {DIAS} días.</p>}
    </article></div>}
    {sinLugar > 0 && <span className="visually-hidden">{sinLugar} estaciones sin ubicación no figuran en el mapa.</span>}
  </div>;
}
