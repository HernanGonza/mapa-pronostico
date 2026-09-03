import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/** Envuelve una ruta del panel: sin sesión, manda a /login (y recuerda a
 * dónde volver). Mientras se confirma la sesión, no muestra nada — así
 * no hay flash del login antes de saber si ya está logueado. */
export default function RutaProtegida({ children }) {
  const { usuario, cargando } = useAuth();
  const location = useLocation();

  if (cargando) return null;
  if (!usuario) {
    return <Navigate to="/login" state={{ desde: location.pathname }} replace />;
  }
  return children;
}
