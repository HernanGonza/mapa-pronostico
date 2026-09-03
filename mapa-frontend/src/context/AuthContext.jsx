import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getSesion, iniciarSesion, cerrarSesion } from "../api";

const AuthContext = createContext(null);

/** `usuario === undefined` mientras se consulta /api/auth/me al arrancar —
 * evita el parpadeo hacia /login en cada F5 de alguien ya logueado. */
export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(undefined);

  useEffect(() => {
    getSesion()
      .then(setUsuario)
      .catch(() => setUsuario(null));
  }, []);

  const login = useCallback(async (email, password) => {
    try {
      const u = await iniciarSesion(email, password);
      setUsuario(u);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, []);

  const logout = useCallback(async () => {
    await cerrarSesion().catch(() => {});
    setUsuario(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ usuario, cargando: usuario === undefined, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
