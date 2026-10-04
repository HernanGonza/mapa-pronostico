import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import { Users, Presentation, RadioTower, Tv, Radar, Bell, Waves, Droplets, CloudSun, FileText } from "lucide";
import PanelBoton from "../components/PanelBoton";
import { useAuth } from "../context/AuthContext";

// Sólo para el superadmin (las rutas también lo exigen, ver RutaProtegida soloSuperadmin).
const EN_DESARROLLO = [
  { to: "/panel/alertas-incendios", icono: Radar, titulo: "Focos de calor", descripcion: "Anomalías térmicas detectadas por satélite (NASA FIRMS)." },
  { to: "/panel/alertas-automaticas", icono: Bell, titulo: "Alertas automáticas (SMN)", descripcion: "Avisos del SMN por período y zona, en revisión." },
  { to: "/panel/inundaciones", icono: Waves, titulo: "Inundaciones", descripcion: "Placas de alerta por inundación." },
  { to: "/panel/cuencas", icono: Droplets, titulo: "Monitor de cuencas", descripcion: "Defluente de represas y altura de los ríos Paraná, Uruguay e Iguazú (SIG Misiones)." },
  { to: "/panel/informes-diarios", icono: FileText, titulo: "Informes diarios", descripcion: "Qué pasó un día (por ejemplo, una tormenta) según las estaciones oficiales del INTA y SiNaRaMe, con lo que emitió el SMN: informe con mapa, tabla y gráficos, en PDF." },
  { to: "/panel/generador-pronosticos", icono: CloudSun, titulo: "Generador de pronósticos", descripcion: "Recolección de datos de las distintas fuentes que se usan para armar el pronóstico." },
];

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
            <PanelBoton op={{ to: "/panel/transmision", icono: RadioTower, titulo: "Transmisión", descripcion: "Transmitir la pantalla /tv en vivo (YouTube, Facebook u otras) desde el servidor, sin OBS." }} indice={2} />
            <PanelBoton op={{ to: "/panel/pantalla-tv", icono: Tv, titulo: "Pantalla TV", descripcion: "Qué se ve en /tv y en qué orden: prender y apagar pantallas, sumar videos, imágenes o páginas de otros sitios." }} indice={3} />
          </div>
        ) : (
          <p className="admin-panel__hint">Tu cuenta no tiene opciones de configuración disponibles.</p>
        )}
        {esSuperadmin && <>
          <div className="panel-intro"><h2>En desarrollo</h2><p>Pantallas en desarrollo o de poco uso: no aparecen en el panel para el resto de los usuarios.</p></div>
          <div className="panel-botonera">
            {EN_DESARROLLO.map((op, i) => <PanelBoton key={op.to} op={op} indice={i} estado="En desarrollo" />)}
          </div>
        </>}
      </main>
    </div>
  );
}
