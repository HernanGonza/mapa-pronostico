import { Link } from "react-router-dom";
import { CloudSun, CalendarDays, Flame, CloudLightning, PenLine, Megaphone } from "lucide";
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
    to: "/panel/alertas-meteorologicas",
    icono: CloudLightning,
    titulo: "Alertas meteorológicas",
    descripcion: "Mapa de alertas por departamento y placas para redes.",
  },
  {
    to: "/panel/avisos-corto-plazo",
    icono: PenLine,
    titulo: "Avisos a muy corto plazo",
    notificaciones: "acp",
    descripcion: "Dibujá la zona afectada en el mapa y generá una placa de texto libre para redes.",
  },
  {
    to: "/panel/aviso-especial",
    icono: Megaphone,
    titulo: "Aviso especial",
    descripcion: "Texto libre con una captura de radar o satélite: placas de feed e historias.",
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
        {/* Focos de calor, alertas automáticas, inundaciones y cuencas: en Configuración (sólo superadmin). */}
        {OPCIONES.map((op, i) => <PanelBoton key={op.to} op={op} indice={i} />)}
      </div>
      </main>
    </div>
  );
}
