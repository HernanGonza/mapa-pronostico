import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import { Users, Presentation, RadioTower, Tv } from "lucide";
import PanelBoton from "../components/PanelBoton";
import { useAuth } from "../context/AuthContext";
import { modulosDe } from "../lib/modulos";

export default function ConfiguracionPage() {
  const { usuario } = useAuth();
  // Sólo el superadmin llega acá (la ruta lo exige). Todos los módulos asignables; cada usuario ve en su panel sólo los que se le habilitan desde Usuarios.
  const modulos = modulosDe(usuario);

  return (
    <div className="panel-layout">
      <BrandHeader subtitulo="Configuración">
        <Link to="/panel" className="btn-link">← Panel</Link>
      </BrandHeader>

      <main id="contenido-principal" tabIndex={-1}>
        <div className="panel-intro"><h1>Configuración</h1><p>Administración del sistema.</p></div>
        <div className="panel-botonera">
          <PanelBoton op={{ to: "/panel/usuarios", icono: Users, titulo: "Usuarios", descripcion: "Creá cuentas, asigná permisos de acceso y habilitá módulos a cada usuario." }} indice={0} />
          <PanelBoton op={{ to: "/panel/demostracion", icono: Presentation, titulo: "Demostración", descripcion: "Avisos y alertas de prueba para mostrar la pantalla de transmisión y los mapas (no se ven en el sitio público)." }} indice={1} />
          <PanelBoton op={{ to: "/panel/transmision", icono: RadioTower, titulo: "Transmisión", descripcion: "Transmitir la pantalla /tv en vivo (YouTube, Facebook u otras) desde el servidor, sin OBS." }} indice={2} />
          <PanelBoton op={{ to: "/panel/pantalla-tv", icono: Tv, titulo: "Pantalla TV", descripcion: "Qué se ve en /tv y en qué orden: prender y apagar pantallas, sumar videos, imágenes o páginas de otros sitios." }} indice={3} />
        </div>
        <div className="panel-intro"><h2>En desarrollo</h2><p>Pantallas en desarrollo o de poco uso: cada usuario ve en su panel sólo las que le habilitás desde Usuarios.</p></div>
        <div className="panel-botonera">
          {modulos.map((op, i) => <PanelBoton key={op.to} op={op} indice={i} estado="En desarrollo" />)}
        </div>
      </main>
    </div>
  );
}
