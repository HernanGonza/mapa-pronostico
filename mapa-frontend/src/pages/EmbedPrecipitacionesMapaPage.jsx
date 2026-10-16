import { useEffect, useMemo, useState } from "react";
import PrecipitacionesMap from "../components/PrecipitacionesMap";
import { getPrecipitacionesTabla } from "../api";
import { coma, colorDe, periodo } from "../lib/precipitacionesTabla";
import "./embedPrecipitaciones.css";

// Para el <iframe> del sitio del ministerio: el mapa con las estaciones de la tabla de precipitaciones; al tocar una se ven sus últimos 10 días.
const DIAS = 10;
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const restarDias = (f, n) => new Date(new Date(`${f}T12:00:00Z`).getTime() - n * 864e5).toISOString().slice(0, 10);

export default function EmbedPrecipitacionesMapaPage() {
  const [registros, setRegistros] = useState(null), [error, setError] = useState(""), [sel, setSel] = useState(null);
  useEffect(() => {
    let activo = true;
    const cargar = () => getPrecipitacionesTabla().then((r) => { if (activo) { setRegistros(r); setError(""); } }).catch((e) => { if (activo) setError(e.message); });
    cargar(); const t = setInterval(cargar, 10 * 60 * 1000);
    return () => { activo = false; clearInterval(t); };
  }, []);

  // Una estación por clave (el nombre y el lugar de su dato más reciente) con todos sus registros, del más nuevo al más viejo.
  const { estaciones, sinLugar } = useMemo(() => {
    const por = new Map();
    for (const r of registros || []) { const k = r.clave; if (!por.has(k)) por.set(k, []); por.get(k).push(r); }
    const todas = [...por].map(([clave, rs]) => {
      rs.sort((a, b) => b.hasta.localeCompare(a.hasta) || b.desde.localeCompare(a.desde));
      const lugar = rs.find((r) => r.lat != null && r.lng != null);
      return { clave, nombre: rs[0].estacion, red: rs[0].red, lat: lugar?.lat, lng: lugar?.lng, registros: rs, color: colorDe(rs[0].lluvia) };
    });
    return { estaciones: todas.filter((e) => e.lat != null), sinLugar: todas.filter((e) => e.lat == null).length };
  }, [registros]);

  if (!registros) return <div className="base-map base-map--fallback cuencas-claro"><div><strong>Precipitaciones en Misiones</strong><p>{error || "Cargando mapa…"}</p></div></div>;
  const elegida = estaciones.find((e) => e.clave === sel);
  const desde = restarDias(hoy(), DIAS - 1);
  const ultimos = elegida ? elegida.registros.filter((r) => r.hasta >= desde) : [];
  const mayor = Math.max(1, ...ultimos.map((r) => r.lluvia ?? 0));
  const total = ultimos.reduce((s, r) => s + (r.lluvia ?? 0), 0);

  return <div className="embed-risk cuencas-claro">
    {error && <div className="embed-warning" role="status">No se pudo actualizar. Se muestran los últimos datos recibidos.</div>}
    <PrecipitacionesMap embed estaciones={estaciones} seleccionada={sel} onSeleccionar={setSel} />
    {!estaciones.length && <div className="embed-warning" role="status">Todavía no hay estaciones con ubicación cargadas.</div>}
    {elegida && <div className="arroyos-embed-tarjeta"><article className="prec-tarjeta">
      <header><div><strong>{elegida.nombre}</strong><small>{elegida.red}</small></div><button type="button" className="prec-tarjeta__x" aria-label="Cerrar" onClick={() => setSel(null)}>✕</button></header>
      <h3>Últimos {DIAS} días</h3>
      {ultimos.length ? <>
        <ul className="prec-tarjeta__barras">{ultimos.map((r) => <li key={r.id}>
          <span className="prec-tarjeta__dia">{periodo(r)}</span>
          <span className="prec-tarjeta__barra"><i style={{ width: `${Math.max(2, ((r.lluvia ?? 0) / mayor) * 100)}%`, background: colorDe(r.lluvia) }} /></span>
          <b>{coma(r.lluvia)} mm</b></li>)}</ul>
        <p className="prec-tarjeta__pie">{ultimos.length > 1 ? `Suma de los registros: ${coma(Math.round(total * 10) / 10)} mm. ` : ""}{ultimos[0].mes != null ? `Mes: ${coma(ultimos[0].mes)} mm${ultimos[0].anomalia != null ? ` (${ultimos[0].anomalia > 0 ? "+" : ""}${coma(ultimos[0].anomalia)} sobre la media)` : ""}.` : ""}</p>
      </> : <p className="prec-tarjeta__pie">Sin registros en los últimos {DIAS} días.{elegida.registros[0] && <> El último es del {periodo(elegida.registros[0])}: {coma(elegida.registros[0].lluvia)} mm.</>}</p>}
    </article></div>}
    {sinLugar > 0 && <span className="visually-hidden">{sinLugar} estaciones sin ubicación no figuran en el mapa.</span>}
  </div>;
}
