import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight } from "lucide";
import Icono from "./Icono";
import { useNotificaciones } from "../lib/notificaciones";

/**
 * Tarjeta de sección del panel (panel principal y generador de mapas): ícono que se transforma, foco de
 * luz que sigue al cursor (variables CSS, sin re-render) y una etiqueta opcional de estado.
 */
export default function PanelBoton({ op, indice, estado }) {
  const [activo, setActivo] = useState(false);
  // `op.notificaciones`: tipo de notificación cuyo número de nuevas se ve en la tarjeta ("*" = todas).
  const { nuevas, nuevasPorTipo } = useNotificaciones();
  const nuevasAca = op.notificaciones ? (op.notificaciones === "*" ? nuevas : nuevasPorTipo[op.notificaciones] || 0) : 0;
  function seguir(e) {
    const caja = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - caja.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - caja.top}px`);
  }
  return (
    <Link to={op.to} className="panel-boton" style={{ "--i": indice }} onPointerMove={seguir}
      onPointerEnter={() => setActivo(true)} onPointerLeave={() => setActivo(false)} onFocus={() => setActivo(true)} onBlur={() => setActivo(false)}>
      {nuevasAca > 0 && <span className="panel-boton__nuevos" role="status" aria-label={`${nuevasAca} ${nuevasAca === 1 ? "aviso nuevo" : "avisos nuevos"}`}>{nuevasAca > 9 ? "9+" : nuevasAca}<small> {nuevasAca === 1 ? "nuevo" : "nuevos"}</small></span>}
      <span className="panel-boton__cabeza">
        <span className="panel-boton__icono"><Icono icono={op.icono} size={24} /></span>
        {estado && <span className="panel-boton__state">{estado}</span>}
      </span>
      <h2>{op.titulo}</h2>
      <p>{op.descripcion}</p>
      <span className="panel-boton__flecha" aria-hidden="true"><Icono icono={activo ? ArrowUpRight : ArrowRight} size={20} /></span>
    </Link>
  );
}
