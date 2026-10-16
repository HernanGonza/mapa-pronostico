import { useEffect, useMemo, useState } from "react";
import PlanillaPrecipitaciones from "../components/PlanillaPrecipitaciones";
import { getPrecipitaciones, descargarExcelPrecipitaciones } from "../api";
import { MESES, REDES, coma, ddmmaaaa, fechasEntre, hoy, indexar, mesAnterior, mesDe, mesSiguiente, normal, notasDeMedia, primerDia, resumenPeriodo, ultimoDia } from "../lib/precipitacionesCalculo";
import "./precipitaciones.css";

// Para el <iframe> del sitio del ministerio: la planilla de precipitaciones (por día, de un mes) y el resumen de un período, con búsqueda y filtros.
const sumarDias = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const COLUMNAS = [
  { id: "nombre", t: "Estación", v: (r) => r.nombre, texto: true },
  { id: "red", t: "Red", v: (r) => r.red },
  { id: "periodo", t: "Período (mm)", v: (r) => r.periodo },
  { id: "mes", t: "Mes (mm)", v: (r) => r.mes },
  { id: "media", t: "Media (mm)", v: (r) => r.media },
  { id: "anomalia", t: "Anomalía (mm)", v: (r) => r.anomalia },
];

function bajarCsv(columnas, filas, nombre) {
  const esc = (s) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const texto = `﻿${[columnas, ...filas].map((f) => f.map((v) => esc(v == null ? "" : String(v))).join(";")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function EmbedPrecipitacionesPage() {
  const [vista, setVista] = useState("dia");
  const [periodo, setPeriodo] = useState(() => mesDe(hoy()));
  const [hasta, setHasta] = useState(hoy), [desde, setDesde] = useState(() => sumarDias(hoy(), -6));
  const [datos, setDatos] = useState(null), [error, setError] = useState("");
  const [q, setQ] = useState(""), [red, setRed] = useState("");
  const [orden, setOrden] = useState({ id: "nombre", dir: 1 });

  // Qué se pide: el mes elegido (por día) o desde el menor entre «desde» y el 1.º del mes de «hasta» (para el acumulado del mes).
  const rango = useMemo(() => {
    if (vista === "dia") return { desde: primerDia(periodo.anio, periodo.mes), hasta: ultimoDia(periodo.anio, periodo.mes) };
    const m = mesDe(hasta), ini = primerDia(m.anio, m.mes);
    return { desde: desde < ini ? desde : ini, hasta };
  }, [vista, periodo, desde, hasta]);
  useEffect(() => {
    let activo = true;
    const cargar = () => getPrecipitaciones(rango).then((d) => { if (activo) { setDatos(d); setError(""); } }).catch((e) => { if (activo) setError(e.message); });
    cargar(); const t = setInterval(cargar, 10 * 60 * 1000);
    return () => { activo = false; clearInterval(t); };
  }, [rango]);

  const mapa = useMemo(() => indexar(datos?.diarias || []), [datos]);
  const estaciones = useMemo(() => (datos?.estaciones || []).filter((e) => e.activa && (!red || e.red === Number(red)) && (!q.trim() || normal(e.nombre).includes(normal(q.trim())))), [datos, red, q]);
  const fechasOk = desde && hasta && desde <= hasta && fechasEntre(desde, hasta).length <= 400;

  const filas = useMemo(() => {
    if (!datos || vista !== "periodo" || !fechasOk) return [];
    const col = COLUMNAS.find((c) => c.id === orden.id);
    return resumenPeriodo(estaciones, datos.estaciones, mapa, desde, hasta).sort((a, b) => {
      const x = col.v(a), y = col.v(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return (col.texto ? String(x).localeCompare(String(y), "es") : x - y) * orden.dir;
    });
  }, [datos, vista, estaciones, mapa, desde, hasta, orden, fechasOk]);
  const { leyendas, marcaDe } = notasDeMedia(filas);
  const ordenarPor = (id) => setOrden((o) => (o.id === id ? { id, dir: -o.dir } : { id, dir: id === "nombre" || id === "red" ? 1 : -1 }));
  const hayFiltros = q || red;

  const excel = () => descargarExcelPrecipitaciones(vista === "dia" ? { ...rango, estaciones: estaciones.map((e) => e.id) } : { desde, hasta, estaciones: estaciones.map((e) => e.id), informe: true }).catch((e) => setError(e.message));
  function csv() {
    if (vista === "periodo") bajarCsv(["Estación", "Red", `Período ${desde} a ${hasta} (mm)`, "Mes (mm)", "Media (mm)", "Anomalía (mm)"], filas.map((r) => [r.nombre, REDES[r.red], r.periodo, r.mes, r.media, r.anomalia].map((v, i) => (i >= 2 && v != null ? String(v).replace(".", ",") : v))), `precipitaciones-${desde}-a-${hasta}.csv`);
    else {
      const dias = fechasEntre(rango.desde, rango.hasta);
      bajarCsv(["Día", ...estaciones.map((e) => `${e.nombre} (${REDES[e.red]})`)], dias.map((f) => [ddmmaaaa(f), ...estaciones.map((e) => { const v = mapa.get(`${e.id}|${f}`); return v == null ? "" : String(v).replace(".", ","); })]), `precipitaciones-${periodo.anio}-${String(periodo.mes).padStart(2, "0")}.csv`);
    }
  }

  return <main className="prec-embed">
    <header className="prec-embed__cab"><h1>Precipitaciones en Misiones</h1><p>Datos recopilados por la Dirección General de Alerta Temprana.</p></header>
    <div className="prec-pestanas" role="tablist" aria-label="Cómo ver los datos">
      {[["dia", "Por día"], ["periodo", "Resumen de un período"]].map(([id, t]) => <button key={id} type="button" role="tab" aria-selected={vista === id} className={vista === id ? "prec-pestana prec-pestana--on" : "prec-pestana"} onClick={() => setVista(id)}>{t}</button>)}
    </div>
    <div className="prec-embed__filtros">
      {vista === "dia" ? <div className="prec-mes" role="group" aria-label="Mes">
        <button type="button" className="prec-btn" aria-label="Mes anterior" onClick={() => setPeriodo(mesAnterior(periodo))}>‹</button>
        <strong style={{ minWidth: "9.5em", textAlign: "center" }}>{MESES[periodo.mes - 1]} {periodo.anio}</strong>
        <button type="button" className="prec-btn" aria-label="Mes siguiente" onClick={() => setPeriodo(mesSiguiente(periodo))}>›</button>
      </div> : <>
        <label><span>Desde</span><input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} /></label>
        <label><span>Hasta</span><input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} /></label>
      </>}
      <label className="prec-embed__buscar"><span>Buscar estación</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: Posadas" /></label>
      <label><span>Red</span><select value={red} onChange={(e) => setRed(e.target.value)}><option value="">Todas</option>{Object.entries(REDES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
      {hayFiltros && <button type="button" className="prec-btn" onClick={() => { setQ(""); setRed(""); }}>Limpiar</button>}
      <button type="button" className="prec-btn" disabled={!estaciones.length || (vista === "periodo" && !fechasOk)} onClick={csv}>Descargar CSV</button>
      <button type="button" className="prec-btn" disabled={!estaciones.length || (vista === "periodo" && !fechasOk)} onClick={excel}>Descargar Excel</button>
    </div>
    {error && <p className="embed-warning" role="alert">{error}</p>}
    {datos === null ? <p role="status">{error ? "" : "Cargando…"}</p>
      : !estaciones.length ? <p role="status">{datos.estaciones.length ? "Ninguna estación coincide con los filtros." : "Todavía no hay datos publicados."}</p>
      : vista === "dia" ? <PlanillaPrecipitaciones estaciones={estaciones} todas={datos.estaciones} mapa={mapa} anio={periodo.anio} mes={periodo.mes} hoy={hoy()} />
      : !fechasOk ? <p role="alert">Elegí un período válido (hasta 400 días).</p>
      : <>
        <div className="prec-embed__resumen" role="region" aria-label="Resumen del período" tabIndex={0}>
          <table>
            <thead><tr>{COLUMNAS.map((c) => <th key={c.id} className={c.texto ? "" : "num"} aria-sort={orden.id === c.id ? (orden.dir > 0 ? "ascending" : "descending") : "none"}>
              <button type="button" onClick={() => ordenarPor(c.id)}>{c.t}<i aria-hidden="true">{orden.id === c.id ? (orden.dir > 0 ? "▲" : "▼") : ""}</i></button></th>)}</tr></thead>
            <tbody>{filas.map((r) => <tr key={r.id}>
              <td data-etiqueta="Estación">{r.nombre}{marcaDe(r)}</td><td className="num" data-etiqueta="Red">{REDES[r.red]}</td>
              <td className="num lluvia" data-etiqueta="Período (mm)">{coma(r.periodo)}</td><td className="num" data-etiqueta="Mes (mm)">{coma(r.mes)}</td><td className="num" data-etiqueta="Media (mm)">{coma(r.media)}</td>
              <td className={`num ${r.anomalia > 0 ? "pos" : r.anomalia < 0 ? "neg" : ""}`} data-etiqueta="Anomalía (mm)">{r.anomalia == null ? "—" : `${r.anomalia > 0 ? "+" : ""}${coma(r.anomalia)}`}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="prec-embed__pie">Período: {ddmmaaaa(desde)}{desde !== hasta && ` al ${ddmmaaaa(hasta)}`}. «Mes» es lo acumulado desde el 1.º hasta el {ddmmaaaa(hasta)}; la anomalía es esa diferencia con la media del mes. {leyendas.map((l) => `${l.marca} se toma la media de ${l.nombre}. `)}</p>
      </>}
  </main>;
}
