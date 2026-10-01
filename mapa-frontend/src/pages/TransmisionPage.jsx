import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import { useAuth } from "../context/AuthContext";
import { confirmar } from "../lib/ui";
import { tiempoRelativo } from "../lib/tiempoRelativo";
import { getTransmisionEstado, iniciarTransmision, detenerTransmision, urlCapturaTransmision } from "../api";

/**
 * Transmisión a YouTube desde el servidor (sin OBS): prende y apaga el servicio
 * `transmision`, que abre la página /tv en una pantalla virtual y la manda a YouTube.
 * Sólo superadmin, como Usuarios y Demostración (está dentro de Configuración).
 */
export default function TransmisionPage() {
  const { usuario } = useAuth();
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [captura, setCaptura] = useState(0);

  const cargar = () => getTransmisionEstado().then((e) => { setEstado(e); setError(""); }).catch((e) => setError(e.message));
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 5000);
    return () => clearInterval(t);
  }, []);
  // Vista previa: una captura nueva cada 10 s mientras está al aire.
  useEffect(() => {
    if (!estado?.alAire) return undefined;
    setCaptura(Date.now());
    const t = setInterval(() => setCaptura(Date.now()), 10000);
    return () => clearInterval(t);
  }, [estado?.alAire]);

  if (usuario && usuario.rol !== "superadmin") return <Navigate to="/panel/configuracion" replace />;

  async function accion(fn, pregunta) {
    if (pregunta && !(await confirmar(pregunta))) return;
    setOcupado(true); setError("");
    try { await fn(); await cargar(); } catch (e) { setError(e.message); } finally { setOcupado(false); }
  }
  const iniciar = () => accion(iniciarTransmision, { titulo: "¿Salir al aire en YouTube?", texto: "La página /tv se empieza a transmitir en vivo y sigue sola, las 24 horas, hasta que la detengas.", confirmar: "Iniciar transmisión" });
  const detener = () => accion(detenerTransmision, { titulo: "¿Cortar la transmisión?", texto: "YouTube deja de recibir la señal en el momento.", confirmar: "Detener", peligro: true });

  const situacion = !estado ? null
    : estado.alAire ? { clase: "on", texto: "Al aire" }
    : estado.activo ? { clase: "espera", texto: estado.error ? "Reintentando…" : "Preparando…" }
    : { clase: "off", texto: "Detenida" };

  return <div className="admin-layout">
    <BrandHeader subtitulo="Transmisión"><Link to="/panel/configuracion" className="btn-link">← Configuración</Link></BrandHeader>
    <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading">
        <h1>Transmisión a YouTube</h1>
        <p>El servidor abre la pantalla de transmisión (<a href="/tv" target="_blank" rel="noreferrer">/tv</a>) y la manda en vivo a YouTube, sin OBS ni una computadora prendida. Si algo se cae, se reinicia solo; si se reinicia el servidor, retoma.</p>
      </div>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      {estado && <>
        <p className={`transmision-estado transmision-estado--${situacion.clase}`} role="status">
          <i aria-hidden="true" />{situacion.texto}{estado.alAire && estado.desde && <small> · desde {tiempoRelativo(estado.desde)}</small>}
        </p>
        {estado.error && <div className="alert alert--warn" role="status">{estado.error}{estado.reinicios ? ` (reintento ${estado.reinicios})` : ""}</div>}
        {!estado.config.claveConfigurada && <div className="alert alert--warn">Falta la clave de transmisión de YouTube (<code>YOUTUBE_STREAM_KEY</code>) en el <code>.env</code> del servidor.</div>}
        <div className="admin-acciones">
          {estado.activo
            ? <button type="button" className="btn btn--block" disabled={ocupado} onClick={detener}>Detener transmisión</button>
            : <button type="button" className="btn btn--primary btn--block" disabled={ocupado || !estado.config.claveConfigurada} onClick={iniciar}>Iniciar transmisión</button>}
          <a className="btn btn--ghost btn--block" href="https://studio.youtube.com/" target="_blank" rel="noreferrer">Abrir YouTube Studio ↗</a>
        </div>
        <dl className="paso-resumen transmision-config">
          <div><dt>Página</dt><dd>{estado.config.url}</dd></div>
          <div><dt>Calidad</dt><dd>{estado.config.salida} · {estado.config.fps} fps · {estado.config.bitrate}</dd></div>
          <div><dt>Destino</dt><dd>{estado.config.rtmp} · clave {estado.config.claveConfigurada ? "configurada" : "sin configurar"}</dd></div>
        </dl>
        {estado.registro?.length > 0 && <details className="transmision-registro"><summary>Registro técnico</summary><pre>{estado.registro.join("\n")}</pre></details>}
      </>}
      {!estado && !error && <p>Consultando el servicio…</p>}
    </section>
    <div className="admin-map-area transmision-vista">
      {estado?.alAire && captura
        ? <img src={urlCapturaTransmision(captura)} alt="Lo que se está transmitiendo ahora" />
        : <div className="admin-map-area__vacio">{estado?.activo ? "Preparando la transmisión: la vista previa aparece cuando sale al aire." : "La vista previa aparece cuando la transmisión está al aire."}</div>}
    </div>
  </div>;
}
