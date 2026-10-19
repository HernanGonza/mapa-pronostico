import MenuAcciones from "./MenuAcciones";
import WeatherIcon from "./WeatherIcon";
import { problemasParaMapa, ZONAS } from "./InformePronostico";
import { problemasV2, nombreDeBoton, fechaCorta, nombreDia, textoRango, ZONAS_ORDEN } from "../lib/informePlantillas";

const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const horaCorta = (iso) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Estado de un informe para sus insignias: qué le pasó. `actual` es lo que está publicado ahora en los mapas ({ publicadoEn }).
 * Se arma acá (y no en la pantalla) para que las insignias y el resumen de la tarjeta digan siempre lo mismo.
 */
export function estadoDeInforme(informe, actual) {
  const { meta = {}, borrador } = informe;
  const v2 = borrador.version === 2;
  const problemas = v2 ? problemasV2(borrador) : problemasParaMapa(borrador);
  const enMapas = !!meta.publicadoEn && !!actual && new Date(meta.publicadoEn).getTime() === new Date(actual.publicadoEn).getTime();
  const envios = meta.envios || [];
  return { completo: problemas.length === 0, publicable: problemas.length === 0, v2, problemas, enMapas, publicadoAntes: !!meta.publicadoEn && !enMapas, envios, ultimoEnvio: envios.at(-1) || null, placa: meta.placa || null };
}

/**
 * Una tarjeta de la pila de informes (como las de las alertas): insignias de lo que le pasó al informe (en los mapas, enviado, placa),
 * un resumen de las tres zonas y todas las acciones del informe: editar, publicar, PDF, placa para redes, correo.
 */
export default function TarjetaInformePronostico({ informe, actual, enElMapa, guardado, ocupado, acciones }) {
  const { borrador: b, meta = {} } = informe;
  const e = estadoDeInforme(informe, actual);
  const bloqueo = e.completo ? null : "Completá lo que falta para poder usarlo";
  return <li className={`alerta-tarjeta pron-tarjeta${enElMapa ? " alerta-tarjeta--elegida" : ""}`} onClick={acciones.verEnMapa} tabIndex={0} aria-current={enElMapa || undefined} onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); acciones.verEnMapa(); } }} title="Tocá la tarjeta para verlo en el mapa de acá">
    <div className="alerta-tarjeta__cab">
      <strong>Informe #{informe.id}{b.version === 2 ? ` · ${nombreDeBoton(b.boton)}` : ""}</strong>
      <span className="pron-fecha">{new Date(`${b.fecha}T12:00:00Z`).toLocaleDateString("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })}{b.emision ? ` · ${b.emision} h` : ""}{b.vigencia ? ` · hasta las ${b.vigencia.hasta} h` : ""}</span>
      {enElMapa && <span className="alerta-tarjeta__viendo">En el mapa de acá</span>}
    </div>
    <div className="pron-insignias" aria-label="Estado del informe">
      {e.enMapas && <span className="pron-insignia pron-insignia--mapas" title={`Publicado el ${fechaHora(meta.publicadoEn)}${meta.publicadoPor ? ` por ${meta.publicadoPor}` : ""}`}>En los mapas ahora</span>}
      {e.publicadoAntes && <span className="pron-insignia pron-insignia--antes" title={`Se publicó el ${fechaHora(meta.publicadoEn)}, pero después se publicó otro`}>Publicado antes</span>}
      {!meta.publicadoEn && (e.completo ? <span className="pron-insignia pron-insignia--listo">Listo para publicar</span> : <span className="pron-insignia pron-insignia--borrador" title={e.problemas.slice(0, 4).join("\n")}>Borrador · falta completar</span>)}
      {e.ultimoEnvio ? <span className="pron-insignia pron-insignia--enviado" title={`Último envío: ${fechaHora(e.ultimoEnvio.en)} a ${e.ultimoEnvio.destinatarios} destinatarios${e.ultimoEnvio.por ? `, por ${e.ultimoEnvio.por}` : ""}`}>Enviado{e.envios.length > 1 ? ` ×${e.envios.length}` : ""}</span> : <span className="pron-insignia pron-insignia--no">Sin enviar</span>}
      {e.placa ? <span className="pron-insignia pron-insignia--placa" title={`Placa generada el ${fechaHora(e.placa.generadoEn)}${e.placa.por ? ` por ${e.placa.por}` : ""}`}>Placa lista</span> : <span className="pron-insignia pron-insignia--no">Sin placa</span>}
    </div>
    {e.v2 ? <div className="pron-v2">{b.dias.map((d) => <div key={d.fecha} className="pron-v2__dia"><strong>{nombreDia(d.fecha).slice(0, 3)} {fechaCorta(d.fecha).slice(0, 5)}</strong>{d.temps.map((t) => <span key={t}>{{ tmax: "Máx", tmin: "Mín", tnoct: "Noct" }[t]} {ZONAS_ORDEN.map((z) => textoRango(d.zonas[z][t]).replace(/° C/g, "°") || "–").join(" · ")}</span>)}</div>)}</div> : <div className="pron-zonas">{ZONAS.map((z) => <div key={z} className="pron-zona"><strong>{z}</strong><span className="pron-zona__temps"><i>{b.zonas[z].tmin || "–"}°</i> / <b>{b.zonas[z].tmax || "–"}°</b></span>{b.zonas[z].condicion ? <WeatherIcon condicion={b.zonas[z].condicion} size={30} title={b.zonas[z].condicion} /> : <small>sin condición</small>}</div>)}</div>}
    <small className="pron-detalle">
      {informe.creadoPor ? `Armado por ${informe.creadoPor} · ` : ""}actualizado {fechaHora(informe.actualizadoEn)}
      {guardado?.estado === "guardando" && " · guardando…"}{guardado?.estado === "error" && " · no se pudo guardar"}
      {meta.publicadoEn && <><br />Publicado el {fechaHora(meta.publicadoEn)}{meta.publicadoPor ? ` por ${meta.publicadoPor}` : ""}</>}
      {e.ultimoEnvio && <><br />Enviado el {fechaHora(e.ultimoEnvio.en)} a {e.ultimoEnvio.destinatarios} destinatario{e.ultimoEnvio.destinatarios === 1 ? "" : "s"}{e.ultimoEnvio.por ? ` (${e.ultimoEnvio.por})` : ""} · {horaCorta(e.ultimoEnvio.en)} h</>}
    </small>
    <div className="avisos-lista__acciones" onClick={(ev) => ev.stopPropagation()}>
      <button type="button" className="btn btn--primary" onClick={acciones.editar}>Editar</button>
      <button type="button" className="btn" disabled={!e.publicable || ocupado} title={bloqueo || undefined} onClick={acciones.publicar}>{e.enMapas ? "Republicar en los mapas" : "Publicar en los mapas"}</button>
      <MenuAcciones etiqueta="PDF" items={[{ texto: "Ver el PDF", alHacer: acciones.verPdf }, { texto: "Descargar el PDF", alHacer: acciones.bajarPdf }, ...(e.v2 ? [{ texto: "Descargar Word (.docx)", alHacer: acciones.bajarDocx }, { texto: "Descargar RTF", alHacer: acciones.bajarRtf }] : [])]} />
      <MenuAcciones etiqueta="Placa para redes" items={[
        { texto: e.placa ? "Crear una placa nueva" : "Crear placa", deshabilitado: !e.publicable, alHacer: acciones.crearPlaca },
        ...(e.placa ? [{ texto: "Ver la placa", alHacer: acciones.verPlaca }] : []),
      ]} />
      <button type="button" className="btn" disabled={ocupado} onClick={acciones.enviar}>{e.ultimoEnvio ? "Enviar otra vez" : "Enviar por correo"}</button>
      <MenuAcciones etiqueta="Más" titulo="Más acciones" items={[
        { texto: "Destinatarios del correo", alHacer: acciones.destinatarios },
        { texto: "Duplicar este informe", alHacer: acciones.duplicar },
        { separador: true },
        { texto: "Borrar informe", peligro: true, alHacer: acciones.borrar },
      ]} />
    </div>
  </li>;
}
