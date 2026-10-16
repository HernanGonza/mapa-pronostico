import { useState } from "react";
import * as api from "../api";
import { MESES, REDES } from "../lib/precipitacionesCalculo";

/** Importar un Excel como el PRECIPITACIONES.xlsx (una hoja por mes, «10,2026»): primero muestra qué trae, después se aplica. No borra nada de lo que ya hay. */
export default function ImportarPrecipitaciones({ existentes, alImportar, alError }) {
  const [leido, setLeido] = useState(null), [ocupado, setOcupado] = useState(false), [listo, setListo] = useState(null);
  async function elegir(ev) {
    const f = ev.target.files?.[0]; ev.target.value = "";
    if (!f) return;
    setOcupado(true); setLeido(null); setListo(null); alError("");
    try { setLeido(await api.leerExcelPrecipitaciones(f)); } catch (e) { alError(e.message); } finally { setOcupado(false); }
  }
  async function aplicar() {
    setOcupado(true); alError("");
    try { setListo(await api.aplicarImportacionPrecipitaciones(leido.estaciones)); setLeido(null); await alImportar(); } catch (e) { alError(e.message); } finally { setOcupado(false); }
  }
  const ya = (e) => existentes.some((x) => x.nombre === e.nombre && x.red === e.red);
  return <div className="prec-importar">
    <p className="prec-ayuda">Subí el Excel de siempre (una hoja por mes, llamada como «10,2026», con las estaciones en columnas y los días en filas). Se crean las estaciones que falten (por nombre y red), se cargan los días y las medias, y las celdas que ya tenían un valor se actualizan. No se borra nada.</p>
    <label className="prec-btn prec-btn--primario prec-archivo">{ocupado ? "Leyendo…" : "Elegir el Excel"}<input type="file" accept=".xlsx" onChange={elegir} disabled={ocupado} /></label>
    {listo && <div className="prec-ok" role="status">Listo: {listo.estacionesNuevas} {listo.estacionesNuevas === 1 ? "estación nueva" : "estaciones nuevas"}, {listo.dias} {listo.dias === 1 ? "día cargado" : "días cargados"} y {listo.medias} {listo.medias === 1 ? "media" : "medias"}.</div>}
    {leido && <div className="prec-previa">
      <h3>Esto es lo que trae el archivo</h3>
      <ul>{leido.hojas.map((h) => <li key={h.hoja}><strong>{MESES[h.mes - 1]} {h.anio}</strong>: {h.estaciones} estaciones, {h.celdas} valores.</li>)}</ul>
      <div className="prec-tabla-scroll"><table><thead><tr><th>Estación</th><th>Red</th><th>Días con dato</th><th>Estado</th></tr></thead>
        <tbody>{leido.estaciones.map((e) => <tr key={`${e.nombre}|${e.red}`}><td>{e.nombre}</td><td>{REDES[e.red]}</td><td className="num">{e.dias.length}</td><td>{ya(e) ? "ya existe: se completa" : "nueva"}</td></tr>)}</tbody></table></div>
      {leido.ignorados.length > 0 && <details className="prec-ignorados"><summary>{leido.ignorados.length} {leido.ignorados.length === 1 ? "celda ignorada" : "celdas ignoradas"}</summary>
        <ul>{leido.ignorados.map((i, k) => <li key={k}>{i.hoja} · {i.celda}: «{i.valor}» ({i.motivo})</li>)}</ul></details>}
      <div className="prec-barra"><button type="button" className="prec-btn prec-btn--primario" disabled={ocupado} onClick={aplicar}>{ocupado ? "Importando…" : "Importar"}</button><button type="button" className="prec-btn" onClick={() => setLeido(null)}>Cancelar</button></div>
    </div>}
  </div>;
}
