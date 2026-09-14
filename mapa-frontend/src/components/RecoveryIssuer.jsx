import { useEffect, useRef, useState } from "react";
import { generarCodigoRecuperacion } from "../api";

export default function RecoveryIssuer({ usuario, onClose }) {
  const [verificado, setVerificado] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [vencido, setVencido] = useState(false);
  const heading = useRef(null);
  const nombre = [usuario.nombre, usuario.apellido].filter(Boolean).join(" ") || usuario.email;
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    if (!resultado) return;
    const timer = setTimeout(() => { setResultado(null); setVencido(true); setVerificado(false); }, Math.max(0, new Date(resultado.expiraEn).getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [resultado]);
  async function generar(e) {
    e.preventDefault();
    if (!verificado) return;
    setOcupado(true); setError(""); setCopiado(false);
    try { setResultado(await generarCodigoRecuperacion(usuario.id, usuario.telefono)); setVencido(false); }
    catch (e) { setError(e.message); }
    finally { setOcupado(false); }
  }
  const mensaje = resultado ? `Hola ${nombre}. Para cambiar tu contraseña de Alerta Temprana, entrá a ${window.location.origin}/recuperar-contrasena e ingresá este código:\n\n${resultado.codigo}\n\nVence a las ${new Date(resultado.expiraEn).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} (hora de quien lo envía), tiene un solo uso. No compartas el código ni tu contraseña.` : "";
  async function copiar() {
    try { await navigator.clipboard.writeText(mensaje); setCopiado(true); setError(""); }
    catch { setError("Seleccioná el mensaje y copialo manualmente."); }
  }
  return <section className="recovery-issuer risk-review" aria-label="Recuperación asistida">
    <h2 tabIndex={-1} ref={heading}>Recuperar acceso de {nombre}</h2>
    <p>DNI: {usuario.dni || "Sin registrar"}<br />Teléfono registrado: <strong>{usuario.telefono || "Sin registrar"}</strong></p>
    {error && <p className="alert alert--error" role="alert">{error}</p>}
    {vencido && <p className="alert alert--warn" role="status">El código venció. Podés generar uno nuevo.</p>}
    {!resultado ? <form onSubmit={generar}>
      <p>Verificá la identidad de la persona y que este número le pertenezca. El código nuevo reemplaza cualquier código anterior.</p>
      <label className="recovery-check"><input type="checkbox" required checked={verificado} disabled={ocupado || !usuario.telefono} onChange={e => setVerificado(e.target.checked)} />Verifiqué la identidad y el teléfono registrado.</label>
      {!usuario.telefono && <p className="alert alert--warn">Esta cuenta no tiene teléfono registrado. Contactá al responsable del sistema para completar sus datos.</p>}
      <button className="btn btn--primary" disabled={ocupado || !verificado || !usuario.telefono}>{ocupado ? "Generando…" : "Generar código de recuperación"}</button>
    </form> : <div>
      <p role="status">Código generado. Copialo ahora: al cerrar esta pantalla no se vuelve a mostrar.</p>
      <label className="field"><span>Mensaje para enviar por WhatsApp al número verificado</span><textarea rows={7} readOnly value={mensaje} onFocus={e => e.target.select()} /></label>
      <button type="button" className="btn btn--primary" onClick={copiar}>Copiar mensaje para WhatsApp</button>
      {copiado && <p role="status">Mensaje copiado. Pegalo en la conversación con la persona.</p>}
    </div>}
    <button type="button" className="btn btn--ghost recovery-close" disabled={ocupado} onClick={onClose}>Cerrar</button>
  </section>;
}
