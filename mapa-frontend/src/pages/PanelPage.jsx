import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import { useAuth } from "../context/AuthContext";

const OPCIONES = [
  {
    to: "/panel/mapas",
    titulo: "Generador de mapas",
    descripcion: "Pronóstico, riesgo de incendios, alertas meteorológicas y avisos — placas para redes.",
  },
  {
    to: "/panel/historico",
    titulo: "Registro histórico y estadísticas",
    descripcion: "Consultá todo lo publicado y generado, con estadísticas sobre esos datos.",
  },
  {
    to: "/panel/generador-pronosticos",
    titulo: "Generador de pronósticos",
    descripcion: "Recolección de datos de las distintas fuentes que se usan para armar el pronóstico.",
  },
  {
    to: "/panel/configuracion",
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
        {OPCIONES.map((op) => (
          <Link key={op.to} to={op.to} className="panel-boton">
            {["/panel/historico", "/panel/generador-pronosticos"].includes(op.to) && <span className="panel-boton__state">En desarrollo</span>}
            <h2>{op.titulo}</h2>
            <p>{op.descripcion}</p>
          </Link>
        ))}
      </div>
      </main>
    </div>
  );
}
