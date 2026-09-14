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
];

const OPCION_USUARIOS = {
  to: "/panel/usuarios",
  titulo: "Usuarios",
  descripcion: "Creá cuentas y asigná permisos de acceso al panel.",
};

export default function PanelPage() {
  const { usuario, logout } = useAuth();
  // Solo `superadmin` ve "Usuarios" — `admin` y `usuario` ven el resto de
  // cuadros por igual (a `usuario` todavía le falta definir su propia
  // matriz de permisos, por ahora queda igual que `admin`).
  const opciones =
    usuario.rol === "superadmin" ? [...OPCIONES, OPCION_USUARIOS] : OPCIONES;

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

      <main id="contenido-principal" tabIndex={-1}>
      <div className="panel-intro"><h1>Mapas de Alerta Temprana</h1><p>Elegí un reporte para editar sus datos, revisar el mapa y publicar. Las placas para redes se generan y descargan desde la vista previa.</p></div>
      <div className="panel-botonera">
        {opciones.map((op) => (
          <Link key={op.to} to={op.to} className="panel-boton">
            {["/panel/alertas-incendios", "/panel/alertas-automaticas"].includes(op.to) && <span className="panel-boton__state">En desarrollo</span>}
            <h2>{op.titulo}</h2>
            <p>{op.descripcion}</p>
          </Link>
        ))}
      </div>
      </main>
    </div>
  );
}
