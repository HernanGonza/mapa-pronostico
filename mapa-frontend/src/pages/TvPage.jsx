import { useEffect, useMemo, useRef, useState } from "react";
import { getAvisosCortoPlazoVigentes, getAlertasMeteorologicasVigentes, getAlertasSmnPublicadas, getRotacionTv, urlArchivoTv } from "../api";
import { PANTALLAS_SISTEMA, armarRotacion, duracionDe } from "../lib/tvPantallas";
import { enDemo, conDemo, alCambiarDemo } from "../lib/demo";
import { estadoUrgente, tipoDe, configDe, CONFIG_PREDETERMINADA } from "../lib/tvUrgentes";
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
 *   Cuánto quedan fijos se elige en el panel (Pantalla TV, ver lib/tvUrgentes.js): por defecto
 *   15 minutos cada 60 desde que aparecen; el resto del tiempo (o siempre, si se eligió «sólo
 *   rotación») no cortan, pero siguen saliendo: cada uno vigente entra a la rotación como una
 *   pantalla más (su mapa y su cartel, DURACION_URGENTE), al principio de la vuelta. Si se
 *   superponen y alguno está fijo, se turnan a pantalla completa todos los vigentes.
 *
 * - Videos en la rotación: a pantalla completa, duran lo que dure el video y sin sonido
 *   (CON_SONIDO), para no pisar lo que se habla en la transmisión.
 * - Qué pantallas se ven, en qué orden y cuánto dura cada una se elige en el panel
 *   (Configuración → Pantalla TV; ver lib/tvPantallas.js): se relee cada CONSULTA_ROTACION y
 *   cambia sola, sin recargar. Ahí también se suman videos, imágenes y páginas de otros sitios.
 *
 * Para no gastar CPU en el servidor de transmisión, sólo quedan montadas la pantalla al aire y
 * la siguiente (que se carga oculta mientras tanto, así nunca se ve una recarga), más la
 * anterior durante el fundido. Se ocultan con opacity, no display:none: los mapas se rompen si
 * se cargan ocultos. El iframe oculto lleva data-pulso="no" y el mapa de focos apaga su
 * pulso (PointsMap). Cada embebido se actualiza solo cada minuto; la página entera se recarga
 * cada 8 h para aguantar 24/7, y también sola cuando se sube una versión nueva del sistema
 * (VERSION_NUEVA: si no, una /tv abierta seguiría con el código viejo hasta que alguien la refresque).
 */
const CONSULTA_ROTACION = 20_000;
const DURACION_URGENTE = 20_000;
const CONSULTA_URGENTES = 30_000;
const RECARGA_COMPLETA = 8 * 3600_000;
const VERSION_NUEVA = 2 * 60_000;
/** El script principal del build (/assets/index-<hash>.js): cambia con cada versión nueva. */
const scriptPrincipal = (html) => /\/assets\/index-[\w-]+\.js/.exec(html)?.[0] || null;
const FUNDIDO = 1500; // un poco más que la transición de .tv-pantalla (tv.css)
// En OBS el navegador deja reproducir con sonido; en Chrome normal un video con sonido no
// arranca solo (se reintenta sin sonido).
const CON_SONIDO = false;

const AR = "America/Argentina/Buenos_Aires";
const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: AR, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const diaHora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: AR, weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
/** Texto oscuro sobre colores claros (alerta amarilla), blanco sobre el resto. */
const textoSobre = (hex) => {
  const [r, g, b] = (String(hex).match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i) || [0, "0", "0", "0"]).slice(1).map((x) => parseInt(x, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? "#1d2a22" : "#ffffff";
};
const esAlerta = (m) => (m.zonas || []).some((z) => z.categoria && !["Verde", "Gris"].includes(z.categoria));

/** Lo urgente vigente, en el orden en que se muestra: primero los ACP, después las alertas. */
async function leerUrgentes() {
  const [acp, manuales, smn] = await Promise.all([
    getAvisosCortoPlazoVigentes().catch(() => []),
    getAlertasMeteorologicasVigentes().catch(() => []),
    getAlertasSmnPublicadas().catch(() => []),
  ]);
  return [
    // `desde`: cuándo empezó a verse (de ahí se cuenta cuánto queda fijo).
    ...acp.map((a) => ({ clave: `acp-${a.id}`, tipo: "acp", desde: a.publicadoEn, src: `/embed/avisos-corto-plazo?id=${a.id}`, etiqueta: "Aviso a muy corto plazo",
      titulo: a.titulo || "Aviso a muy corto plazo", texto: a.texto, pie: `Vigente hasta las ${hora(a.vigenteHasta)}`, color: a.color || "#8b3fc4" })), // el de la alerta en cuya vigencia cae
    ...(manuales.some((m) => m.fijada) ? manuales.filter((m) => m.fijada) : manuales).filter(esAlerta).map((m) => ({ clave: `manual-${m.id}`, tipo: "alerta", desde: m.visibleDesde || m.publicadoEn, src: `/embed/alertas-meteorologicas?id=manual-${m.id}`, etiqueta: "Alerta meteorológica",
      titulo: m.periodo, texto: "Mirá el nivel de alerta de tu departamento en el mapa.", pie: `Vigente hasta el ${diaHora(m.vigenteHasta)}`, color: "#f67f15" })),
    // Con una alerta manual fijada a mano en el panel, se ve sólo ésa (como en el embebido).
    ...(manuales.some((m) => m.fijada) ? [] : smn).map((a) => ({ clave: `smn-${a.id}`, tipo: "alerta", desde: [a.publicadoEn, a.inicio].filter((t) => t && Date.parse(t) <= Date.now()).sort().at(-1) || a.publicadoEn, src: `/embed/alertas-meteorologicas?id=smn-${a.id}`, etiqueta: `Alerta ${a.categoria} · SMN`,
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

/** El mapa que dejó el embebido en window.__map (una página de otro sitio no deja leerlo). */
const mapaDe = (f) => { try { return f?.contentWindow?.__map; } catch { return null; } };

/** Acerca despacio la cámara de los mapas de la pantalla (mismo origen: el embebido deja su mapa en window.__map). */
function moverMapas(iframes, duracion) {
  for (const f of iframes) {
    const mapa = mapaDe(f);
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
    const t2 = setTimeout(() => moverMapas(iframes.current.filter((f) => !mapaDe(f)?.__tvInicio), duracion - 3000), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [visible, duracion]);
  return <div className={`tv-pantalla${visible ? " tv-pantalla--visible" : ""}`} aria-hidden={!visible}>
    {paginas.map((p, i) => {
      const k = p.escala || 1;
      return <div key={p.src} className="tv-pantalla__marco" style={{ width: p.ancho || "100%" }}>
        {/* Otro sitio: sin permiso para navegar /tv ni abrir ventanas. */}
        <iframe ref={(el) => { iframes.current[i] = el; }} data-pulso={visible ? undefined : "no"} src={p.externa ? p.src : enDemo() ? conDemo(p.src) : p.src} title={p.src} tabIndex={-1}
          sandbox={p.externa ? "allow-scripts allow-same-origin" : undefined} allow={p.externa ? "autoplay" : undefined} referrerPolicy={p.externa ? "no-referrer" : undefined}
          style={k === 1 ? undefined : { width: `${100 / k}%`, height: `${100 / k}%`, transform: `scale(${k})` }} />
      </div>;
    })}
  </div>;
}

/** Imagen subida desde el panel, en el área de los mapas. */
function ImagenPantalla({ src, titulo, visible }) {
  return <div className={`tv-pantalla tv-pantalla--imagen${visible ? " tv-pantalla--visible" : ""}`} aria-hidden={!visible}>
    <img src={src} alt={titulo} />
  </div>;
}

/** Video a pantalla completa: arranca de cero cada vez que sale al aire (`vuelta`: también si es el único) y avisa al terminar. */
function VideoPantalla({ src, visible, vuelta, cargar, onTermino }) {
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
  }, [visible, vuelta]);
  return <video ref={video} className={`tv-video${visible ? " tv-video--visible" : ""}`} src={src} preload={cargar ? "auto" : "none"} playsInline muted
    onEnded={() => visible && termino.current()} onError={() => visible && termino.current()} aria-hidden={!visible} />;
}

export default function TvPage() {
  const [rotacion, setRotacion] = useState(() => armarRotacion(null));
  const [actualId, setActualId] = useState(null);
  const [vuelta, setVuelta] = useState(0); // cuenta cada pase, aunque sea la misma pantalla (una sola activa)
  const [todosUrgentes, setUrgentes] = useState([]);
  // Cuánto quedan fijos los ACP / las alertas (panel → Pantalla TV). Por defecto, el ciclo de 15 cada 60.
  const [cortes, setCortes] = useState({ acp: CONFIG_PREDETERMINADA, alertas: CONFIG_PREDETERMINADA });
  // Cuando alguno pasa de fijo a la rotación (o al revés), se vuelve a calcular.
  const [reloj, setReloj] = useState(() => Date.now());
  const corta = (u) => estadoUrgente(u.desde, cortes[tipoDe(u)], reloj).fijo;
  useEffect(() => {
    const cambios = todosUrgentes.map((u) => estadoUrgente(u.desde, cortes[tipoDe(u)], reloj).hasta).filter((t) => t != null && t > Date.now());
    if (!cambios.length) return undefined;
    const t = setTimeout(() => setReloj(Date.now()), Math.min(...cambios) - Date.now() + 500);
    return () => clearTimeout(t);
  }, [todosUrgentes, cortes, reloj]);
  // Si alguno está fijo, la rotación se detiene: se turnan a pantalla completa TODOS los vigentes
  // (los fijos y los que estaban en su parte de rotación), así ninguno deja de verse mientras se superponen.
  const hayFijo = todosUrgentes.some(corta);
  const urgentes = useMemo(() => (hayFijo ? todosUrgentes : []), [todosUrgentes, hayFijo]);
  // Los que no cortan: van en la rotación, cada uno como una pantalla más.
  const enRotacion = useMemo(() => (hayFijo ? [] : todosUrgentes)
    .map((u) => ({ id: `urgente-${u.clave}`, tipo: "urgente", titulo: u.etiqueta, duracion: DURACION_URGENTE / 1000, urgente: u })), [todosUrgentes, cortes, reloj]); // eslint-disable-line react-hooks/exhaustive-deps
  const [indiceUrgente, setIndiceUrgente] = useState(0);

  useEffect(() => {
    document.title = "Alerta Temprana · Misiones — Transmisión";
    const recarga = setTimeout(() => window.location.reload(), RECARGA_COMPLETA);
    // Versión nueva (deploy): se compara el script de esta página con el del index.html actual.
    // En desarrollo (Vite sin build) no hay /assets/index-…: no se hace nada.
    const propio = scriptPrincipal(document.documentElement.outerHTML);
    const version = propio && setInterval(() => {
      fetch("/", { cache: "no-store" }).then((r) => (r.ok ? r.text() : null)).then((html) => {
        const actual = html && scriptPrincipal(html);
        if (actual && actual !== propio) window.location.reload();
      }).catch(() => {}); // sin red: se reintenta en la próxima
    }, VERSION_NUEVA);
    return () => { clearTimeout(recarga); if (version) clearInterval(version); };
  }, []);

  useEffect(() => {
    let cancelado = false;
    const consultar = () => leerUrgentes().then((u) => { if (!cancelado) setUrgentes(u); });
    consultar();
    const t = setInterval(consultar, CONSULTA_URGENTES);
    const dejar = alCambiarDemo(consultar); // modo demostración: al prender/apagar, se ve en el momento
    return () => { cancelado = true; clearInterval(t); dejar(); };
  }, []);

  // Lo que se eligió en el panel. Si no responde, sigue con lo último que leyó.
  useEffect(() => {
    let cancelado = false;
    let ultima = "";
    const leer = () => getRotacionTv().then((r) => {
      if (!cancelado && r.urgentes) {
        const nuevos = { acp: configDe(r.urgentes.acp), alertas: configDe(r.urgentes.alertas) };
        setCortes((c) => (JSON.stringify(c) === JSON.stringify(nuevos) ? c : nuevos));
      }
      const texto = JSON.stringify(r.pantallas);
      if (cancelado || texto === ultima) return;
      ultima = texto;
      setRotacion(armarRotacion(r.pantallas));
    }).catch(() => {});
    leer();
    const t = setInterval(leer, CONSULTA_ROTACION);
    return () => { cancelado = true; clearInterval(t); };
  }, []);

  const activas = useMemo(() => {
    const a = rotacion.filter((p) => p.activo);
    return [...enRotacion, ...(a.length ? a : [PANTALLAS_SISTEMA.find((p) => p.id === "pronostico")])]; // todo apagado: al menos el pronóstico
  }, [rotacion, enRotacion]);
  // Si la pantalla que estaba al aire se apagó o se quitó, sigue con la primera.
  const actual = activas.find((p) => p.id === actualId) || activas[0];
  const posicion = activas.indexOf(actual);
  const proxima = activas[(posicion + 1) % activas.length];
  const proximaRef = useRef(proxima);
  proximaRef.current = proxima;

  // La que acaba de salir sigue montada hasta que termina el fundido.
  const [saliendoId, setSaliendoId] = useState(null);
  const previoId = useRef(actual.id);
  useEffect(() => {
    if (previoId.current === actual.id) return undefined;
    setSaliendoId(previoId.current);
    previoId.current = actual.id;
    const t = setTimeout(() => setSaliendoId(null), FUNDIDO);
    return () => clearTimeout(t);
  }, [actual.id]);
  const montada = (p) => p === actual || p === proxima || p.id === saliendoId;

  const hayUrgente = urgentes.length > 0;
  const siguiente = () => { setActualId(proximaRef.current.id); setVuelta((v) => v + 1); };
  // Cada pantalla tiene su tiempo (el del panel); los videos, lo que duren (avisan al terminar).
  useEffect(() => {
    if (hayUrgente || actual.tipo === "video") return undefined;
    const t = setTimeout(siguiente, duracionDe(actual));
    return () => clearTimeout(t);
  }, [hayUrgente, actual.id, actual.tipo, actual.duracion, vuelta]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (urgentes.length < 2) return undefined;
    const t = setInterval(() => setIndiceUrgente((i) => i + 1), DURACION_URGENTE);
    return () => clearInterval(t);
  }, [urgentes.length]);

  const urgente = hayUrgente ? urgentes[indiceUrgente % urgentes.length] : null;
  // Lo que se muestra con cartel y color de alerta: el que corta, o el de la rotación que está al aire.
  const cartel = urgente || (actual.tipo === "urgente" ? actual.urgente : null);
  return <div className={`tv${cartel ? " tv--urgente" : ""}`} style={cartel ? { "--tv-urgente": cartel.color, "--tv-urgente-texto": textoSobre(cartel.color) } : undefined}>
    <header className="tv-cabecera">
      <img src="/brand/ecologia-flor.png" alt="" />
      <span className="tv-marca"><b>Alerta Temprana</b>Ministerio de Ecología · Misiones</span>
      <h1>{cartel ? cartel.etiqueta : actual.titulo}</h1>
      <Reloj />
    </header>

    <main className="tv-contenido">
      {activas.map((p) => {
        if (!montada(p)) return null;
        const visible = !urgente && p === actual;
        if (p.tipo === "embebido") return <Pantalla key={p.id} paginas={p.paginas} visible={visible} duracion={duracionDe(p)} />;
        if (p.tipo === "imagen") return <ImagenPantalla key={p.id} src={urlArchivoTv(p.src)} titulo={p.titulo} visible={visible} />;
        if (p.tipo === "urgente") return <Pantalla key={p.id} paginas={[{ src: p.urgente.src }]} visible={visible} duracion={duracionDe(p)} />;
        if (p.tipo === "pagina") return <Pantalla key={p.id} paginas={[{ src: p.src, externa: true }]} visible={visible} duracion={duracionDe(p)} />;
        return null;
      })}
      {/* Lo urgente vigente (suele ser uno o dos): montado mientras siga vigente, para no recargarlo al rotar. */}
      {urgentes.map((u) => <Pantalla key={u.src} paginas={[{ src: u.src }]} visible={urgente?.src === u.src} duracion={DURACION_URGENTE} />)}
      {cartel && <aside className="tv-urgente" role={urgente ? "alert" : undefined}>
        <span className="tv-urgente__etiqueta">⚠ {cartel.etiqueta}</span>
        <h2>{cartel.titulo}</h2>
        {cartel.texto && <p>{cartel.texto}</p>}
        <strong>{cartel.pie}</strong>
        {urgente && urgentes.length > 1 && <small>{(indiceUrgente % urgentes.length) + 1} de {urgentes.length}</small>}
      </aside>}
    </main>

    {activas.filter((p) => p.tipo === "video").map((p) => <VideoPantalla key={p.id} src={urlArchivoTv(p.src)} visible={!urgente && p === actual} vuelta={vuelta}
      cargar={p === actual || p === proxima || !p.propia} onTermino={siguiente} />)}
    <SelloDemo />
    <footer className="tv-pie">
      {!urgente && actual.tipo !== "video" && <div className="tv-progreso" key={`${actual.id}-${vuelta}`}><i style={{ animationDuration: `${duracionDe(actual)}ms` }} /></div>}
      <span>Emergencias <b>911</b> · Defensa Civil <b>103</b></span>
      <span>alertatemprana.misiones.gob.ar</span>
    </footer>
  </div>;
}
