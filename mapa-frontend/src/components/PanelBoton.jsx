import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight } from "lucide";
import Icono from "./Icono";

/**
 * Tarjeta de sección del panel (panel principal y generador de mapas): ícono que se transforma, foco de
 * luz que sigue al cursor (variables CSS, sin re-render) y una etiqueta opcional de estado.
 */
export default function PanelBoton({ op, indice, estado }) {
  const [activo, setActivo] = useState(false);
  function seguir(e) {
    const caja = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - caja.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - caja.top}px`);
  }
  return (
    <Link to={op.to} className="panel-boton" style={{ "--i": indice }} onPointerMove={seguir}
      onPointerEnter={() => setActivo(true)} onPointerLeave={() => setActivo(false)} onFocus={() => setActivo(true)} onBlur={() => setActivo(false)}>
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
