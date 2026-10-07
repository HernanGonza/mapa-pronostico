import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/** «←» de las pantallas de módulos: el superadmin vuelve a Configuración (donde están todos); quien tiene el módulo asignado, al panel. */
export default function VolverConfiguracion() {
  const { usuario } = useAuth();
  const esSuperadmin = usuario?.rol === "superadmin";
  return <Link to={esSuperadmin ? "/panel/configuracion" : "/panel"} className="btn-link">{esSuperadmin ? "← Configuración" : "← Panel"}</Link>;
}
