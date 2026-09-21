import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import { Layers, ChartLine, CloudSun, Settings, ArrowRight, ArrowUpRight } from "lucide";
import { useState } from "react";
import Icono from "../components/Icono";
import { useAuth } from "../context/AuthContext";

const OPCIONES = [
  {
    to: "/panel/mapas",
    icono: Layers,
    titulo: "Generador de mapas",
    descripcion: "Pronóstico, riesgo de incendios, alertas meteorológicas y avisos — placas para redes.",
  },
  {
    to: "/panel/historico",
    icono: ChartLine,
    titulo: "Registro histórico y estadísticas",
    descripcion: "Consultá todo lo publicado y generado, con estadísticas sobre esos datos.",
  },
  {
    to: "/panel/generador-pronosticos",
    icono: CloudSun,
    titulo: "Generador de pronósticos",
    descripcion: "Recolección de datos de las distintas fuentes que se usan para armar el pronóstico.",
  },
  {
    to: "/panel/configuracion",
    icono: Settings,
    titulo: "Configuración",
    descripcion: "Usuarios y permisos de acceso al sistema.",
  },
];

export default function PanelPage() {
  const { usuario, logout } = useAuth();

  return (
    <div className="panel-layout">
      <BrandHeader subtitulo="Sistema integrado">
        <span className="panel-sesion">
          {usuario.email}
          <button className="btn-link" onClick={logout}>
            Cerrar sesión
          </button>
        </span>
      </BrandHeader>

      <main id="contenido-principal" tabIndex={-1}>
      <div className="panel-intro"><h1>Sistema Integrado Alerta Temprana</h1><p>Elegí una sección para empezar a trabajar.</p></div>
      <div className="panel-botonera">
        {OPCIONES.map((op, i) => <PanelBoton key={op.to} op={op} indice={i} />)}
      </div>
      </main>
    </div>
  );
}

/** Tarjeta del panel: foco de luz que sigue al cursor (variables CSS, sin re-render) e ícono que se transforma al pasar. */
function PanelBoton({ op, indice }) {
  const [activo, setActivo] = useState(false);
  const enDesarrollo = ["/panel/historico", "/panel/generador-pronosticos"].includes(op.to);
  function seguir(e) {
    const caja = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - caja.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - caja.top}px`);
  }
  return (
    <Link to={op.to} className="panel-boton" style={{ "--i": indice }} onPointerMove={seguir}
      onPointerEnter={() => setActivo(true)} onPointerLeave={() => setActivo(false)} onFocus={() => setActivo(true)} onBlur={() => setActivo(false)}>
      <span className="panel-boton__icono"><Icono icono={op.icono} size={26} /></span>
      {enDesarrollo && <span className="panel-boton__state">En desarrollo</span>}
      <h2>{op.titulo}</h2>
      <p>{op.descripcion}</p>
      <span className="panel-boton__flecha" aria-hidden="true"><Icono icono={activo ? ArrowUpRight : ArrowRight} size={20} /></span>
    </Link>
  );
}
