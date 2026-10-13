import { useState } from "react";
import { anomalia, csvCrudo, estadistica, porDia, redondear, tablaCruda } from "../lib/informesManuales";

/**
 * Los datos del informe con aspecto de planilla (como el Excel de Alerta Temprana): una hoja «Resumen» con una fila por estación
 * y una hoja por estación con sus totales, el acumulado por día y todos los campos que trajo, tal cual (con descarga en CSV).
 * `clima` guarda, por estación, el acumulado del mes y la media (se escriben a mano): de ahí sale la anomalía.
 */
const MAX_FILAS_CRUDAS = 1500;
const coma = (n, d = 1) => (n == null ? "" : (Math.round(n * 10 ** d) / 10 ** d).toString().replace(".", ","));
const corto = (nombre) => nombre.split(" - ")[0];
const ddmm = (f) => f.split("-").reverse().slice(0, 2).join("/");

function Numero({ valor, alCambiar, etiqueta }) {
  return <input className="hoja-entrada" inputMode="decimal" aria-label={etiqueta} placeholder="—" value={valor ?? ""} onChange={(e) => alCambiar(e.target.value.replace(/[^0-9.,]/g, ""))} />;
}

function bajar(nombre, texto) {
  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function HojaDeDatos({ estaciones, clima, alCambiarClima }) {
  const [hoja, setHoja] = useState("resumen");
  const actual = estaciones.find((e) => e.clave === hoja);
  const seleccionada = actual ? hoja : "resumen";
  const setClima = (clave, campo, v) => alCambiarClima({ ...clima, [clave]: { ...clima[clave], [campo]: v } });
  const numero = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return v === "" || v == null || !Number.isFinite(n) ? null : n; };

  return <div className="hoja">
    <div className="hoja-cuerpo">
      {seleccionada === "resumen" ? <Resumen estaciones={estaciones} clima={clima} setClima={setClima} numero={numero} irA={setHoja} /> : <Estacion e={actual} />}
    </div>
    <div className="hoja-pestanas" role="tablist" aria-label="Hojas">
      <button type="button" role="tab" aria-selected={seleccionada === "resumen"} className={`hoja-pestana${seleccionada === "resumen" ? " hoja-pestana--on" : ""}`} onClick={() => setHoja("resumen")}>Resumen</button>
      {estaciones.map((e) => <button key={e.clave} type="button" role="tab" aria-selected={seleccionada === e.clave} className={`hoja-pestana${seleccionada === e.clave ? " hoja-pestana--on" : ""}`} onClick={() => setHoja(e.clave)} title={`${e.nombre} · ${e.red}`}>{corto(e.nombre)}</button>)}
    </div>
  </div>;
}

function Resumen({ estaciones, clima, setClima, numero, irA }) {
  const filas = estaciones.map((e) => {
    const r = e.resumen, c = clima[e.clave] || {}, mes = numero(c.mes), media = numero(c.media);
    return { e, r, lluvia: r && !r.sinLluvia ? r.lluviaTotal : null, mes, media, anom: anomalia(mes, media) };
  });
  const lluvias = estadistica(filas.map((f) => f.lluvia));
  return <div className="hoja-scroll"><table className="hoja-tabla">
    <thead><tr><th>Estación</th><th>Red</th><th className="num">Lluvia del período (mm)</th><th className="num">Máx. en 30 min / 1 h (mm)</th><th className="num">Ráfaga (km/h)</th><th className="num">Temp. mín / máx (°C)</th><th className="num hoja-edit">Acumulado del mes (mm)</th><th className="num hoja-edit">Media del mes (mm)</th><th className="num">Anomalía (mm)</th></tr></thead>
    <tbody>{filas.map(({ e, r, lluvia, mes, media, anom }) => {
      const ex = e.extremas, tmin = ex?.tmin ?? r?.tMin?.c, tmax = ex?.tmax ?? r?.tMax?.c;
      return <tr key={e.clave}>
        <th scope="row"><button type="button" className="btn-link" onClick={() => irA(e.clave)}>{corto(e.nombre)}</button></th>
        <td>{e.red}</td>
        <td className="num">{!r ? <em>sin datos</em> : r.sinLluvia ? <em>no mide</em> : <strong>{coma(lluvia)}</strong>}</td>
        <td className="num">{r?.lluvia30 ? `${coma(r.lluvia30.mm)}${r.lluvia30.hora ? ` · ${r.lluvia30.hora}` : ""}${r.lluvia30.minutos === 60 ? " (1 h)" : ""}` : ""}</td>
        <td className="num">{r?.rafaga ? `${coma(r.rafaga.kmh)}${r.rafaga.hora ? ` · ${r.rafaga.hora}` : ""}` : ""}</td>
        <td className="num">{tmin != null || tmax != null ? `${coma(tmin) || "—"} / ${coma(tmax) || "—"}` : ""}</td>
        <td className="hoja-edit"><Numero valor={clima[e.clave]?.mes} etiqueta={`Acumulado del mes de ${corto(e.nombre)}`} alCambiar={(v) => setClima(e.clave, "mes", v)} /></td>
        <td className="hoja-edit"><Numero valor={clima[e.clave]?.media} etiqueta={`Media del mes de ${corto(e.nombre)}`} alCambiar={(v) => setClima(e.clave, "media", v)} /></td>
        <td className={`num${anom != null ? (anom > 0 ? " hoja-mas" : anom < 0 ? " hoja-menos" : "") : ""}`}>{anom == null ? "" : `${anom > 0 ? "+" : ""}${coma(anom)}`}</td>
      </tr>;
    })}</tbody>
    <tfoot>
      <tr><th scope="row" colSpan={2}>Máxima del período</th><td className="num">{coma(lluvias.max)}</td><td colSpan={6} /></tr>
      <tr><th scope="row" colSpan={2}>Promedio de las estaciones</th><td className="num">{coma(lluvias.prom)}</td><td colSpan={6} /></tr>
      <tr><th scope="row" colSpan={2}>Estaciones con lluvia</th><td className="num">{filas.filter((f) => f.lluvia > 0).length} de {lluvias.n}</td><td colSpan={6} /></tr>
    </tfoot>
  </table>
  <p className="admin-panel__hint">Las dos columnas de color son para escribir (como en la planilla del mes): con el acumulado del mes y la media, la anomalía se calcula sola. Tocá el nombre de una estación para ver todos sus datos.</p></div>;
}

function Estacion({ e }) {
  const r = e.resumen;
  if (e.manual) {
    const filas = r ? [["Lluvia total (mm)", r.lluviaTotal, ""], [`Lluvia máx. en ${r.lluvia30?.minutos === 60 ? "1 h" : "30 min"} (mm)`, r.lluvia30?.mm, r.lluvia30?.hora], ["Empezó a llover", "", r.inicioLluvia],
      ["Ráfaga máx. (km/h)", r.rafaga?.kmh, r.rafaga?.hora], ["Viento medio máx. (km/h)", r.viento?.kmh, r.viento?.hora], ["Temp. máx. (°C)", r.tMax?.c, r.tMax?.hora], ["Temp. mín. (°C)", r.tMin?.c, r.tMin?.hora],
      ["Caída brusca de temp. (°C)", r.caida?.grados, r.caida?.hora]] : [];
    return <div className="hoja-scroll"><table className="hoja-tabla hoja-tabla--angosta"><thead><tr><th>Dato</th><th className="num">Valor</th><th className="num">Hora</th></tr></thead>
      <tbody>{filas.map(([d, v, h]) => <tr key={d}><th scope="row">{d}</th><td className="num">{v === "" || v == null ? "" : typeof v === "number" ? coma(v) : v}</td><td className="num">{h || ""}</td></tr>)}</tbody></table>
      <p className="admin-panel__hint">Estación cargada a mano{e.fuente ? ` (la envió: ${e.fuente})` : ""}. Se edita en «Datos manuales», debajo de los interruptores.</p></div>;
  }
  const dias = porDia(e), cruda = tablaCruda(e), total = estadistica(dias.map((d) => d.lluvia));
  return <div className="hoja-scroll">
    <div className="hoja-cab"><strong>{e.nombre}</strong><span>{e.red} · {r ? `${r.registros} registros` : "sin datos en este rango"}</span>
      {cruda.filas.length > 0 && <button type="button" className="btn" onClick={() => bajar(`${e.clave}-datos-crudos.csv`, csvCrudo(e))}>Descargar datos crudos (CSV)</button>}</div>
    {e.avisoDatos && <p className="paso-aviso" role="status">Faltan datos: {e.avisoDatos}.</p>}
    {dias.length > 0 && <table className="hoja-tabla hoja-tabla--angosta"><caption>Por día</caption>
      <thead><tr><th>Día</th><th className="num">Lluvia (mm)</th><th className="num">Temp. mín (°C)</th><th className="num">Temp. máx (°C)</th><th className="num">Ráfaga máx. (km/h)</th></tr></thead>
      <tbody>{dias.map((d) => <tr key={d.dia}><th scope="row">{ddmm(d.dia)}</th><td className="num">{e.resumen?.sinLluvia ? "" : coma(d.lluvia)}</td><td className="num">{coma(d.tMin)}</td><td className="num">{coma(d.tMax)}</td><td className="num">{coma(d.rafaga)}</td></tr>)}</tbody>
      <tfoot><tr><th scope="row">TOTAL</th><td className="num">{r?.sinLluvia ? "no mide" : coma(redondear(total.suma))}</td><td className="num">{coma(r?.tMin?.c)}</td><td className="num">{coma(r?.tMax?.c)}</td><td className="num">{coma(r?.rafaga?.kmh)}</td></tr></tfoot></table>}
    {cruda.filas.length > 0 && <>
      <table className="hoja-tabla"><caption>Todos los datos que trajo la estación ({cruda.filas.length} registros)</caption>
        <thead><tr>{cruda.columnas.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{cruda.filas.slice(0, MAX_FILAS_CRUDAS).map((f, i) => <tr key={i}>{f.map((c, j) => <td key={j} className={j ? "num" : ""}>{c}</td>)}</tr>)}</tbody></table>
      {cruda.filas.length > MAX_FILAS_CRUDAS && <p className="admin-panel__hint">Se muestran los primeros {MAX_FILAS_CRUDAS} registros; el CSV y el Excel traen todos.</p>}</>}
    {!cruda.filas.length && !dias.length && <p className="admin-panel__hint">Esta estación no trajo datos en el rango elegido.</p>}
  </div>;
}
