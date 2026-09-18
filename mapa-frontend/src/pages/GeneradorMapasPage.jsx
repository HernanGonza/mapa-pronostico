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
    to: "/panel/pronostico-3-dias",
    titulo: "Pronóstico de 3 días",
    descripcion: "Sábado y domingo por zona, a partir del pronóstico extendido del mismo .docx.",
  },
  {
    to: "/panel/riesgo-incendios",
    titulo: "Riesgo de incendios",
    descripcion: "Mapa de peligro de incendios forestales.",
  },
  {
    to: "/panel/alertas-incendios",
    titulo: "Puntos de calor",
    descripcion: "Anomalías térmicas detectadas por satélite (NASA FIRMS).",
  },
  {
    to: "/panel/alertas-meteorologicas",
    titulo: "Alertas meteorológicas",
    descripcion: "Mapa de alertas por departamento, placas para redes y recomendaciones.",
  },
  {
    to: "/panel/alertas-automaticas",
    titulo: "Alertas automáticas (SMN)",
    descripcion: "Avisos del SMN por período y zona, en revisión.",
  },
  {
    to: "/panel/avisos-corto-plazo",
    titulo: "Avisos a muy corto plazo",
    descripcion: "Dibujá la zona afectada en el mapa y generá una placa de texto libre para redes.",
  },
  {
    to: "/panel/inundaciones",
    titulo: "Inundaciones",
    descripcion: "Placas de alerta por inundación.",
  },
];

export default function GeneradorMapasPage() {
  const { usuario, logout } = useAuth();

  return (
    <div className="panel-layout">
      <BrandHeader subtitulo="Generador de mapas">
        <Link to="/panel" className="btn-link">← Panel</Link>
        <span className="panel-sesion">
          {usuario.email}
          <button className="btn-link" onClick={logout}>
            Cerrar sesión
          </button>
        </span>
      </BrandHeader>

      <main id="contenido-principal" tabIndex={-1}>
      <div className="panel-intro"><h1>Generador de mapas</h1><p>Elegí un reporte para editar sus datos, revisar el mapa y publicar. Las placas para redes se generan y descargan desde la vista previa.</p></div>
      <div className="panel-botonera">
        {OPCIONES.map((op) => (
          <Link key={op.to} to={op.to} className="panel-boton">
            {["/panel/alertas-automaticas", "/panel/inundaciones"].includes(op.to) && <span className="panel-boton__state">En desarrollo</span>}
            <h2>{op.titulo}</h2>
            <p>{op.descripcion}</p>
          </Link>
        ))}
      </div>
      </main>
    </div>
  );
}
