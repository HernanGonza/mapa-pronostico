/**
 * Servicio de transmisión en vivo (YouTube, Facebook y cualquier destino RTMP), sin OBS
 * ni computadora aparte.
 *
 *   Xvfb      pantalla virtual del tamaño de la salida (TRANSMISION_SALIDA, 1280x720)
 *   Chromium  en modo kiosco, abre la página /tv del sistema en esa pantalla. Con un factor de
 *             escala (ancho de salida / 1920) la página sigue midiendo 1920 px de ancho y se ve
 *             igual, pero Chromium dibuja sólo los píxeles que se transmiten (720p: 44 % de 1080p).
 *   ffmpeg    captura la pantalla (x11grab) tal cual, sin reescalar, le suma una pista de audio en silencio
 *             (las plataformas exigen audio) y la manda por RTMP a los destinos elegidos.
 *             Con varios destinos codifica UNA vez y reparte (muxer tee): si uno se corta,
 *             los demás siguen y al minuto se reconecta todo.
 *
 * Destinos (en el .env; sólo aparecen los que tienen clave):
 *   YOUTUBE_STREAM_KEY  (+ YOUTUBE_RTMP_URL)
 *   Facebook AUTOMÁTICO: con META_PAGE_ID + META_PAGE_ACCESS_TOKEN (los de publicar placas)
 *             el vivo se crea por la API y sale al aire solo (sin tocar «Transmitir en vivo»);
 *             como Facebook corta cada vivo a las 8 h, a las FACEBOOK_HORAS_POR_VIVO (7,75)
 *             se cierra y se abre uno nuevo (corte de ~30 s). Desactivable: FACEBOOK_AUTOMATICO=false
 *   FACEBOOK_STREAM_KEY (+ FACEBOOK_RTMP_URL)   modo manual: clave de Live Producer
 *   TRANSMISION_OTROS   "Nombre|rtmp://servidor/app/clave;Otro|rtmps://…"  (Vimeo, Twitch, propio…)
 *
 * Este proceso los arranca, los vigila (si alguno se cae, reinicia todo con espera
 * creciente) y expone un control HTTP SOLO en la red interna de docker (no publica
 * puertos): el backend lo usa desde el panel (Configuración → Transmisión).
 *   GET  /estado       { activo, alAire, desde, error, reinicios, destinos, config, registro }
 *   POST /iniciar      { destinos: ["youtube", "facebook", …] }      POST /detener
 *   GET  /captura.jpg  lo que se está mostrando ahora (vista previa)
 * Todos piden el encabezado `x-token: TRANSMISION_TOKEN`.
 *
 * Si estaba transmitiendo y el contenedor se reinicia (reinicio del servidor), retoma
 * solo, a los mismos destinos: se guarda en /data/estado.json.
 */
import http from "node:http";
import fs from "node:fs";
import { spawn, execFile } from "node:child_process";

const env = (k, def = "") => (process.env[k] || def).trim();
const sinBarra = (u) => u.replace(/\/+$/, "");
const slug = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "destino";

const META = { pagina: env("META_PAGE_ID"), token: env("META_PAGE_ACCESS_TOKEN"), version: env("META_GRAPH_VERSION", "v25.0"), base: sinBarra(env("META_GRAPH_BASE", "https://graph.facebook.com")) /* sólo para pruebas */ };
const FACEBOOK_AUTOMATICO = !!(META.pagina && META.token) && env("FACEBOOK_AUTOMATICO", "true") !== "false";
const FACEBOOK_HORAS = Number(env("FACEBOOK_HORAS_POR_VIVO", "7.75")) || 7.75;

/** Los destinos que tienen clave cargada: [{ id, nombre, servidor, clave, url }]. El de Facebook
 * automático no tiene URL fija: la da la API al crear cada vivo (ver urlDe). */
function leerDestinos() {
  const lista = [];
  if (env("YOUTUBE_STREAM_KEY")) lista.push({ id: "youtube", nombre: "YouTube", servidor: sinBarra(env("YOUTUBE_RTMP_URL", "rtmp://a.rtmp.youtube.com/live2")), clave: env("YOUTUBE_STREAM_KEY") });
  if (FACEBOOK_AUTOMATICO) lista.push({ id: "facebook", nombre: "Facebook", servidor: "API de Facebook (sale al aire solo)", clave: "", automatico: true });
  else if (env("FACEBOOK_STREAM_KEY")) lista.push({ id: "facebook", nombre: "Facebook", servidor: sinBarra(env("FACEBOOK_RTMP_URL", "rtmps://live-api-s.facebook.com:443/rtmp")), clave: env("FACEBOOK_STREAM_KEY") });
  for (const item of env("TRANSMISION_OTROS").split(";").map((t) => t.trim()).filter(Boolean)) {
    const [nombre, url] = item.includes("|") ? item.split("|").map((t) => t.trim()) : ["Otro", item];
    if (!/^rtmps?:\/\//.test(url || "")) continue;
    // La "clave" de un destino genérico es lo que va después del último "/" (y cualquier ?query).
    const corte = url.lastIndexOf("/");
    let id = slug(nombre); while (lista.some((d) => d.id === id)) id += "-2";
    lista.push({ id, nombre, servidor: url.slice(0, corte), clave: url.slice(corte + 1) });
  }
  return lista.map((d) => (d.automatico ? d : { ...d, url: `${d.servidor}/${d.clave}` }));
}
const DESTINOS = leerDestinos();

const CONFIG = {
  url: env("TRANSMISION_URL", "http://frontend/tv"),
  salida: env("TRANSMISION_SALIDA", "1280x720"), // también el tamaño de la pantalla virtual
  fps: Number(env("TRANSMISION_FPS", "25")) || 25,
  bitrate: env("TRANSMISION_BITRATE", "3000k"),
  espera: Number(env("TRANSMISION_ESPERA_CARGA", "20")) || 20, // s para que /tv cargue antes de salir al aire
};
const TOKEN = env("TRANSMISION_TOKEN");
const PUERTO = Number(env("TRANSMISION_PUERTO", "8090"));
const DISPLAY = ":99";
const ARCHIVO_ESTADO = "/data/estado.json";
const BIN = { xvfb: env("BIN_XVFB", "Xvfb"), chromium: env("BIN_CHROMIUM", "chromium"), ffmpeg: env("BIN_FFMPEG", "ffmpeg") };

const estado = { activo: false, alAire: false, desde: null, error: null, reinicios: 0, destinos: [] };
const procesos = {};
const registro = [];
let generacion = 0; // cada arranque tiene su número: un proceso viejo que muere no dispara otro reinicio
let temporizadorReinicio = null;

/** Nunca mostrar claves ni tokens (ffmpeg imprime las URLs de salida). */
const SECRETOS = [...DESTINOS.map((d) => d.clave), META.token].filter((c) => c && c.length >= 4);
const tapar = (texto) => SECRETOS.reduce((t, c) => t.split(c).join("••••"), texto);

// --- Facebook automático: el vivo se crea y se cierra por la Graph API -------------------------
let vivoFacebook = null; // { id, url, creado }
let temporizadorFacebook = null;
let renovando = false; // durante la renovación, que se cierre ffmpeg es a propósito

async function graphFacebook(ruta, params) {
  const res = await fetch(`${META.base}/${META.version}/${ruta}`, {
    method: "POST", body: new URLSearchParams({ ...params, access_token: META.token }), signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    const permiso = e.code === 200 || /permission|publish_video/i.test(e.message || "");
    throw new Error(permiso
      ? "Facebook no deja crear el vivo: al token de la página le falta el permiso publish_video (regenerá META_PAGE_ACCESS_TOKEN agregándolo; ver docs/transmision.md)."
      : `Facebook rechazó el vivo: ${e.message || res.status}`);
  }
  return json;
}

/** Crea un vivo en la página que sale al aire en cuanto llega la señal. */
async function crearVivoFacebook() {
  const titulo = env("TRANSMISION_TITULO", "Alerta Temprana Misiones · En vivo");
  const r = await graphFacebook(`${META.pagina}/live_videos`, {
    status: "LIVE_NOW", title: titulo,
    description: env("TRANSMISION_DESCRIPCION", "Pronóstico, alertas y avisos meteorológicos para Misiones, en vivo. Dirección General de Alerta Temprana · Ministerio de Ecología y RNR."),
  });
  const url = r.secure_stream_url || r.stream_url;
  if (!r.id || !url) throw new Error("Facebook no devolvió la dirección para transmitir.");
  SECRETOS.push(url.slice(url.lastIndexOf("/") + 1));
  vivoFacebook = { id: r.id, url, creado: Date.now() };
  anotar("facebook", `vivo creado (id ${r.id}); se renueva solo cada ${FACEBOOK_HORAS} h`);
  clearTimeout(temporizadorFacebook);
  temporizadorFacebook = setTimeout(renovarVivoFacebook, FACEBOOK_HORAS * 3600_000);
}

async function terminarVivoFacebook() {
  clearTimeout(temporizadorFacebook);
  const vivo = vivoFacebook;
  vivoFacebook = null;
  if (!vivo) return;
  try { await graphFacebook(vivo.id, { end_live_video: "true" }); anotar("facebook", `vivo ${vivo.id} cerrado`); }
  catch (e) { anotar("facebook", `no se pudo cerrar el vivo ${vivo.id}: ${e.message}`); }
}

/**
 * Facebook corta cada vivo a las 8 h: antes de eso se cierra éste y se abre uno nuevo.
 * Sólo se reinicia el envío (ffmpeg); la pantalla y Chromium siguen, así el corte dura segundos.
 */
async function renovarVivoFacebook() {
  if (!estado.activo || !estado.destinos.includes("facebook")) return;
  anotar("facebook", "Facebook corta los vivos a las 8 h: cierro éste y abro uno nuevo");
  const gen = generacion;
  renovando = true;
  try {
    try { procesos.ffmpeg?.kill("SIGTERM"); } catch { /* ya terminó */ }
    await esperar(2000);
    await terminarVivoFacebook();
    await crearVivoFacebook();
    if (gen === generacion && estado.activo) lanzar("ffmpeg", BIN.ffmpeg, argsFfmpeg(), gen);
  } catch (e) {
    renovando = false;
    if (gen === generacion && estado.activo) reiniciar(e.message); // reintenta desde cero
  } finally {
    renovando = false;
  }
}

/** URL de salida de un destino (la de Facebook automático, la del vivo actual). */
const urlDe = (d) => (d.automatico ? vivoFacebook?.url : d.url);
function anotar(origen, texto) {
  for (const linea of tapar(String(texto)).split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean)) {
    registro.push(`${new Date().toISOString().slice(11, 19)} [${origen}] ${linea}`.slice(0, 400));
  }
  registro.splice(0, Math.max(0, registro.length - 150));
}

function guardarActivo(activo, destinos = []) {
  try { fs.mkdirSync("/data", { recursive: true }); fs.writeFileSync(ARCHIVO_ESTADO, JSON.stringify({ activo, destinos })); } catch (e) { anotar("control", `no se pudo guardar el estado: ${e.message}`); }
}
function leerGuardado() {
  try { return JSON.parse(fs.readFileSync(ARCHIVO_ESTADO, "utf8")); } catch { return { activo: false, destinos: [] }; }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function lanzar(nombre, cmd, args, gen) {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DISPLAY } });
  procesos[nombre] = p;
  p.stdout.on("data", (d) => anotar(nombre, d));
  p.stderr.on("data", (d) => {
    anotar(nombre, d);
    // Con varios destinos (tee + onfail=ignore), uno caído no corta a los demás: se reconecta todo al minuto.
    if (nombre === "ffmpeg" && /Slave muxer #?\d+ failed/i.test(String(d))) reconectarEnUnMinuto(gen);
  });
  p.on("error", (e) => anotar(nombre, `no arrancó: ${e.message}`));
  p.on("exit", (codigo, senal) => {
    if (procesos[nombre] === p) delete procesos[nombre];
    if (nombre === "ffmpeg" && renovando) return; // lo cerró la renovación del vivo de Facebook
    if (gen === generacion && estado.activo) reiniciar(`${nombre} se cerró (${senal || `código ${codigo}`})`);
  });
  return p;
}

function argsChromium() {
  const [w, h] = CONFIG.salida.split("x");
  // /tv está pensada a 1920 px de ancho: con esta escala se ve idéntica en una ventana más chica.
  const escala = (Number(w) / 1920).toFixed(6);
  return [
    "--no-sandbox", "--kiosk", "--start-fullscreen", `--window-size=${w},${h}`, "--window-position=0,0",
    `--force-device-scale-factor=${escala}`, "--noerrdialogs", "--disable-infobars", "--disable-session-crashed-bubble",
    // Sin el cartel del traductor (además está la política TranslateEnabled=false del Dockerfile).
    "--lang=es-AR", "--accept-lang=es-AR,es", "--disable-features=Translate,TranslateUI,MediaRouter",
    "--hide-scrollbars", "--no-first-run", "--disable-dev-shm-usage", "--disable-extensions",
    "--disable-background-networking", "--disable-component-update", "--mute-audio",
    "--autoplay-policy=no-user-gesture-required",
    // Sin GPU: composición por software (más barata que pasarla por SwiftShader) y los mapas
    // (WebGL) se dibujan con SwiftShader.
    "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--user-data-dir=/tmp/perfil-chromium", CONFIG.url,
  ];
}

let temporizadorReconexion = null;
function reconectarEnUnMinuto(gen) {
  if (temporizadorReconexion) return;
  anotar("control", "se cortó la conexión con un destino; los demás siguen. Reconecto en 1 minuto.");
  temporizadorReconexion = setTimeout(() => {
    temporizadorReconexion = null;
    if (gen === generacion && estado.activo) reiniciar("reconexión con un destino que se había cortado");
  }, 60_000);
}

/** Salida de ffmpeg: un destino → flv directo; varios → tee (una sola codificación, cada uno tolera fallas). */
function argsSalida() {
  const elegidos = DESTINOS.filter((d) => estado.destinos.includes(d.id) && urlDe(d));
  if (elegidos.length === 1) return ["-f", "flv", urlDe(elegidos[0])];
  return ["-map", "0:v", "-map", "1:a", "-f", "tee", elegidos.map((d) => `[f=flv:onfail=ignore]${urlDe(d).replace(/[|\\[\]]/g, "\\$&")}`).join("|")];
}

function argsFfmpeg() {
  const gop = String(CONFIG.fps * 2);
  return [
    "-hide_banner", "-loglevel", "warning",
    "-thread_queue_size", "512", "-f", "x11grab", "-draw_mouse", "0", "-video_size", CONFIG.salida, "-framerate", String(CONFIG.fps), "-i", `${DISPLAY}.0`,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-pix_fmt", "yuv420p", // la pantalla ya tiene el tamaño de salida: sin reescalar
    "-c:v", "libx264", "-preset", "veryfast", "-b:v", CONFIG.bitrate, "-maxrate", CONFIG.bitrate, "-bufsize", `${parseInt(CONFIG.bitrate, 10) * 2}k`,
    "-g", gop, "-keyint_min", gop, "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    ...argsSalida(),
  ];
}

function matarTodo() {
  for (const p of Object.values(procesos)) {
    try { p.kill("SIGTERM"); } catch { /* ya terminó */ }
    setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* ya terminó */ } }, 5000).unref();
  }
  estado.alAire = false;
}

async function arrancar() {
  const gen = ++generacion;
  matarTodo();
  await esperar(1500);
  if (gen !== generacion || !estado.activo) return;
  const nombres = DESTINOS.filter((d) => estado.destinos.includes(d.id)).map((d) => d.nombre).join(" + ");
  anotar("control", `arrancando: ${CONFIG.url} → ${nombres} (${CONFIG.salida} a ${CONFIG.fps} fps, ${CONFIG.bitrate})`);
  lanzar("xvfb", BIN.xvfb, [DISPLAY, "-screen", "0", `${CONFIG.salida}x24`, "-nolisten", "tcp"], gen);
  await esperar(1500);
  if (gen !== generacion || !estado.activo) return;
  lanzar("chromium", BIN.chromium, argsChromium(), gen);
  await esperar(CONFIG.espera * 1000);
  if (gen !== generacion || !estado.activo) return;
  // Facebook automático: si no hay vivo abierto (o se cerró), se crea uno nuevo justo antes de mandar señal.
  if (estado.destinos.includes("facebook") && FACEBOOK_AUTOMATICO && !vivoFacebook) {
    try { await crearVivoFacebook(); }
    catch (e) {
      if (gen !== generacion || !estado.activo) return;
      if (estado.destinos.length === 1) { reiniciar(e.message); return; }
      anotar("facebook", `${e.message} Sigo con los demás destinos.`); // los otros salen igual
    }
    if (gen !== generacion || !estado.activo) return;
  }
  lanzar("ffmpeg", BIN.ffmpeg, argsFfmpeg(), gen);
  estado.alAire = true;
  estado.error = null;
  anotar("control", "al aire");
  // Si aguanta 5 minutos sin caerse, se olvidan los reintentos (la próxima falla espera poco).
  setTimeout(() => { if (gen === generacion && estado.alAire) estado.reinicios = 0; }, 300_000).unref();
}

function reiniciar(motivo) {
  estado.error = motivo;
  estado.alAire = false;
  estado.reinicios += 1;
  anotar("control", `${motivo}; reintento ${estado.reinicios}`);
  generacion += 1; // los que mueran por el matarTodo no vuelven a disparar esto
  matarTodo();
  clearTimeout(temporizadorReinicio);
  const espera = Math.min(60, 5 * estado.reinicios) * 1000;
  temporizadorReinicio = setTimeout(() => { if (estado.activo) arrancar(); }, espera);
}

function iniciar(destinos) {
  if (!DESTINOS.length) throw Object.assign(new Error("No hay destinos configurados: cargá YOUTUBE_STREAM_KEY, FACEBOOK_STREAM_KEY o TRANSMISION_OTROS en el .env del servidor."), { status: 503 });
  const elegidos = (Array.isArray(destinos) ? destinos : []).filter((id) => DESTINOS.some((d) => d.id === id));
  if (!elegidos.length) throw Object.assign(new Error("Elegí al menos un destino."), { status: 400 });
  if (estado.activo) return;
  estado.activo = true;
  estado.destinos = elegidos;
  estado.desde = new Date().toISOString();
  estado.error = null;
  estado.reinicios = 0;
  guardarActivo(true, elegidos);
  arrancar();
}

function detener() {
  estado.activo = false;
  estado.desde = null;
  estado.destinos = [];
  generacion += 1;
  clearTimeout(temporizadorReinicio);
  clearTimeout(temporizadorReconexion); temporizadorReconexion = null;
  terminarVivoFacebook();
  guardarActivo(false);
  matarTodo();
  anotar("control", "detenida");
}

function captura() {
  return new Promise((resolve, reject) => {
    if (!procesos.xvfb) return reject(Object.assign(new Error("No hay nada en pantalla: la transmisión está detenida."), { status: 409 }));
    execFile(BIN.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "x11grab", "-video_size", CONFIG.salida, "-i", `${DISPLAY}.0`, "-frames:v", "1", "-vf", "scale=960:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "5", "-"],
      { env: { ...process.env, DISPLAY }, encoding: "buffer", maxBuffer: 10 * 1024 * 1024, timeout: 15000 },
      (e, stdout) => (e ? reject(e) : resolve(stdout)));
  });
}

function leerJson(req) {
  return new Promise((resolve) => {
    let t = "";
    req.on("data", (d) => { t += d; if (t.length > 10_000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(t || "{}")); } catch { resolve({}); } });
  });
}

const responder = (res, status, cuerpo, tipo = "application/json") => {
  res.writeHead(status, { "Content-Type": tipo, "Cache-Control": "no-store" });
  res.end(tipo === "application/json" ? JSON.stringify(cuerpo) : cuerpo);
};

const servidor = http.createServer(async (req, res) => {
  if (!TOKEN || req.headers["x-token"] !== TOKEN) return responder(res, 401, { error: "Token inválido." });
  try {
    if (req.method === "GET" && req.url === "/estado") {
      return responder(res, 200, { ...estado, config: { ...CONFIG, destinos: DESTINOS.map(({ id, nombre, servidor }) => ({ id, nombre, servidor })) }, registro: registro.slice(-40) });
    }
    if (req.method === "POST" && req.url === "/iniciar") { iniciar((await leerJson(req)).destinos); return responder(res, 200, { ok: true }); }
    if (req.method === "POST" && req.url === "/detener") { detener(); return responder(res, 200, { ok: true }); }
    if (req.method === "GET" && req.url === "/captura.jpg") return responder(res, 200, await captura(), "image/jpeg");
    responder(res, 404, { error: "No existe." });
  } catch (e) {
    responder(res, e.status || 500, { error: e.message });
  }
});

servidor.listen(PUERTO, () => {
  console.log(`[transmision] control en :${PUERTO} · página ${CONFIG.url} · destinos: ${DESTINOS.map((d) => d.nombre).join(", ") || "NINGUNO (faltan claves)"}`);
  if (!TOKEN) console.warn("[transmision] Falta TRANSMISION_TOKEN: el control rechaza todo.");
  const guardado = leerGuardado();
  if (guardado.activo) {
    anotar("control", "estaba transmitiendo antes de reiniciar: retomo");
    try { iniciar(guardado.destinos); } catch (e) { anotar("control", `no se pudo retomar: ${e.message}`); }
  }
});

for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => { generacion += 1; matarTodo(); setTimeout(() => process.exit(0), 1500); });
