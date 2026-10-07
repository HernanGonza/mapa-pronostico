import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { puedeUsar } from "../lib/modulos";

/** Envuelve una ruta del panel: sin sesión, manda a /login (y recuerda a
 * dónde volver). Mientras se confirma la sesión, no muestra nada — así
 * no hay flash del login antes de saber si ya está logueado. */
/** `soloSuperadmin`: pantallas en desarrollo o de poco uso, que sólo ve el superadmin (desde Configuración). */
/** `modulo`: pantalla de un módulo habilitable por usuario (lib/modulos.js): el superadmin y quien lo tenga asignado. */
export default function RutaProtegida({ children, soloSuperadmin = false, modulo = null }) {
  const { usuario, cargando } = useAuth();
  const location = useLocation();

  if (cargando) return <p className="page-loading" role="status">Comprobando sesión…</p>;
  if (!usuario) {
    return <Navigate to="/login" state={{ desde: location.pathname }} replace />;
  }
  if (soloSuperadmin && usuario.rol !== "superadmin") return <Navigate to="/panel" replace />;
  if (modulo && !puedeUsar(usuario, modulo)) return <Navigate to="/panel" replace />;
  return children;
}
