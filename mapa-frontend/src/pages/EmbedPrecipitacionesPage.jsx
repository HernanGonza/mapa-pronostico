import { useEffect, useMemo, useState } from "react";
import { getPrecipitacionesTabla } from "../api";
import { COLUMNAS_PUBLICAS as COLUMNAS, bajarCsv, coma, filtrarYOrdenar, ordenarPor } from "../lib/precipitacionesTabla";
import "./embedPrecipitaciones.css";

// Para el <iframe> del sitio del ministerio: la tabla de precipitaciones cargada desde el informe, con búsqueda, filtros y orden.
export default function EmbedPrecipitacionesPage() {
  const [datos, setDatos] = useState(null), [error, setError] = useState("");
  const [q, setQ] = useState(""), [red, setRed] = useState(""), [desde, setDesde] = useState(""), [hasta, setHasta] = useState("");
  const [orden, setOrden] = useState({ id: "hasta", dir: -1 });

  useEffect(() => {
    let activo = true;
    const cargar = () => getPrecipitacionesTabla().then((r) => { if (activo) { setDatos(r); setError(""); } }).catch((e) => { if (activo) setError(e.message); });
    cargar(); const t = setInterval(cargar, 10 * 60 * 1000);
    return () => { activo = false; clearInterval(t); };
  }, []);

  const redes = useMemo(() => [...new Set((datos || []).map((r) => r.red))].sort(), [datos]);
  const visibles = useMemo(() => filtrarYOrdenar(datos, { q, red, desde, hasta, orden }), [datos, q, red, desde, hasta, orden]);
  const hayFiltros = q || red || desde || hasta;

  return <main className="prec-embed">
    <header className="prec-embed__cab"><div><h1>Precipitaciones en Misiones</h1><p>Datos recopilados por la Dirección General de Alerta Temprana.</p></div></header>
    <div className="prec-embed__filtros">
      <label className="prec-embed__buscar"><span>Buscar estación</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: Posadas" /></label>
      <label><span>Red</span><select value={red} onChange={(e) => setRed(e.target.value)}><option value="">Todas</option>{redes.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
      <label><span>Desde</span><input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} /></label>
      <label><span>Hasta</span><input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} /></label>
      {hayFiltros && <button type="button" className="prec-embed__btn" onClick={() => { setQ(""); setRed(""); setDesde(""); setHasta(""); }}>Limpiar</button>}
      <button type="button" className="prec-embed__btn" disabled={!visibles.length} onClick={() => bajarCsv(visibles)}>Descargar CSV</button>
    </div>
    {error && <p className="embed-warning" role="alert">{error}</p>}
    {datos === null ? <p role="status">{error ? "" : "Cargando…"}</p> : !visibles.length ? <p role="status">{datos.length ? "Ninguna estación coincide con los filtros." : "Todavía no hay datos cargados."}</p> : <>
      <div className="prec-embed__tabla" role="region" aria-label="Tabla de precipitaciones" tabIndex={0}>
        <table>
          <thead><tr>{COLUMNAS.map((c) => <th key={c.id} className={c.texto ? "" : "num"} aria-sort={orden.id === c.id ? (orden.dir > 0 ? "ascending" : "descending") : "none"}>
            <button type="button" onClick={() => setOrden((o) => ordenarPor(o, c.id))}>{c.t}<i aria-hidden="true">{orden.id === c.id ? (orden.dir > 0 ? "▲" : "▼") : ""}</i></button></th>)}</tr></thead>
          <tbody>{visibles.map((r) => <tr key={r.id}>{COLUMNAS.map((c) => <td key={c.id} className={`${c.texto ? "" : "num"}${c.id === "lluvia" ? " lluvia" : ""}${c.id === "anomalia" && r.anomalia != null ? (r.anomalia > 0 ? " pos" : r.anomalia < 0 ? " neg" : "") : ""}`} data-etiqueta={c.t}>{c.f ? c.f(r) : c.texto ? c.v(r) : coma(c.v(r))}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <p className="prec-embed__pie">{visibles.length} {visibles.length === 1 ? "registro" : "registros"}{hayFiltros ? ` de ${datos.length}` : ""}. Anomalía: diferencia entre lo acumulado en el mes y el valor medio.</p>
    </>}
  </main>;
}
