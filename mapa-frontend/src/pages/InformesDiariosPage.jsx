import { useEffect, useMemo, useRef, useState } from "react";
import VolverConfiguracion from "../components/VolverConfiguracion";
import BrandHeader from "../components/BrandHeader";
import * as api from "../api";
import { notificar } from "../lib/ui";
import { exportarInformePdf } from "../lib/exportarPdf";

/**
 * Informes diarios (en desarrollo, sólo superadmin, desde Configuración): qué pasó un día en
 * Misiones según las estaciones oficiales — INTA (SIGA) y SiNaRaMe (INA), cada 10 minutos, y las
 * del SMN (datos abiertos: horarios + temperaturas extremas oficiales, sin lluvia) —, más lo que
 * emitió el SMN y lo que publicamos. Se elige el día (y la franja horaria), se juntan
 * los datos, se revisa el texto sugerido, se guarda en la base y se descarga en PDF.
 */
const AR = "America/Argentina/Buenos_Aires";
const diaDe = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(new Date(t));
const ayer = () => diaDe(Date.now() - 864e5), hoy = () => diaDe(Date.now());
const ahora = () => new Date().toLocaleTimeString("es-AR", { timeZone: AR, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const ddmm = (f) => f.split("-").reverse().slice(0, 2).join("/");
/** "sábado, 3 de octubre de 2026 · de 12:00 a 18:00 h" o "desde el 02/10 00:00 h hasta el 03/10 09:00 h". */
const rangoTexto = ({ fecha, fechaHasta = fecha, desde, hasta }) => (fechaHasta && fechaHasta !== fecha
  ? `desde el ${ddmm(fecha)} a las ${desde} h hasta el ${ddmm(fechaHasta)}/${fechaHasta.slice(0, 4)} a las ${hasta} h`
  : `${fechaLarga(fecha)}${desde !== "00:00" || hasta !== "23:59" ? ` · de ${desde} a ${hasta} h` : ""}`);
const tituloSugerido = ({ fecha, fechaHasta = fecha }) => (fechaHasta !== fecha ? `Informe · ${ddmm(fecha)} al ${ddmm(fechaHasta)}/${fechaHasta.slice(0, 4)}` : `Informe diario · ${fechaLarga(fecha)}`);
const coma = (n) => (n == null ? "—" : String(n).replace(".", ","));
const horaDe = (t) => new Date(t).toLocaleTimeString("es-AR", { timeZone: AR, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: AR, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fechaLarga = (f) => new Date(`${f}T12:00:00-03:00`).toLocaleDateString("es-AR", { timeZone: AR, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const COLORES = ["#1f6fb2", "#d4572a", "#2f8f5b", "#8b3fc4", "#c9346c", "#b8940f", "#17847f", "#5a6bd6", "#a8552f", "#3c7a2a", "#9a2f6f"];
const FUENTE = "Fuente: estaciones automáticas de la Red Agrometeorológica INTA (SIGA) y de la red SiNaRaMe (INA, vía SNIH); datos horarios y temperaturas extremas de las estaciones del SMN (datos abiertos); avisos del SMN.";
const sinCero = (n) => (n == null ? "—" : coma(n));

export default function InformesDiariosPage() {
  // Rango: día y hora de inicio → día y hora de fin (ej.: ayer 00:00 → hoy 09:00).
  const [fecha, setFecha] = useState(ayer()), [desde, setDesde] = useState("00:00");
  const [fechaHasta, setFechaHasta] = useState(ayer()), [hasta, setHasta] = useState("23:59");
  const atajo = (f0, h0, f1, h1) => { setFecha(f0); setDesde(h0); setFechaHasta(f1); setHasta(h1); };
  const [cargando, setCargando] = useState(false), [guardando, setGuardando] = useState(false), [error, setError] = useState("");
  const [informe, setInforme] = useState(null); // { id?, fecha, fechaHasta, desde, hasta, titulo, resumen, datos }
  const [guardados, setGuardados] = useState([]);
  const [geo, setGeo] = useState(null);
  const mapaRef = useRef(null), graficosRef = useRef(null);

  const cargarGuardados = () => api.getInformesDiarios().then(setGuardados).catch(() => {});
  useEffect(() => { cargarGuardados(); api.getAlertasMeteorologicasGeojson().then(setGeo).catch(() => {}); }, []);

  async function juntar() {
    setCargando(true); setError("");
    try {
      const datos = await api.recolectarInformeDiario({ fecha, fechaHasta, desde, hasta });
      setInforme({ fecha, fechaHasta, desde, hasta, titulo: tituloSugerido({ fecha, fechaHasta }), resumen: datos.resumenSugerido, datos });
    } catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }
  async function abrir(id) {
    setError("");
    try { const i = await api.getInformeDiario(id); setInforme(i); setFecha(i.fecha); setFechaHasta(i.fechaHasta || i.fecha); setDesde(i.desde); setHasta(i.hasta); }
    catch (e) { setError(e.message); }
  }
  async function guardar() {
    setGuardando(true); setError("");
    try {
      const g = await api.guardarInformeDiario({ id: informe.id ?? null, fecha: informe.fecha, fechaHasta: informe.fechaHasta || informe.fecha, desde: informe.desde, hasta: informe.hasta, titulo: informe.titulo, resumen: informe.resumen, datos: informe.datos });
      setInforme(g); await cargarGuardados(); notificar("success", "Informe guardado.");
    } catch (e) { setError(e.message); }
    finally { setGuardando(false); }
  }

  const estaciones = informe?.datos?.estaciones || [];
  const conDatos = estaciones.filter((e) => e.resumen);
  const tabla = useMemo(() => ({
    columnas: ["Estación", "Red", "Lluvia (mm)", "Máx. 30 min", "Ráfaga (km/h)", "Temp. mín / máx (°C)", "Llegada de la tormenta"],
    filas: estaciones.map((e) => {
      const r = e.resumen, ex = e.extremas;
      // El SMN da las extremas oficiales del día aunque falten los horarios (o al revés).
      const oficial = ex && (ex.tmin != null || ex.tmax != null) ? `${sinCero(ex.tmin)} / ${sinCero(ex.tmax)} (oficial SMN)` : null;
      if (!r) return [e.nombre, e.red, "Sin datos", "", "", oficial || "", ""];
      return [e.nombre, e.red, r.sinLluvia ? "no mide" : coma(r.lluviaTotal), r.sinLluvia ? "—" : r.lluvia30.mm ? `${coma(r.lluvia30.mm)} mm · ${r.lluvia30.hora}` : "—",
        r.rafaga ? `${coma(r.rafaga.kmh)} · ${r.rafaga.hora}` : r.viento ? `viento medio ${coma(r.viento.kmh)} · ${r.viento.hora}` : r.sinViento ? "sin sensor" : "—",
        oficial || (r.tMin && r.tMax ? `${coma(r.tMin.c)} / ${coma(r.tMax.c)}` : "—"),
        r.caida && r.caida.grados >= 4 ? `${r.caida.hora} (−${coma(r.caida.grados)} °C${r.caida.minutos === 60 ? " en 1 h" : ""})` : "—"];
    }),
  }), [estaciones]);
  const avisos = useMemo(() => ({
    columnas: ["Tipo", "Aviso", "Vigencia"],
    filas: (informe?.datos?.smn || []).map((a) => [a.fuente === "ACP" ? "Aviso a muy corto plazo" : `Alerta ${a.nivel || ""}`.trim(), a.titulo, `${fechaHora(a.inicio)} a ${fechaHora(a.fin)}`]),
  }), [informe]);

  const [bajandoExcel, setBajandoExcel] = useState(false);
  async function excel() {
    setBajandoExcel(true); setError("");
    try { await api.descargarExcelInformeDiario(informe.datos); }
    catch (e) { setError(`No se pudo armar el Excel: ${e.message}`); }
    finally { setBajandoExcel(false); }
  }
  async function pdf() {
    try {
      await exportarInformePdf({ titulo: informe.titulo, subtitulo: `${rangoTexto(informe)} · Dirección General de Alerta Temprana`,
        resumen: informe.resumen, mapa: mapaRef.current, graficos: graficosRef.current, tabla, avisos, fuente: FUENTE, nombre: (informe.fechaHasta || informe.fecha) !== informe.fecha ? `informe-${informe.fecha}-a-${informe.fechaHasta}` : `informe-diario-${informe.fecha}` });
    } catch (e) { setError(`No se pudo armar el PDF: ${e.message}`); }
  }

  return <div className="admin-layout informes-layout">
    <BrandHeader subtitulo="Informes diarios"><VolverConfiguracion /></BrandHeader>
    <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading"><h1>Informes diarios</h1>
        <p>Qué pasó un día en Misiones según las estaciones oficiales del INTA y de la red SiNaRaMe (cada 10 minutos) y las del SMN (cada hora, más las temperaturas extremas oficiales), con lo que emitió el SMN. Elegí desde y hasta cuándo (puede ser de un día a otro, hasta 7 días), juntá los datos, revisá el texto y guardalo o bajalo en PDF.</p></div>
      {error && <div className="risk-message risk-message--error" role="alert">{error}</div>}
      <div className="informes-form">
        <div className="informes-form__atajos">
          <button type="button" className="btn" onClick={() => atajo(ayer(), "00:00", ayer(), "23:59")}>Ayer completo</button>
          <button type="button" className="btn" onClick={() => atajo(ayer(), "00:00", hoy(), ahora())}>Desde ayer 00:00 hasta ahora</button>
          <button type="button" className="btn" onClick={() => { const t = Date.now() - 864e5; atajo(diaDe(t), ahora(), hoy(), ahora()); }}>Últimas 24 h</button>
        </div>
        <fieldset className="informes-form__horas"><legend>Desde</legend>
          <input type="date" className="paso-input" aria-label="Día de inicio" value={fecha} max={hoy()} onChange={(e) => { setFecha(e.target.value); if (e.target.value > fechaHasta) setFechaHasta(e.target.value); }} />
          <input type="time" className="paso-input" aria-label="Hora de inicio" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </fieldset>
        <fieldset className="informes-form__horas"><legend>Hasta</legend>
          <input type="date" className="paso-input" aria-label="Día de fin" value={fechaHasta} min={fecha} max={hoy()} onChange={(e) => setFechaHasta(e.target.value)} />
          <input type="time" className="paso-input" aria-label="Hora de fin" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </fieldset>
        <button type="button" className="btn btn--primary btn--block" disabled={cargando} onClick={juntar}>{cargando ? "Juntando datos de las estaciones…" : "Juntar datos"}</button>
        <p className="admin-panel__hint">El INTA publica con algunas horas de demora: para el día de hoy o de ayer puede faltar el final. El SMN sube sus datos al día siguiente (las temperaturas extremas, sólo del último año).</p>
      </div>
      {guardados.length > 0 && <div className="avisos-lista">
        <h2>Informes guardados</h2>
        <ul>{guardados.map((g) => <li key={g.id} className="alerta-tarjeta" onClick={() => abrir(g.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") abrir(g.id); }}>
          <strong>{g.titulo}</strong>
          <small>{(g.fechaHasta || g.fecha) !== g.fecha ? `${ddmm(g.fecha)} ${g.desde} → ${ddmm(g.fechaHasta)} ${g.hasta} h` : `${g.desde}–${g.hasta} h`} · guardado el {fechaHora(g.actualizadoEn || g.generadoEn)}{g.generadoPorEmail && <> · {g.generadoPorEmail}</>}</small>
        </li>)}</ul>
      </div>}
    </section>

    <div className="informes-vista">
      {!informe ? <div className="admin-map-area__vacio">Elegí un día y tocá «Juntar datos», o abrí un informe guardado.</div> : <>
        <div className="informes-acciones">
          <button type="button" className="btn btn--primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : informe.id ? "Guardar cambios" : "Guardar informe"}</button>
          <button type="button" className="btn" onClick={pdf}>Descargar PDF</button>
          <button type="button" className="btn" disabled={bajandoExcel} onClick={excel} title="Todos los registros de 10 minutos de cada estación, con todos sus campos, tal cual los mandan">{bajandoExcel ? "Armando el Excel…" : "Descargar Excel (datos crudos)"}</button>
          {informe.id && <small>Guardado · se puede seguir editando</small>}
        </div>
        <label className="paso-etiqueta">Título<input className="paso-input" maxLength={160} value={informe.titulo} onChange={(e) => setInforme({ ...informe, titulo: e.target.value })} /></label>
        <label className="paso-etiqueta">Texto del informe (sugerido a partir de los datos: revisalo y corregilo)
          <textarea className="paso-texto informes-texto" rows={12} maxLength={8000} value={informe.resumen} onChange={(e) => setInforme({ ...informe, resumen: e.target.value })} /></label>

        <h2>Mapa de estaciones</h2>
        <div ref={mapaRef} className="informes-mapa"><MapaEstaciones geo={geo} estaciones={estaciones} /></div>

        <h2>Por estación</h2>
        <div className="paso-tabla informes-tabla"><table className="paso-localidades"><thead><tr>{tabla.columnas.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{tabla.filas.map((f, i) => <tr key={i}>{f.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
        {estaciones.some((e) => e.avisoDatos) && <p className="admin-panel__hint">Faltan algunos días del rango: {estaciones.filter((e) => e.avisoDatos).map((e) => `${e.red} ${e.nombre.split(" - ")[0]} (${e.avisoDatos})`).join(" · ")}.</p>}

        <div ref={graficosRef} className="informes-graficos">
          <Grafico titulo="Lluvia acumulada (mm)" estaciones={conDatos.filter((e) => !e.resumen.sinLluvia)} valor={(serie) => { let s = 0; return serie.map((r) => ({ t: r.t, v: (s += r.lluvia) })); }} desde={informe.datos} />
          <Grafico titulo="Ráfagas (km/h)" estaciones={conDatos.filter((e) => !e.resumen.sinViento)} valor={(serie) => serie.filter((r) => r.rafaga != null).map((r) => ({ t: r.t, v: r.rafaga }))} desde={informe.datos} />
          <Grafico titulo="Viento medio horario del SMN (km/h)" estaciones={conDatos.filter((e) => e.red === "SMN")} valor={(serie) => serie.filter((r) => r.viento != null).map((r) => ({ t: r.t, v: r.viento }))} desde={informe.datos} />
          <Grafico titulo="Temperatura (°C)" estaciones={conDatos.filter((e) => !e.resumen.sinTemperatura)} valor={(serie) => serie.filter((r) => r.temperatura != null).map((r) => ({ t: r.t, v: r.temperatura }))} desde={informe.datos} />
        </div>

        <h2>Avisos y alertas del SMN ({avisos.filas.length})</h2>
        {avisos.filas.length ? <ul className="informes-avisos">{(informe.datos.smn || []).map((a, i) => <li key={i}><strong>{a.fuente === "ACP" ? "ACP" : `Alerta ${a.nivel || ""}`}</strong> · {a.titulo} <small>({fechaHora(a.inicio)} a {fechaHora(a.fin)}{a.zonas ? ` · ${a.zonas}` : ""})</small></li>)}</ul>
          : <p className="admin-panel__hint">No hay avisos del SMN guardados para ese día.</p>}
        <h2>Lo que publicamos</h2>
        <ul className="informes-avisos">
          {(informe.datos.propias?.alertas || []).map((a) => <li key={`a${a.id}`}><strong>Alerta {a.nivel.toLowerCase()}</strong> · {a.periodo} <small>(publicada {fechaHora(a.publicadoEn)})</small></li>)}
          {(informe.datos.propias?.avisos || []).map((a) => <li key={`v${a.id}`}><strong>Aviso a muy corto plazo</strong>{a.nivel && ` (${a.nivel.toLowerCase()})`} · {a.texto.split("\n")[0]} <small>(publicado {fechaHora(a.publicadoEn)})</small></li>)}
          {!(informe.datos.propias?.alertas?.length || informe.datos.propias?.avisos?.length) && <li><small>Nada publicado en esa franja.</small></li>}
        </ul>
        <p className="informes-fuente">{FUENTE} Datos consultados el {fechaHora(informe.datos.consultadoEn)}.</p>
      </>}
    </div>
  </div>;
}

/** Mapa simple (SVG, sale bien en el PDF): departamentos y cada estación con un círculo según la lluvia. */
function MapaEstaciones({ geo, estaciones }) {
  if (!geo) return <p className="admin-panel__hint">Cargando el mapa…</p>;
  const W = 640, H = 560, LON = [-56.1, -53.6], LAT = [-28.2, -25.45];
  const kx = W / (LON[1] - LON[0]), ky = H / (LAT[1] - LAT[0]), k = Math.min(kx, ky);
  const px = (lng) => (lng - LON[0]) * k + (W - (LON[1] - LON[0]) * k) / 2, py = (lat) => (LAT[1] - lat) * k;
  const camino = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((pol) => pol.map((anillo) => anillo.map(([x, y], i) => `${i ? "L" : "M"}${px(x).toFixed(1)},${py(y).toFixed(1)}`).join("") + "Z").join("")).join("");
  const maxLluvia = Math.max(1, ...estaciones.map((e) => e.resumen?.lluviaTotal || 0));
  const dentro = (e) => e.lng >= LON[0] && e.lng <= LON[1] && e.lat >= LAT[0] && e.lat <= LAT[1]; // Ituzaingó queda afuera del recorte
  const smn = estaciones.filter((e) => e.red === "SMN" && dentro(e));
  return <svg viewBox={`0 0 ${W} ${H}`} className="informes-mapa__svg" role="img" aria-label="Lluvia acumulada por estación">
    <rect width={W} height={H} fill="#ffffff" />
    {geo.features.map((f, i) => <path key={i} d={camino(f.geometry)} fill="#e7eee8" stroke="#9cb2a4" strokeWidth="1" />)}
    {smn.map((e) => {
      // El SMN no da lluvia: va un cuadrado con las temperaturas extremas oficiales (o las horarias).
      const x = px(e.lng), y = py(e.lat), ex = e.extremas, r = e.resumen;
      const temps = ex && (ex.tmin != null || ex.tmax != null) ? `${sinCero(ex.tmin)} / ${sinCero(ex.tmax)} °C` : r?.tMin && r?.tMax ? `${coma(r.tMin.c)} / ${coma(r.tMax.c)} °C` : "sin datos";
      return <g key={e.clave}>
        <rect x={x - 5} y={y - 5} width="10" height="10" fill={r || ex ? "#d4572a" : "none"} stroke="#8a3518" strokeWidth="1.5" />
        <text x={x + 9} y={y - 2} fontSize="12" fontWeight="700" fill="#16241e">SMN {e.nombre}</text>
        <text x={x + 9} y={y + 12} fontSize="11.5" fill="#3a4a42">{temps}</text>
      </g>;
    })}
    {estaciones.filter((e) => e.red !== "SMN").map((e) => {
      const r = e.resumen, x = px(e.lng), y = py(e.lat), radio = r ? 6 + 26 * Math.sqrt((r.lluviaTotal || 0) / maxLluvia) : 5;
      return <g key={e.clave}>
        <circle cx={x} cy={y} r={radio} fill={r ? (r.lluviaTotal > 0 ? "rgba(31,111,178,0.55)" : "rgba(160,170,165,0.5)") : "none"} stroke={r ? "#1f4f7a" : "#a0a8a4"} strokeWidth="1.5" strokeDasharray={r ? undefined : "3 3"} />
        <text x={x + radio + 4} y={y - 2} fontSize="12" fontWeight="700" fill="#16241e">{e.nombre.split(" - ")[0]}</text>
        <text x={x + radio + 4} y={y + 12} fontSize="11.5" fill="#3a4a42">{r ? `${coma(r.lluviaTotal)} mm${r.rafaga ? ` · ${coma(r.rafaga.kmh)} km/h` : ""}` : "sin datos"}</text>
      </g>;
    })}
    <text x="10" y={H - 12} fontSize="11" fill="#5b6a60">Círculo: lluvia acumulada (INTA y SiNaRaMe) · Cuadrado: estación del SMN, temp. mín / máx</text>
  </svg>;
}

/** Gráfico de líneas (SVG) con una línea por estación, sobre la franja del informe. */
function Grafico({ titulo, estaciones, valor, desde }) {
  const series = estaciones.map((e, i) => ({ nombre: e.nombre.split(" - ")[0], color: COLORES[i % COLORES.length], puntos: valor(e.serie || []) })).filter((s) => s.puntos.length);
  if (!series.length) return null;
  const W = 640, H = 220, ML = 40, MR = 10, MT = 26, MB = 26;
  const t0 = Date.parse(`${desde.fecha}T${desde.desde}:00-03:00`), t1 = Date.parse(`${desde.fechaHasta || desde.fecha}T${desde.hasta}:59-03:00`);
  // Marcas cada 3 h en un día; en rangos más largos, más espaciadas y con el día.
  const horas = (t1 - t0) / 3600e3, paso = horas <= 26 ? 3 : horas <= 50 ? 6 : horas <= 100 ? 12 : 24, conDia = desde.fecha !== (desde.fechaHasta || desde.fecha);
  const etiqueta = (t) => (conDia ? `${ddmm(diaDe(t))} ${horaDe(t)}` : horaDe(t));
  const vals = series.flatMap((s) => s.puntos.map((p) => p.v));
  const vmin = Math.min(0, ...vals), vmax = Math.max(1, ...vals);
  const x = (t) => ML + ((t - t0) / (t1 - t0)) * (W - ML - MR), y = (v) => MT + (1 - (v - vmin) / (vmax - vmin)) * (H - MT - MB);
  // Las marcas caen en horas redondas (múltiplos del paso, hora de Misiones).
  const marcas = []; for (let t = Math.ceil((t0 - 3 * 3600e3) / (paso * 3600e3)) * paso * 3600e3 + 3 * 3600e3; t <= t1; t += paso * 3600e3) marcas.push(t);
  return <figure className="informes-grafico">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={titulo}>
      <rect width={W} height={H} fill="#ffffff" />
      <text x={ML} y="16" fontSize="13" fontWeight="700" fill="#16241e">{titulo}</text>
      {[vmin, (vmin + vmax) / 2, vmax].map((v, i) => <g key={i}><line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="#e3e8e4" /><text x={ML - 6} y={y(v) + 4} fontSize="10" textAnchor="end" fill="#5b6a60">{Math.round(v)}</text></g>)}
      {marcas.map((t) => <text key={t} x={x(t)} y={H - 8} fontSize="10" textAnchor="middle" fill="#5b6a60">{etiqueta(t)}</text>)}
      {series.map((s) => <polyline key={s.nombre} fill="none" stroke={s.color} strokeWidth="1.8" points={s.puntos.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} />)}
    </svg>
    <figcaption>{series.map((s) => <span key={s.nombre}><i style={{ background: s.color }} />{s.nombre}</span>)}</figcaption>
  </figure>;
}
