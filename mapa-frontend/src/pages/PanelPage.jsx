import BrandHeader from "../components/BrandHeader";
import { Layers, ChartLine, Settings } from "lucide";
import PanelBoton from "../components/PanelBoton";
import { useAuth } from "../context/AuthContext";
import { modulosDe } from "../lib/modulos";

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
        {/* Configuración (usuarios, módulos, transmisión…) es sólo del superadmin. */}
        {OPCIONES.filter((op) => op.to !== "/panel/configuracion" || usuario.rol === "superadmin").map((op, i) => <PanelBoton key={op.to} op={op} indice={i} estado={op.to === "/panel/historico" ? "En desarrollo" : null} />)}
        {/* Los módulos que se le habilitaron a este usuario (el superadmin los tiene todos en Configuración). */}
        {usuario.rol !== "superadmin" && modulosDe(usuario).map((op, i) => <PanelBoton key={op.to} op={op} indice={OPCIONES.length + i} estado="En desarrollo" />)}
      </div>
      </main>
    </div>
  );
}
