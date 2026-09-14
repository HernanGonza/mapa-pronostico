import { useState } from "react";
import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import PasswordChecklist, { passwordValida } from "../components/PasswordChecklist";
import { recuperarPassword } from "../api";

export default function RecuperarPasswordPage() {
  const [codigo, setCodigo] = useState("");
  const [password, setPassword] = useState("");
  const [repetirPassword, setRepetirPassword] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);
  async function enviar(e) {
    e.preventDefault(); setError("");
    if (!passwordValida(password) || password.length > 256) return setError("La contraseña debe cumplir los requisitos y tener hasta 256 caracteres.");
    if (password !== repetirPassword) return setError("Las contraseñas no coinciden.");
    setOcupado(true);
    try {
      await recuperarPassword({ codigo, password, repetirPassword });
      setCodigo(""); setPassword(""); setRepetirPassword(""); setListo(true);
    } catch (e) { setError(e.message); }
    finally { setOcupado(false); }
  }
  return <div className="login-layout">
    <BrandHeader subtitulo="Recuperar acceso" />
    <main id="contenido-principal" tabIndex={-1} className="login-form">
      <h1>{listo ? "Contraseña actualizada" : "Recuperar contraseña"}</h1>
      {listo ? <>
        <p role="status">Tu contraseña se cambió y las sesiones anteriores se cerraron. Iniciá sesión con tu contraseña nueva.</p>
        <Link className="btn btn--primary btn--block" to="/login" reloadDocument>Ir a iniciar sesión</Link>
      </> : <>
        <p className="admin-panel__hint">Pedile un código al superadministrador. Después de verificar tu identidad, te lo enviará por WhatsApp. El código vence a los 15 minutos y se usa una sola vez.</p>
        <form onSubmit={enviar}>
          {error && <p className="alert alert--error" role="alert">{error}</p>}
          <label className="field"><span>Código recibido por WhatsApp</span><input name="codigo" type="text" autoComplete="one-time-code" spellCheck={false} maxLength={80} required disabled={ocupado} value={codigo} onChange={e => setCodigo(e.target.value)} /></label>
          <label className="field"><span>Contraseña nueva</span><input name="password" type="password" autoComplete="new-password" maxLength={256} required disabled={ocupado} value={password} onChange={e => setPassword(e.target.value)} /></label>
          <PasswordChecklist password={password} />
          <label className="field"><span>Repetir contraseña nueva</span><input name="repetirPassword" type="password" autoComplete="new-password" maxLength={256} required disabled={ocupado} value={repetirPassword} onChange={e => setRepetirPassword(e.target.value)} /></label>
          <button className="btn btn--primary btn--block" disabled={ocupado}>{ocupado ? "Cambiando contraseña…" : "Cambiar contraseña"}</button>
        </form>
        <Link className="btn-link login-help" to="/login">Volver a iniciar sesión</Link>
      </>}
    </main>
  </div>;
}
