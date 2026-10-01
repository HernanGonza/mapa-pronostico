import { useEffect, useRef, useState } from "react";
import { getAvisosCortoPlazoVigentes, getAlertasMeteorologicasVigentes, getAlertasSmnPublicadas } from "../api";
import { enDemo, conDemo, alCambiarDemo } from "../lib/demo";
import SelloDemo from "../components/SelloDemo";
import "../tv.css";

/**
 * Pantalla para transmitir (OBS → "Fuente de navegador" a 1920×1080, en /tv).
 *
 * - Rotación continua por los mapas públicos (los mismos embebidos del sitio), con un
 *   fundido; mientras un mapa está al aire, su cámara se acerca despacio (así la imagen
 *   nunca queda quieta y los carteles del mapa no se recortan).
 * - Si hay un aviso a muy corto plazo PUBLICADO o una alerta meteorológica vigente
 *   (la manual que no sea toda verde, o una del SMN publicada), corta la rotación y lo
 *   muestra a pantalla completa, CADA UNO POR SEPARADO (su propio mapa, con ?id= en el
 *   embebido); si hay varios, rotan entre sí. Al vencer, vuelve sola a la rotación.
 *
 * - Videos institucionales en la rotación (public/videos/): a pantalla completa, duran lo que
 *   dure el video y sin sonido (CON_SONIDO), para no pisar lo que se habla en la transmisión.
 *
 * Todos los iframes quedan montados y sólo cambia cuál se ve (opacity, no display:none:
 * los mapas se rompen si se cargan ocultos), así nunca se ve una recarga. Cada embebido
 * ya se actualiza solo cada minuto; la página entera se recarga cada 6 h para aguantar 24/7.
 */
const DURACION_ROTACION = 25_000;
const DURACION_URGENTE = 20_000;
const CONSULTA_URGENTES = 30_000;
const RECARGA_COMPLETA = 6 * 3600_000;
// En OBS el navegador deja reproducir con sonido; en Chrome normal un video con sonido no
// arranca solo (se reintenta sin sonido).
const CON_SONIDO = false;

// Pantallas de la rotación: una o dos páginas embebidas (lado a lado) por pantalla, o un video.
const ROTACION = [
  { id: "marca", titulo: "Misiones", video: "/videos/marca-misiones.mp4" },
  { id: "pronostico", titulo: "Previsión del tiempo", paginas: [{ src: "/embed" }] },
  // Pensado para un iframe chico: se agranda para que llene la pantalla.
  { id: "extendido", titulo: "Pronóstico de 3 días", paginas: [{ src: "/embed/pronostico-3-dias", escala: 1.6 }] },
  { id: "riesgo", titulo: "Riesgo de incendios forestales", paginas: [{ src: "/embed/riesgo-incendios" }] },
  { id: "cuencas", titulo: "Monitor de cuencas", paginas: [{ src: "/embed/cuencas-mapa", ancho: "42%" }, { src: "/embed/cuencas-tarjetas", ancho: "58%", escala: 1.3 }] },
  { id: "focos", titulo: "Focos de calor", paginas: [{ src: "/embed/alertas-incendios" }] },
  { id: "loop", titulo: "Ministerio de Ecología", video: "/videos/loop-ecologia.mp4" },
];

const AR = "America/Argentina/Buenos_Aires";
const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: AR, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const diaHora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: AR, weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const esAlerta = (m) => (m.zonas || []).some((z) => z.categoria && !["Verde", "Gris"].includes(z.categoria));

/** Lo urgente vigente, en el orden en que se muestra: primero los ACP, después las alertas. */
async function leerUrgentes() {
  const [acp, manuales, smn] = await Promise.all([
    getAvisosCortoPlazoVigentes().catch(() => []),
    getAlertasMeteorologicasVigentes().catch(() => []),
    getAlertasSmnPublicadas().catch(() => []),
  ]);
  return [
    ...acp.map((a) => ({ clave: `acp-${a.id}`, tipo: "acp", src: `/embed/avisos-corto-plazo?id=${a.id}`, etiqueta: "Aviso a muy corto plazo",
      titulo: a.titulo || "Aviso a muy corto plazo", texto: a.texto, pie: `Vigente hasta las ${hora(a.vigenteHasta)}`, color: "#8b3fc4" })),
    ...manuales.filter(esAlerta).map((m) => ({ clave: `manual-${m.id}`, tipo: "alerta", src: `/embed/alertas-meteorologicas?id=manual-${m.id}`, etiqueta: "Alerta meteorológica",
      titulo: m.periodo, texto: "Mirá el nivel de alerta de tu departamento en el mapa.", pie: `Vigente hasta el ${diaHora(m.vigenteHasta)}`, color: "#f67f15" })),
    ...smn.map((a) => ({ clave: `smn-${a.id}`, tipo: "alerta", src: `/embed/alertas-meteorologicas?id=smn-${a.id}`, etiqueta: `Alerta ${a.categoria} · SMN`,
      titulo: a.titulo, texto: a.descripcion, pie: `Hasta el ${diaHora(a.fin)}`, color: a.color || "#f67f15" })),
  ];
}

function Reloj() {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setAhora(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span className="tv-reloj">
    <b>{ahora.toLocaleTimeString("es-AR", { timeZone: AR, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</b>
    {mayuscula(ahora.toLocaleDateString("es-AR", { timeZone: AR, weekday: "long", day: "numeric", month: "long" }))}
  </span>;
}

/** Acerca despacio la cámara de los mapas de la pantalla (mismo origen: el embebido deja su mapa en window.__map). */
function moverMapas(iframes, duracion) {
  for (const f of iframes) {
    const mapa = f?.contentWindow?.__map;
    if (!mapa?.isStyleLoaded?.()) continue;
    if (!mapa.__tvInicio) mapa.__tvInicio = { center: mapa.getCenter(), zoom: mapa.getZoom() };
    mapa.jumpTo(mapa.__tvInicio);
    mapa.easeTo({ zoom: mapa.__tvInicio.zoom + 0.45, duration: duracion, easing: (t) => t });
  }
}

function Pantalla({ paginas, visible, duracion }) {
  const iframes = useRef([]);
  useEffect(() => {
    if (!visible) return undefined;
    // Un respiro para el fundido; si el mapa todavía estaba cargando, se reintenta.
    const t1 = setTimeout(() => moverMapas(iframes.current, duracion), 300);
    const t2 = setTimeout(() => moverMapas(iframes.current.filter((f) => !f?.contentWindow?.__map?.__tvInicio), duracion - 3000), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [visible, duracion]);
  return <div className={`tv-pantalla${visible ? " tv-pantalla--visible" : ""}`} aria-hidden={!visible}>
    {paginas.map((p, i) => {
      const k = p.escala || 1;
      return <div key={p.src} className="tv-pantalla__marco" style={{ width: p.ancho || "100%" }}>
        <iframe ref={(el) => { iframes.current[i] = el; }} src={enDemo() ? conDemo(p.src) : p.src} title={p.src} tabIndex={-1}
          style={k === 1 ? undefined : { width: `${100 / k}%`, height: `${100 / k}%`, transform: `scale(${k})` }} />
      </div>;
    })}
  </div>;
}

/** Video a pantalla completa: arranca de cero cada vez que sale al aire y avisa al terminar. */
function VideoPantalla({ src, visible, onTermino }) {
  const video = useRef(null);
  const termino = useRef(onTermino);
  termino.current = onTermino;
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (!visible) { v.pause(); return; }
    v.currentTime = 0;
    v.muted = !CON_SONIDO;
    v.play().catch(() => { v.muted = true; return v.play(); }).catch(() => termino.current());
  }, [visible]);
  return <video ref={video} className={`tv-video${visible ? " tv-video--visible" : ""}`} src={src} preload="auto" playsInline muted
    onEnded={() => visible && termino.current()} onError={() => visible && termino.current()} aria-hidden={!visible} />;
}

export default function TvPage() {
  const [indice, setIndice] = useState(0);
  const [urgentes, setUrgentes] = useState([]);
  const [indiceUrgente, setIndiceUrgente] = useState(0);
  // Embebidos urgentes ya cargados: quedan montados para no recargarlos al volver a mostrarlos.
  const montados = useRef(new Set());

  useEffect(() => {
    document.title = "Alerta Temprana · Misiones — Transmisión";
    const recarga = setTimeout(() => window.location.reload(), RECARGA_COMPLETA);
    return () => clearTimeout(recarga);
  }, []);

  useEffect(() => {
    let cancelado = false;
    const consultar = () => leerUrgentes().then((u) => { if (!cancelado) setUrgentes(u); });
    consultar();
    const t = setInterval(consultar, CONSULTA_URGENTES);
    const dejar = alCambiarDemo(consultar); // modo demostración: al prender/apagar, se ve en el momento
    return () => { cancelado = true; clearInterval(t); dejar(); };
  }, []);

  const hayUrgente = urgentes.length > 0;
  const siguiente = () => setIndice((i) => (i + 1) % ROTACION.length);
  // Cada pantalla tiene su tiempo: los mapas DURACION_ROTACION; los videos, lo que duren (avisan al terminar).
  useEffect(() => {
    if (hayUrgente || ROTACION[indice].video) return undefined;
    const t = setTimeout(siguiente, DURACION_ROTACION);
    return () => clearTimeout(t);
  }, [hayUrgente, indice]);
  useEffect(() => {
    if (urgentes.length < 2) return undefined;
    const t = setInterval(() => setIndiceUrgente((i) => i + 1), DURACION_URGENTE);
    return () => clearInterval(t);
  }, [urgentes.length]);

  const urgente = hayUrgente ? urgentes[indiceUrgente % urgentes.length] : null;
  if (urgente) montados.current.add(urgente.src);
  const actual = ROTACION[indice];

  return <div className={`tv${urgente ? " tv--urgente" : ""}`} style={urgente ? { "--tv-urgente": urgente.color } : undefined}>
    <header className="tv-cabecera">
      <img src="/brand/ecologia-flor.png" alt="" />
      <span className="tv-marca"><b>Alerta Temprana</b>Ministerio de Ecología · Misiones</span>
      <h1>{urgente ? urgente.etiqueta : actual.titulo}</h1>
      <Reloj />
    </header>

    <main className="tv-contenido">
      {ROTACION.filter((p) => p.paginas).map((p) => <Pantalla key={p.id} paginas={p.paginas} visible={!urgente && p === actual} duracion={DURACION_ROTACION} />)}
      {[...montados.current].map((src) => <Pantalla key={src} paginas={[{ src }]} visible={urgente?.src === src} duracion={DURACION_URGENTE} />)}
      {urgente && <aside className="tv-urgente" role="alert">
        <span className="tv-urgente__etiqueta">⚠ {urgente.etiqueta}</span>
        <h2>{urgente.titulo}</h2>
        {urgente.texto && <p>{urgente.texto}</p>}
        <strong>{urgente.pie}</strong>
        {urgentes.length > 1 && <small>{(indiceUrgente % urgentes.length) + 1} de {urgentes.length}</small>}
      </aside>}
    </main>

    {ROTACION.filter((p) => p.video).map((p) => <VideoPantalla key={p.id} src={p.video} visible={!urgente && p === actual} onTermino={siguiente} />)}
    <SelloDemo />
    <footer className="tv-pie">
      {!urgente && !actual.video && <div className="tv-progreso" key={indice}><i style={{ animationDuration: `${DURACION_ROTACION}ms` }} /></div>}
      <span>Emergencias <b>911</b> · Defensa Civil <b>103</b></span>
      <span>alertatemprana.misiones.gob.ar</span>
    </footer>
  </div>;
}
