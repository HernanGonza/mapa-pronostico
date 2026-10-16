import { useEffect, useMemo, useState } from "react";
import CampoFecha from "./CampoFecha";
import "../pages/ensamble.css";
import PublicarEnRedes from "./PublicarEnRedes";
import * as api from "../api";
import { exportarTablaPdf } from "../lib/exportarPdf";
import { crearPlacaPrecipitacionesPorPasos } from "../lib/asistentePlacaPrecipitaciones";
import { REDES_LARGO, SUPER, coma, ddmm, ddmmaaaa, fechasEntre, hoy, indexar, mesDe, normal, notasDeMedia, primerDia, resumenPeriodo } from "../lib/precipitacionesCalculo";

/**
 * Informe de precipitaciones armado con lo cargado en la planilla: se elige el período y las estaciones y sale la tabla del informe
 * (lo acumulado en el período, el mes hasta la fecha, la media y la anomalía), la placa para redes, el PDF y el Excel con fórmulas.
 */
const sumarDias = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const signo = (n) => (n == null ? "—" : `${n > 0 ? "+" : ""}${coma(n)}`);

export default function InformePrecipitaciones({ abierto, alCerrar }) {
  const [hasta, setHasta] = useState(() => sumarDias(hoy(), -1)), [desde, setDesde] = useState(() => sumarDias(hoy(), -1));
  const [datos, setDatos] = useState(null), [error, setError] = useState("");
  const [elegidas, setElegidas] = useState(null); // Set de ids; null = todavía no se tocó (valen las que tienen datos)
  const [q, setQ] = useState(""), [nota, setNota] = useState("");
  const [placa, setPlaca] = useState(null), [bajando, setBajando] = useState(false);

  const rango = useMemo(() => ({ desde: desde < primerDia(mesDe(hasta).anio, mesDe(hasta).mes) ? desde : primerDia(mesDe(hasta).anio, mesDe(hasta).mes), hasta }), [desde, hasta]);
  const rangoOk = desde <= hasta && fechasEntre(desde, hasta).length <= 400;
  useEffect(() => {
    if (!rangoOk || !abierto) return undefined;
    let activo = true;
    api.getPrecipitacionesBorrador(rango).then((d) => { if (activo) { setDatos(d); setError(""); } }).catch((e) => { if (activo) setError(e.message); });
    return () => { activo = false; };
  }, [rango, rangoOk, abierto]);

  const mapa = useMemo(() => indexar(datos?.diarias || []), [datos]);
  const activas = useMemo(() => (datos?.estaciones || []).filter((e) => e.activa), [datos]);
  const conDatos = useMemo(() => new Set(resumenPeriodo(activas, datos?.estaciones || [], mapa, desde, hasta).filter((r) => r.periodo != null).map((r) => r.id)), [activas, datos, mapa, desde, hasta]);
  const ids = elegidas ?? conDatos; // sin tocar nada: las que tienen datos en el período
  const seleccion = activas.filter((e) => ids.has(e.id));
  const filas = useMemo(() => (datos && rangoOk ? resumenPeriodo(seleccion, datos.estaciones, mapa, desde, hasta) : []), [datos, seleccion, mapa, desde, hasta, rangoOk]);
  const { leyendas, marcaDe } = notasDeMedia(filas);
  const sinDatos = filas.filter((f) => f.periodo == null);
  const redes = [...new Set(filas.map((f) => f.red))].sort();
  const visibles = activas.filter((e) => !q.trim() || normal(e.nombre).includes(normal(q.trim())));
  const alternar = (id) => setElegidas((prev) => { const n = new Set(prev ?? conDatos); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const periodoTexto = desde === hasta ? ddmm(desde) : `${ddmm(desde)} al ${ddmm(hasta)}`;
  const titulo = `Monitoreo de precipitaciones · ${desde === hasta ? ddmmaaaa(desde) : `${ddmmaaaa(desde)} al ${ddmmaaaa(hasta)}`}`;

  const armarPlaca = () => crearPlacaPrecipitacionesPorPasos({
    inicial: {
      desde, hasta,
      filas: filas.filter((f) => f.periodo != null).map((f) => ({ nombre: f.nombre, nota: f.red, periodo: String(f.periodo), mes: f.mes == null ? "" : String(f.mes), media: f.media == null ? "" : String(f.media), anomalia: "" })),
    },
    vistaPrevia: (v) => api.generarPlacaPrecipitaciones(v, { vistaPrevia: true }),
    guardar: async (v, token) => { const g = await api.generarPlacaPrecipitaciones(v, { confirmarToken: token }); setPlaca({ ...g, periodo: v.periodo }); return g; },
  });
  async function excel() {
    setBajando(true); setError("");
    try { await api.descargarExcelPrecipitaciones({ desde, hasta, estaciones: seleccion.map((e) => e.id), informe: true, borrador: true }); } catch (e) { setError(e.message); } finally { setBajando(false); }
  }
  const pdf = () => exportarTablaPdf({
    titulo: `${titulo} — Provincia de Misiones`, nombre: `informe-precipitaciones-${desde}-a-${hasta}`,
    columnas: ["Estación", `Período ${periodoTexto} (mm)`, "Mes (mm)", "Media (mm)", "Anomalía (mm)"],
    filas: [...filas.map((f) => [`${f.nombre}${SUPER[f.red]}${marcaDe(f)}`, coma(f.periodo), coma(f.mes), coma(f.media), signo(f.anomalia)]),
      ...[redes.map((r) => `${SUPER[r]} ${REDES_LARGO[r]}`).join("   ") + leyendas.map((l) => `   ${l.marca} se toma la media de ${l.nombre}`).join(""), nota].filter(Boolean).map((t) => [{ content: t, colSpan: 5, styles: { fontStyle: "italic", fillColor: [255, 255, 255] } }])],
  }).catch((e) => setError(`No se pudo armar el PDF: ${e.message}`));

  return <aside id="prec-cajon-informe" className={`ens-cajon prec-cajon${abierto ? " ens-cajon--abierto" : ""}`} aria-label="Informe de precipitaciones" aria-hidden={!abierto}>
    <div className="ens-cajon-cab"><div><h2>Informe de precipitaciones</h2><p>Se arma con lo cargado en la planilla: elegí el período y las estaciones.</p></div>
      <div className="ens-cajon-acciones"><button type="button" className="prec-btn" onClick={alCerrar}>Cerrar</button></div></div>
    <div className="ens-cajon-cuerpo">
      {error && <div className="risk-message risk-message--error" role="alert">{error}</div>}
      <div className="prec-informe">
        <div className="prec-informe__rango">
          <CampoFecha label="Desde" value={desde} max={hasta} onChange={(v) => v && setDesde(v)} />
          <CampoFecha label="Hasta" value={hasta} min={desde} onChange={(v) => v && setHasta(v)} />
          <button type="button" className="prec-btn" onClick={() => { const a = sumarDias(hoy(), -1); setDesde(a); setHasta(a); }}>Ayer</button>
          <button type="button" className="prec-btn" onClick={() => { setHasta(hoy()); setDesde(sumarDias(hoy(), -6)); }}>Últimos 7 días</button>
        </div>
        {!rangoOk && <p className="prec-ayuda" role="alert">Elegí un período válido (hasta 400 días).</p>}

        <h2>Estaciones ({seleccion.length} de {activas.length})</h2>
        <div className="prec-barra">
          <input type="search" className="prec-buscar" aria-label="Buscar estación" placeholder="Buscar estación…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="prec-btn" onClick={() => setElegidas(new Set(activas.map((e) => e.id)))}>Todas</button>
          <button type="button" className="prec-btn" onClick={() => setElegidas(new Set(conDatos))}>Sólo las que tienen datos</button>
          <button type="button" className="prec-btn" onClick={() => setElegidas(new Set())}>Ninguna</button>
        </div>
        <div className="prec-informe__estaciones">
          {visibles.map((e) => <label key={e.id}><input type="checkbox" checked={ids.has(e.id)} onChange={() => alternar(e.id)} /> {e.nombre}<sup>{e.red}</sup>{!conDatos.has(e.id) && <small> (sin datos)</small>}</label>)}
        </div>

        <h2>Tabla del informe</h2>
        {datos === null ? <p role="status">{error ? "" : "Cargando…"}</p> : !filas.length ? <div className="prec-vacio">Elegí al menos una estación.</div> : <>
          <div className="prec-tabla-scroll"><table>
            <thead><tr><th>Estación</th><th>Período {periodoTexto} (mm)</th><th>Mes (mm)</th><th>Media (mm)</th><th>Anomalía (mm)</th></tr></thead>
            <tbody>{filas.map((f) => <tr key={f.id}><td>{f.nombre}<sup>{f.red}</sup>{marcaDe(f)}</td>
              <td>{f.periodo == null ? <small>sin datos</small> : <strong>{coma(f.periodo)}</strong>}</td><td>{coma(f.mes)}</td><td>{coma(f.media)}</td>
              <td className={f.anomalia > 0 ? "pos" : f.anomalia < 0 ? "neg" : ""}>{signo(f.anomalia)}</td></tr>)}</tbody>
          </table></div>
          <p className="prec-ayuda">{redes.map((r) => `${SUPER[r]} ${REDES_LARGO[r]}`).join("   ")}{leyendas.map((l) => `   ${l.marca} se toma la media de ${l.nombre}`).join("")}<br />
            «Mes» es lo acumulado desde el 1.º hasta el {ddmmaaaa(hasta)}; la anomalía es esa cifra menos la media del mes (positiva = se superó la media).</p>
          {sinDatos.length > 0 && <div className="risk-message" role="status">{sinDatos.length === 1 ? "Una estación no tiene" : `${sinDatos.length} estaciones no tienen`} datos en el período ({sinDatos.map((f) => f.nombre).join(", ")}): figuran «sin datos» y no entran en la placa. Cargalos en la planilla si los tenés.</div>}
          <label className="prec-campo">Texto al pie (opcional, por ejemplo el período de medición)
            <input maxLength={160} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Período de medición: 09 hs del 13/10 a las 09 hs del 14/10" /></label>
          <div className="prec-informe__acciones">
            <button type="button" className="prec-btn prec-btn--primario" onClick={armarPlaca} disabled={!filas.some((f) => f.periodo != null)}>{placa ? "Armar otra placa" : "Armar la placa para redes"}</button>
            <button type="button" className="prec-btn" onClick={pdf}>Descargar PDF</button>
            <button type="button" className="prec-btn" onClick={excel} disabled={bajando}>{bajando ? "Armando…" : "Descargar Excel (con fórmulas)"}</button>
          </div>
        </>}

        {placa && <div className="prec-informe__placa">
          <h2>Placa</h2>
          <PublicarEnRedes unaVez className="prec-btn prec-btn--primario" feedUrl={placa.feedUrl} historiasUrl={placa.historiasUrl} epigrafe={`Monitoreo de precipitaciones · ${placa.periodo}\n\nDatos recopilados por la Dirección General de Alerta Temprana.`} />
          <div className="placa-preview-grid">{[["feed", "Feed"], ["historias", "Historias"]].map(([f, n]) => <figure key={f}>
            <a className="btn" href={`${placa[`${f}Url`]}?download=${encodeURIComponent(placa[`${f}Nombre`])}`}>Descargar {f}</a>
            <img src={placa[`${f}Url`]} alt={`Placa de precipitaciones, ${n}`} /><figcaption>{n}</figcaption></figure>)}</div>
        </div>}
      </div>
    </div>
  </aside>;
}
