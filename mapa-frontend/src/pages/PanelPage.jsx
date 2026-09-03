import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import { useAuth } from "../context/AuthContext";

const OPCIONES = [
  {
    to: "/panel/pronostico",
    titulo: "Pronóstico",
    descripcion:
      "Mapa del tiempo por municipio, a partir del .docx que manda Alerta Temprana.",
  },
  {
    to: "/panel/riesgo-incendios",
    titulo: "Riesgo de incendios",
    descripcion: "Mapa de peligro de incendios forestales.",
  },
  {
    to: "/panel/alertas-incendios",
    titulo: "Alertas de incendios",
    descripcion: "Últimos focos detectados (NASA FIRMS).",
  },
];

export default function PanelPage() {
  const { usuario, logout } = useAuth();

  return (
    <div className="panel-layout">
      <BrandHeader subtitulo="Plataforma de mapas">
        <span className="panel-sesion">
          {usuario.email}
          <button className="btn-link" onClick={logout}>
            Cerrar sesión
          </button>
        </span>
      </BrandHeader>

      <div className="panel-botonera">
        {OPCIONES.map((op) => (
          <Link key={op.to} to={op.to} className="panel-boton">
            <h2>{op.titulo}</h2>
            <p>{op.descripcion}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
