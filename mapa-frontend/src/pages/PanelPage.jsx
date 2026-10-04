import BrandHeader from "../components/BrandHeader";
import { Layers, ChartLine, Settings } from "lucide";
import PanelBoton from "../components/PanelBoton";
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
        {/* El histórico sigue en desarrollo pero lo ven todos: los usuarios guían cómo armarlo. El resto de
            lo que está en desarrollo (generador de pronósticos…) va en Configuración, sólo para el superadmin. */}
        {OPCIONES.map((op, i) => <PanelBoton key={op.to} op={op} indice={i} estado={op.to === "/panel/historico" ? "En desarrollo" : null} />)}
      </div>
      </main>
    </div>
  );
}
