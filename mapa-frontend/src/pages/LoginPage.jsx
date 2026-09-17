import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import BrandHeader from "../components/BrandHeader";

export default function LoginPage() {
  const { usuario, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  // Ya logueado y volviendo a /login (back del navegador, etc.) — al panel.
  if (usuario) return <Navigate to={location.state?.desde || "/panel"} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    const res = await login(email, password);
    setCargando(false);
    if (res.ok) navigate(location.state?.desde || "/panel", { replace: true });
    else setError(res.error || "No se pudo iniciar sesión");
  }

  return (
    <div className="login-layout">
      <BrandHeader subtitulo="Sistema integrado Alerta Temprana" />

      <form id="contenido-principal" tabIndex={-1} className="login-form" onSubmit={onSubmit}>
        <h1>Iniciar sesión</h1>
        <p className="admin-panel__hint">Ingresá al panel de Alerta Temprana con tu cuenta institucional.</p>

        {error && <div className="alert alert--error" role="alert">{error}</div>}

        <label className="field">
          <span>Correo electrónico</span>
          <input
            type="email"
            name="email"
            spellCheck={false}
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={cargando}
            required
          />
        </label>
        <label className="field">
          <span>Contraseña</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={cargando}
            required
          />
        </label>

        <button className="btn btn--primary btn--block" type="submit" disabled={cargando}>
          {cargando ? "Entrando…" : "Entrar"}
        </button>
        <Link className="btn-link login-help" to="/recuperar-contrasena">¿Olvidaste tu contraseña?</Link>
      </form>
    </div>
  );
}
