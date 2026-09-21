import { Link } from "react-router-dom";
import { CloudSun, CalendarDays, Flame, Radar, CloudLightning, Bell, PenLine, Waves, Droplets } from "lucide";
import PanelBoton from "../components/PanelBoton";
import BrandHeader from "../components/BrandHeader";
import { useAuth } from "../context/AuthContext";

const OPCIONES = [
  {
    to: "/panel/pronostico",
    icono: CloudSun,
    titulo: "Pronóstico",
    descripcion:
      "Mapa del tiempo por municipio, a partir del .docx que manda Alerta Temprana.",
  },
  {
    to: "/panel/pronostico-3-dias",
    icono: CalendarDays,
    titulo: "Pronóstico de 3 días",
    descripcion: "Sábado y domingo por zona, a partir del pronóstico extendido del mismo .docx.",
  },
  {
    to: "/panel/riesgo-incendios",
    icono: Flame,
    titulo: "Riesgo de incendios",
    descripcion: "Mapa de peligro de incendios forestales.",
  },
  {
    to: "/panel/alertas-incendios",
    icono: Radar,
    titulo: "Focos de calor",
    descripcion: "Anomalías térmicas detectadas por satélite (NASA FIRMS).",
  },
  {
    to: "/panel/alertas-meteorologicas",
    icono: CloudLightning,
    titulo: "Alertas meteorológicas",
    descripcion: "Mapa de alertas por departamento, placas para redes y recomendaciones.",
  },
  {
    to: "/panel/alertas-automaticas",
    icono: Bell,
    titulo: "Alertas automáticas (SMN)",
    descripcion: "Avisos del SMN por período y zona, en revisión.",
  },
  {
    to: "/panel/avisos-corto-plazo",
    icono: PenLine,
    titulo: "Avisos a muy corto plazo",
    descripcion: "Dibujá la zona afectada en el mapa y generá una placa de texto libre para redes.",
  },
  {
    to: "/panel/inundaciones",
    icono: Waves,
    titulo: "Inundaciones",
    descripcion: "Placas de alerta por inundación.",
  },
  {
    to: "/panel/cuencas",
    icono: Droplets,
    titulo: "Monitor de cuencas",
    descripcion: "Defluente de represas y altura de los ríos Paraná, Uruguay e Iguazú (SIG Misiones).",
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
        {OPCIONES.map((op, i) => <PanelBoton key={op.to} op={op} indice={i} estado={["/panel/alertas-automaticas", "/panel/inundaciones", "/panel/cuencas"].includes(op.to) ? "En desarrollo" : null} />)}
      </div>
      </main>
    </div>
  );
}
