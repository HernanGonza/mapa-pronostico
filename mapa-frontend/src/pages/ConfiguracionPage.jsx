import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import { Users, Presentation } from "lucide";
import PanelBoton from "../components/PanelBoton";
import { useAuth } from "../context/AuthContext";

export default function ConfiguracionPage() {
  const { usuario } = useAuth();
  const esSuperadmin = usuario.rol === "superadmin";

  return (
    <div className="panel-layout">
      <BrandHeader subtitulo="Configuración">
        <Link to="/panel" className="btn-link">← Panel</Link>
      </BrandHeader>

      <main id="contenido-principal" tabIndex={-1}>
        <div className="panel-intro"><h1>Configuración</h1><p>Administración del sistema.</p></div>
        {esSuperadmin ? (
          <div className="panel-botonera">
            <PanelBoton op={{ to: "/panel/usuarios", icono: Users, titulo: "Usuarios", descripcion: "Creá cuentas y asigná permisos de acceso al panel." }} indice={0} />
            <PanelBoton op={{ to: "/panel/demostracion", icono: Presentation, titulo: "Demostración", descripcion: "Avisos y alertas de prueba para mostrar la pantalla de transmisión y los mapas (no se ven en el sitio público)." }} indice={1} />
          </div>
        ) : (
          <p className="admin-panel__hint">Tu cuenta no tiene opciones de configuración disponibles.</p>
        )}
      </main>
    </div>
  );
}
