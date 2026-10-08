import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide";
import Icono from "./Icono";
import { useNotificaciones, marcarLeidas } from "../lib/notificaciones";
import { tiempoRelativo } from "../lib/tiempoRelativo";

/**
 * Campanita de la cabecera del panel (al lado del correo): número de notificaciones nuevas y un desplegable con
 * las últimas. Hoy trae los ACP que llegan; después, las alertas automáticas. Tocar una la marca como leída y
 * lleva a su pantalla. La lista va sobre <body> para que no la corte el borde de la cabecera.
 */
// Qué es cada notificación (la etiqueta de la lista). Al sumar un tipo nuevo (alertas automáticas…), se agrega acá.
const TIPOS = { acp: { etiqueta: "ACP", detalle: "Aviso a muy corto plazo" }, alerta: { etiqueta: "Alerta", detalle: "Alerta meteorológica" } };
const tipoDe = (tipo) => TIPOS[tipo] || { etiqueta: String(tipo).toUpperCase(), detalle: String(tipo) };

export default function NotificacionesMenu() {
  const { notificaciones, nuevas } = useNotificaciones();
  const navegar = useNavigate();
  const boton = useRef(null), lista = useRef(null);
  const [pos, setPos] = useState(null); // null = cerrado

  useEffect(() => {
    if (!pos) return undefined;
    const cerrar = () => setPos(null);
    const afuera = (e) => { if (!lista.current?.contains(e.target) && !boton.current?.contains(e.target)) cerrar(); };
    const esc = (e) => { if (e.key === "Escape") { cerrar(); boton.current?.focus(); } };
    const alScroll = (e) => { if (!lista.current?.contains(e.target)) cerrar(); };
    document.addEventListener("mousedown", afuera);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", alScroll, true);
    window.addEventListener("resize", cerrar);
    return () => { document.removeEventListener("mousedown", afuera); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", alScroll, true); window.removeEventListener("resize", cerrar); };
  }, [pos]);

  const alternar = () => {
    if (pos) { setPos(null); return; }
    const r = boton.current.getBoundingClientRect(), ancho = Math.min(380, window.innerWidth - 16);
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - ancho, window.innerWidth - ancho - 8)), width: ancho });
  };
  const abrir = (n) => { setPos(null); if (!n.leida) marcarLeidas({ ids: [n.id] }); if (n.url) navegar(n.url); };

  return <>
    <button ref={boton} type="button" className="notif-boton" onClick={alternar} aria-haspopup="dialog" aria-expanded={!!pos}
      aria-label={nuevas ? `Notificaciones: ${nuevas} ${nuevas === 1 ? "nueva" : "nuevas"}` : "Notificaciones"} title="Notificaciones">
      <Icono icono={Bell} size={20} />
      {nuevas > 0 && <span className="notif-boton__numero">{nuevas > 9 ? "9+" : nuevas}</span>}
    </button>
    {pos && createPortal(<div ref={lista} className="notif-lista" role="dialog" aria-label="Notificaciones" style={pos}>
      <header><strong>Notificaciones</strong>
        <button type="button" className="btn-link" disabled={!nuevas} onClick={() => marcarLeidas({ todas: true })}>Marcar todas como leídas</button></header>
      {notificaciones.length === 0
        ? <p className="notif-lista__vacio">No hay notificaciones nuevas.</p>
        : <ul>{notificaciones.map((n) => <li key={n.id}>
            <button type="button" className={`notif-item${n.leida || n.resuelta ? "" : " notif-item--nueva"}${n.vencida || n.resuelta ? " notif-item--vencida" : ""}`} onClick={() => abrir(n)}>
              <i aria-hidden="true" />
              <span>{!n.leida && !n.resuelta && !n.vencida && <b className="notif-nueva">Nueva</b>}<em className={`notif-tipo notif-tipo--${n.tipo}`} title={tipoDe(n.tipo).detalle}>{tipoDe(n.tipo).etiqueta}<small> · {tipoDe(n.tipo).detalle}</small></em><strong>{n.titulo}</strong>{n.detalle && <small>{n.detalle}</small>}
                <small>{tiempoRelativo(n.creadaEn)}{n.resuelta ? ` · ya la tomó ${n.resueltaPor || "alguien"}` : n.vencida && " · ya venció"}</small></span>
            </button></li>)}</ul>}
    </div>, document.body)}
  </>;
}
