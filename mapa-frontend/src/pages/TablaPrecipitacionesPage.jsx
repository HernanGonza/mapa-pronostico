import { useEffect, useMemo, useState } from "react";
import BrandHeader from "../components/BrandHeader";
import VolverConfiguracion from "../components/VolverConfiguracion";
import EmbedShare from "../components/EmbedShare";
import * as api from "../api";
import { notificar } from "../lib/ui";
import { COLUMNAS, bajarCsv, coma, filtrarYOrdenar, ordenarPor } from "../lib/precipitacionesTabla";
import "./embedPrecipitaciones.css";

/**
 * Tabla de precipitaciones (módulo «Tabla de precipitaciones»): todo lo que se cargó desde el informe, con su histórico.
 * Se busca, filtra y ordena como en la tabla pública, y acá además se corrige una fila, se agrega a mano, se quita y se exporta (CSV y Excel).
 */
const REDES = ["INTA", "SiNaRaMe", "RMET", "RHN", "SMN", "Manual"];
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const vacia = () => ({ estacion: "", red: "Manual", desde: hoy(), hasta: hoy(), lluvia: "", max: "", maxMinutos: 30, mes: "", media: "", anomalia: "", lat: "", lng: "" });
const aTexto = (v) => (v == null ? "" : String(v));
const aNum = (v) => { const t = String(v ?? "").trim().replace(",", "."); return t === "" ? null : Number(t); };
const NUMS = ["lluvia", "max", "mes", "media", "anomalia", "lat", "lng"];
/** Lo que se manda al servidor: números reales, y la anomalía (mes − media) se calcula si se dejó vacía. */
function paraEnviar(f) {
  const o = { estacion: f.estacion.trim(), red: f.red, desde: f.desde, hasta: f.hasta, maxMinutos: Number(f.maxMinutos) === 60 ? 60 : 30 };
  for (const k of NUMS) o[k] = aNum(f[k]);
  if (o.anomalia == null && o.mes != null && o.media != null) o.anomalia = Math.round((o.mes - o.media) * 10) / 10;
  return o;
}
const errorDe = (f) => {
  if (!f.estacion.trim()) return "Escribí la estación.";
  if (!f.desde || !f.hasta) return "Elegí las fechas.";
  if (f.hasta < f.desde) return "«Hasta» es anterior a «desde».";
  for (const k of NUMS) { const n = aNum(f[k]); if (n != null && !Number.isFinite(n)) return `«${k}» no es un número.`; }
  if (Math.abs(aNum(f.lat) ?? 0) > 90 || Math.abs(aNum(f.lng) ?? 0) > 180) return "Revisá la latitud y la longitud (ej.: -27,36 y -55,90).";
  if ((aNum(f.lat) == null) !== (aNum(f.lng) == null)) return "Cargá la latitud y la longitud juntas, o ninguna.";
  return aNum(f.lluvia) == null ? "Falta la lluvia del período." : null;
};

function CamposFila({ f, poner, etiqueta }) {
  const num = (k, l) => <input className="prec-ed__num" inputMode="decimal" aria-label={`${etiqueta}: ${l}`} value={f[k]} onChange={(e) => poner({ [k]: e.target.value.replace(/[^0-9.,-]/g, "") })} />;
  return <>
    <td><input aria-label={`${etiqueta}: estación`} maxLength={120} value={f.estacion} onChange={(e) => poner({ estacion: e.target.value })} list="prec-estaciones" /></td>
    <td><select aria-label={`${etiqueta}: red`} value={f.red} onChange={(e) => poner({ red: e.target.value })}>{[...new Set([...REDES, f.red])].map((r) => <option key={r}>{r}</option>)}</select></td>
    <td className="prec-ed__periodo"><input type="date" aria-label={`${etiqueta}: desde`} value={f.desde} onChange={(e) => poner({ desde: e.target.value, ...(f.hasta < e.target.value ? { hasta: e.target.value } : {}) })} />
      <input type="date" aria-label={`${etiqueta}: hasta`} value={f.hasta} min={f.desde} onChange={(e) => poner({ hasta: e.target.value })} /></td>
    <td className="num">{num("lluvia", "lluvia")}</td>
    <td className="num">{num("max", "máxima")}<select aria-label={`${etiqueta}: ventana`} value={f.maxMinutos} onChange={(e) => poner({ maxMinutos: Number(e.target.value) })}><option value={30}>30 min</option><option value={60}>1 h</option></select></td>
    <td className="num">{num("mes", "mes")}</td><td className="num">{num("media", "media")}</td><td className="num">{num("anomalia", "anomalía")}</td>
    <td className="num">{num("lat", "latitud")}</td><td className="num">{num("lng", "longitud")}</td>
  </>;
}

export default function TablaPrecipitacionesPage() {
  const [datos, setDatos] = useState(null), [error, setError] = useState("");
  const [q, setQ] = useState(""), [red, setRed] = useState(""), [desde, setDesde] = useState(""), [hasta, setHasta] = useState("");
  const [orden, setOrden] = useState({ id: "hasta", dir: -1 });
  const [editando, setEditando] = useState(null); // { id, ...campos } o { id: null } para la fila nueva
  const [ocupado, setOcupado] = useState(false);

  const cargar = () => api.getPrecipitacionesTabla().then((r) => { setDatos(r); setError(""); }).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, []);

  const redes = useMemo(() => [...new Set((datos || []).map((r) => r.red))].sort(), [datos]);
  const estaciones = useMemo(() => [...new Set((datos || []).map((r) => r.estacion))].sort((a, b) => a.localeCompare(b, "es")), [datos]);
  const visibles = useMemo(() => filtrarYOrdenar(datos, { q, red, desde, hasta, orden }), [datos, q, red, desde, hasta, orden]);
  const hayFiltros = q || red || desde || hasta;
  const filtros = { q: q.trim(), red, desde, hasta };

  const empezar = (r) => setEditando({ id: r.id, estacion: r.estacion, red: r.red, desde: r.desde, hasta: r.hasta, lluvia: aTexto(r.lluvia), max: aTexto(r.max), maxMinutos: r.maxMinutos || 30, mes: aTexto(r.mes), media: aTexto(r.media), anomalia: aTexto(r.anomalia), lat: aTexto(r.lat), lng: aTexto(r.lng) });
  const poner = (c) => setEditando((e) => ({ ...e, ...c }));
  async function guardar() {
    const e = errorDe(editando);
    if (e) { setError(e); return; }
    setOcupado(true); setError("");
    try {
      const cuerpo = paraEnviar(editando);
      if (editando.id == null) await api.agregarFilaPrecipitaciones(cuerpo); else await api.corregirFilaPrecipitaciones(editando.id, cuerpo);
      setEditando(null); await cargar(); notificar("success", editando.id == null ? "Fila agregada." : "Fila guardada.");
    } catch (err) { setError(err.message); }
    finally { setOcupado(false); }
  }
  async function quitar(r) {
    if (!window.confirm(`¿Quitar «${r.estacion}» (${r.desde === r.hasta ? r.desde : `${r.desde} al ${r.hasta}`}) de la tabla? Deja de verse en la página.`)) return;
    try { await api.quitarFilaPrecipitaciones(r.id); await cargar(); notificar("success", "Fila quitada."); } catch (err) { setError(err.message); }
  }
  const excel = () => api.descargarExcelPrecipitaciones(filtros).catch((e) => setError(e.message));

  return <div className="admin-layout admin-layout--sin-mapa prec-admin">
    <BrandHeader subtitulo="Tabla de precipitaciones"><VolverConfiguracion /></BrandHeader>
    <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading"><h1>Tabla de precipitaciones</h1>
        <p>Todo lo que se publicó desde el informe de precipitaciones, con su histórico: cada informe suma filas y, si volvés a publicar el mismo período de una estación, la fila se actualiza. Lo que corrijas o quites acá es lo que se ve en la página.</p></div>
      {error && <div className="risk-message risk-message--error" role="alert">{error}</div>}
      <div className="prec-embed prec-embed--admin">
        <div className="prec-embed__filtros">
          <label className="prec-embed__buscar"><span>Buscar estación</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: Posadas" /></label>
          <label><span>Red</span><select value={red} onChange={(e) => setRed(e.target.value)}><option value="">Todas</option>{redes.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          <label><span>Desde</span><input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} /></label>
          <label><span>Hasta</span><input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} /></label>
          {hayFiltros && <button type="button" className="prec-embed__btn" onClick={() => { setQ(""); setRed(""); setDesde(""); setHasta(""); }}>Limpiar</button>}
        </div>
        <div className="prec-embed__filtros">
          <button type="button" className="prec-embed__btn prec-embed__btn--primario" disabled={editando != null} onClick={() => setEditando({ id: null, ...vacia() })}>+ Agregar fila</button>
          <button type="button" className="prec-embed__btn" disabled={!visibles.length} onClick={() => bajarCsv(visibles)}>Descargar CSV</button>
          <button type="button" className="prec-embed__btn" disabled={!visibles.length} onClick={excel}>Descargar Excel</button>
          <span className="prec-embed__pie">{datos ? `${visibles.length} ${visibles.length === 1 ? "fila" : "filas"}${hayFiltros ? ` de ${datos.length}` : ""} · lo exportado respeta los filtros` : ""}</span>
        </div>
        <datalist id="prec-estaciones">{estaciones.map((e) => <option key={e} value={e} />)}</datalist>
        {datos === null ? <p role="status">{error ? "" : "Cargando…"}</p> : <div className="prec-embed__tabla" role="region" aria-label="Tabla editable de precipitaciones" tabIndex={0}>
          <table>
            <thead><tr>{COLUMNAS.map((c) => <th key={c.id} className={c.texto ? "" : "num"} aria-sort={orden.id === c.id ? (orden.dir > 0 ? "ascending" : "descending") : "none"}>
              <button type="button" onClick={() => setOrden((o) => ordenarPor(o, c.id))}>{c.t}<i aria-hidden="true">{orden.id === c.id ? (orden.dir > 0 ? "▲" : "▼") : ""}</i></button></th>)}<th><span className="prec-ed__acciones-cab">Acciones</span></th></tr></thead>
            <tbody>
              {editando?.id === null && <tr className="prec-ed__editando"><CamposFila f={editando} poner={poner} etiqueta="Fila nueva" />
                <td className="prec-ed__acciones"><button type="button" className="prec-embed__btn prec-embed__btn--primario" disabled={ocupado} onClick={guardar}>Agregar</button><button type="button" className="prec-embed__btn" onClick={() => { setEditando(null); setError(""); }}>Cancelar</button></td></tr>}
              {visibles.map((r) => editando?.id === r.id
                ? <tr key={r.id} className="prec-ed__editando"><CamposFila f={editando} poner={poner} etiqueta={r.estacion} />
                  <td className="prec-ed__acciones"><button type="button" className="prec-embed__btn prec-embed__btn--primario" disabled={ocupado} onClick={guardar}>Guardar</button><button type="button" className="prec-embed__btn" onClick={() => { setEditando(null); setError(""); }}>Cancelar</button></td></tr>
                : <tr key={r.id}>{COLUMNAS.map((c) => <td key={c.id} className={`${c.texto ? "" : "num"}${c.id === "lluvia" ? " lluvia" : ""}`}>{c.f ? c.f(r) : c.texto ? c.v(r) : coma(c.v(r))}</td>)}
                  <td className="prec-ed__acciones"><button type="button" className="prec-embed__btn" onClick={() => empezar(r)} disabled={editando != null}>Editar</button><button type="button" className="prec-embed__btn" onClick={() => quitar(r)} disabled={editando != null}>Quitar</button></td></tr>)}
              {!visibles.length && editando?.id !== null && <tr><td colSpan={COLUMNAS.length + 1}>{datos?.length ? "Ninguna fila coincide con los filtros." : "Todavía no hay datos: se cargan con «Publicar en la tabla online» en el informe de precipitaciones, o con «+ Agregar fila»."}</td></tr>}
            </tbody>
          </table>
        </div>}
      </div>
      <details className="prec-admin__compartir"><summary>Compartir en el sitio web (enlaces e iframes)</summary>
      <EmbedShare path="/embed/precipitaciones" title="Precipitaciones · Misiones" kind="historico" height={720} heading="Tabla para el sitio web" hint="Muestra siempre los datos de arriba. Copiá el enlace o el iframe para ponerla en la página." linkLabel="Enlace a la tabla pública" openLabel="Abrir la tabla ↗" />
      <EmbedShare path="/embed/precipitaciones-mapa" title="Mapa de precipitaciones · Misiones" kind="mapa" height={640} heading="Mapa para el sitio web" hint="Las estaciones en su ubicación; al tocar una se ven sus últimos 10 días." linkLabel="Enlace al mapa" openLabel="Abrir el mapa ↗" />
      </details>
    </section>
  </div>;
}
