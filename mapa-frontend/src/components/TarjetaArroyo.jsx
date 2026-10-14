import { COLOR_ESTADO } from "./ArroyosMap";

export const fmt = (n, d = 2) => (n == null ? "—" : Number(n).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

/** Altura de los últimos días; las líneas punteadas son los umbrales cargados. */
export function Sparkline({ serie, umbrales }) {
  if (!serie || serie.length < 2) return null;
  const W = 260, H = 54, t0 = Date.parse(serie[0].t), t1 = Date.parse(serie.at(-1).t);
  const marcas = [umbrales.vigilancia, umbrales.alerta, umbrales.corte].filter((u) => u != null);
  const vs = [...serie.map((s) => s.valor), ...marcas];
  const min = Math.min(...vs), max = Math.max(...vs), rango = max - min || 1;
  const x = (t) => ((Date.parse(t) - t0) / (t1 - t0 || 1)) * W, y = (v) => H - 3 - ((v - min) / rango) * (H - 6);
  return <svg className="arroyos-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Altura de los últimos 7 días" preserveAspectRatio="none">
    {[["vigilancia", COLOR_ESTADO.vigilancia], ["alerta", COLOR_ESTADO.alerta], ["corte", COLOR_ESTADO.corte]].map(([k, c]) => umbrales[k] != null && <line key={k} x1="0" x2={W} y1={y(umbrales[k])} y2={y(umbrales[k])} stroke={c} strokeWidth="1" strokeDasharray="4 3" />)}
    <polyline fill="none" stroke="currentColor" strokeWidth="1.6" points={serie.map((s) => `${x(s.t).toFixed(1)},${y(s.valor).toFixed(1)}`).join(" ")} />
  </svg>;
}

/**
 * Tarjeta de un punto de monitoreo de arroyos. Cambia de color según el estado (que sale de los umbrales cargados).
 * En el panel lleva «Editar» (`onEditar`); en el embed público (`publico`) no muestra notas internas ni avisos de carga.
 */
export default function TarjetaArroyo({ p, seleccionado = false, onElegir, onEditar, publico = false, onCerrar }) {
  const s = p.estado;
  const hayUmbrales = p.umbrales.vigilancia != null || p.umbrales.alerta != null || p.umbrales.corte != null;
  const activo = p.activo !== false;
  return <article id={`arroyo-${p.id}`} className={`cuencas-tarjeta cuencas-tarjeta--${s.codigo}${seleccionado ? " arroyos-tarjeta--sel" : ""}${activo ? "" : " arroyos-tarjeta--inactivo"}`} onClick={onElegir}>
    <div className="cuencas-tarjeta__cabecera"><h2>{p.nombre}</h2>
      <span className={`cuencas-estado cuencas-estado--${s.codigo}`}>{activo ? s.etiqueta : "Desactivado"}</span>
      {onCerrar && <button type="button" className="municipio-popover__close" onClick={onCerrar} aria-label="Cerrar">✕</button>}</div>
    <span className="cuencas-tarjeta__subtitulo">{p.arroyo}{p.ruta ? ` · ${p.ruta}` : ""}{p.municipio ? ` · ${p.municipio}` : ""}</span>
    {p.valor != null ? <>
      <span className="cuencas-tarjeta__valor">{fmt(p.valor)} <small>m</small>
        <span className={`arroyos-tendencia arroyos-tendencia--${(p.tendencia || "").split(" ")[0].toLowerCase()}`}>{p.tendencia === "Sube" ? "▲" : p.tendencia === "Baja" ? "▼" : p.tendencia === "Estable" ? "■" : ""} {p.tendencia}{p.variacion != null && p.tendencia !== "Estable" ? ` · ${p.variacion > 0 ? "+" : ""}${fmt(p.variacion * 100, 0)} cm/h` : ""}</span></span>
      <Sparkline serie={p.serie} umbrales={p.umbrales} />
      <p className="cuencas-tarjeta__fecha">Lectura: {fechaHora(p.fecha)}{!p.vigente ? " · Atrasada" : ""} · Últimas 24 h: {p.cambio24h == null ? "—" : `${p.cambio24h > 0 ? "+" : ""}${fmt(p.cambio24h)} m`} · Máx. 7 días: {fmt(p.maximo)} m</p>
    </> : <p className="cuencas-tarjeta__motivo">{s.motivo}</p>}
    {p.valor != null && activo && !(publico && s.codigo === "sin_umbral") && <p className="cuencas-tarjeta__nota">{s.motivo}</p>}
    {hayUmbrales && <p className="cuencas-tarjeta__nota">Umbrales: vigilancia {fmt(p.umbrales.vigilancia)} · alerta {fmt(p.umbrales.alerta)} · corte de ruta {fmt(p.umbrales.corte)} m</p>}
    {!publico && p.nota && <p className="cuencas-tarjeta__nota">{p.nota}</p>}
    {!publico && p.error && <p className="cuencas-tarjeta__nota">No se pudo renovar esta lectura ({p.error}).</p>}
    {onEditar && <div className="admin-actions"><button className="btn btn--ghost" type="button" onClick={(e) => { e.stopPropagation(); onEditar(); }}>Editar</button></div>}
  </article>;
}
