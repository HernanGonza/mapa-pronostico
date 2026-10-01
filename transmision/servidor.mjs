/**
 * Servicio de transmisión a YouTube (sin OBS ni computadora aparte).
 *
 *   Xvfb      pantalla virtual (TRANSMISION_PANTALLA, 1920x1080)
 *   Chromium  en modo kiosco, abre la página /tv del sistema en esa pantalla
 *   ffmpeg    captura la pantalla (x11grab), le suma una pista de audio en silencio
 *             (YouTube exige audio) y la manda por RTMP a YouTube
 *
 * Este proceso los arranca, los vigila (si alguno se cae, reinicia todo con espera
 * creciente) y expone un control HTTP SOLO en la red interna de docker (no publica
 * puertos): el backend lo usa desde el panel (Configuración → Transmisión).
 *   GET  /estado       { activo, alAire, desde, error, reinicios, config, registro }
 *   POST /iniciar      POST /detener
 *   GET  /captura.jpg  lo que se está mostrando ahora (vista previa)
 * Todos piden el encabezado `x-token: TRANSMISION_TOKEN`.
 *
 * Si estaba transmitiendo y el contenedor se reinicia (reinicio del servidor), retoma
 * solo: el estado "activo" se guarda en /data/estado.json.
 */
import http from "node:http";
import fs from "node:fs";
import { spawn, execFile } from "node:child_process";

const env = (k, def = "") => (process.env[k] || def).trim();
const CONFIG = {
  url: env("TRANSMISION_URL", "http://frontend/tv"),
  rtmp: env("YOUTUBE_RTMP_URL", "rtmp://a.rtmp.youtube.com/live2").replace(/\/+$/, ""),
  clave: env("YOUTUBE_STREAM_KEY"),
  pantalla: env("TRANSMISION_PANTALLA", "1920x1080"),
  salida: env("TRANSMISION_SALIDA", "1280x720"),
  fps: Number(env("TRANSMISION_FPS", "25")) || 25,
  bitrate: env("TRANSMISION_BITRATE", "3000k"),
  espera: Number(env("TRANSMISION_ESPERA_CARGA", "20")) || 20, // s para que /tv cargue antes de salir al aire
};
const TOKEN = env("TRANSMISION_TOKEN");
const PUERTO = Number(env("TRANSMISION_PUERTO", "8090"));
const DISPLAY = ":99";
const ARCHIVO_ESTADO = "/data/estado.json";
const BIN = { xvfb: env("BIN_XVFB", "Xvfb"), chromium: env("BIN_CHROMIUM", "chromium"), ffmpeg: env("BIN_FFMPEG", "ffmpeg") };

const estado = { activo: false, alAire: false, desde: null, error: null, reinicios: 0 };
const procesos = {};
const registro = [];
let generacion = 0; // cada arranque tiene su número: un proceso viejo que muere no dispara otro reinicio
let temporizadorReinicio = null;

/** Nunca mostrar la clave de YouTube (ffmpeg la imprime en la URL de salida). */
const tapar = (texto) => (CONFIG.clave ? texto.split(CONFIG.clave).join("••••") : texto);
function anotar(origen, texto) {
  for (const linea of tapar(String(texto)).split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean)) {
    registro.push(`${new Date().toISOString().slice(11, 19)} [${origen}] ${linea}`.slice(0, 400));
  }
  registro.splice(0, Math.max(0, registro.length - 150));
}

function guardarActivo(activo) {
  try { fs.mkdirSync("/data", { recursive: true }); fs.writeFileSync(ARCHIVO_ESTADO, JSON.stringify({ activo })); } catch (e) { anotar("control", `no se pudo guardar el estado: ${e.message}`); }
}
function leerActivo() {
  try { return JSON.parse(fs.readFileSync(ARCHIVO_ESTADO, "utf8")).activo === true; } catch { return false; }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function lanzar(nombre, cmd, args, gen) {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DISPLAY } });
  procesos[nombre] = p;
  p.stdout.on("data", (d) => anotar(nombre, d));
  p.stderr.on("data", (d) => anotar(nombre, d));
  p.on("error", (e) => anotar(nombre, `no arrancó: ${e.message}`));
  p.on("exit", (codigo, senal) => {
    if (procesos[nombre] === p) delete procesos[nombre];
    if (gen === generacion && estado.activo) reiniciar(`${nombre} se cerró (${senal || `código ${codigo}`})`);
  });
  return p;
}

function argsChromium() {
  const [w, h] = CONFIG.pantalla.split("x");
  return [
    "--no-sandbox", "--kiosk", "--start-fullscreen", `--window-size=${w},${h}`, "--window-position=0,0",
    "--force-device-scale-factor=1", "--noerrdialogs", "--disable-infobars", "--disable-session-crashed-bubble",
    "--disable-features=Translate,TranslateUI", "--hide-scrollbars", "--no-first-run", "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    // Sin GPU: los mapas (WebGL) se dibujan por software.
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--user-data-dir=/tmp/perfil-chromium", CONFIG.url,
  ];
}

function argsFfmpeg() {
  const [sw, sh] = CONFIG.salida.split("x");
  const gop = String(CONFIG.fps * 2);
  return [
    "-hide_banner", "-loglevel", "warning",
    "-thread_queue_size", "512", "-f", "x11grab", "-draw_mouse", "0", "-video_size", CONFIG.pantalla, "-framerate", String(CONFIG.fps), "-i", `${DISPLAY}.0`,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-vf", `scale=${sw}:${sh}:flags=bicubic,format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-b:v", CONFIG.bitrate, "-maxrate", CONFIG.bitrate, "-bufsize", `${parseInt(CONFIG.bitrate, 10) * 2}k`,
    "-g", gop, "-keyint_min", gop, "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-f", "flv", `${CONFIG.rtmp}/${CONFIG.clave}`,
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
  anotar("control", `arrancando: ${CONFIG.url} → YouTube (${CONFIG.salida} a ${CONFIG.fps} fps, ${CONFIG.bitrate})`);
  lanzar("xvfb", BIN.xvfb, [DISPLAY, "-screen", "0", `${CONFIG.pantalla}x24`, "-nolisten", "tcp"], gen);
  await esperar(1500);
  if (gen !== generacion || !estado.activo) return;
  lanzar("chromium", BIN.chromium, argsChromium(), gen);
  await esperar(CONFIG.espera * 1000);
  if (gen !== generacion || !estado.activo) return;
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

function iniciar() {
  if (!CONFIG.clave) throw Object.assign(new Error("Falta YOUTUBE_STREAM_KEY (la clave de transmisión de YouTube) en el .env del servidor."), { status: 503 });
  if (estado.activo) return;
  estado.activo = true;
  estado.desde = new Date().toISOString();
  estado.error = null;
  estado.reinicios = 0;
  guardarActivo(true);
  arrancar();
}

function detener() {
  estado.activo = false;
  estado.desde = null;
  generacion += 1;
  clearTimeout(temporizadorReinicio);
  guardarActivo(false);
  matarTodo();
  anotar("control", "detenida");
}

function captura() {
  return new Promise((resolve, reject) => {
    if (!procesos.xvfb) return reject(Object.assign(new Error("No hay nada en pantalla: la transmisión está detenida."), { status: 409 }));
    execFile(BIN.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "x11grab", "-video_size", CONFIG.pantalla, "-i", `${DISPLAY}.0`, "-frames:v", "1", "-vf", "scale=960:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "5", "-"],
      { env: { ...process.env, DISPLAY }, encoding: "buffer", maxBuffer: 10 * 1024 * 1024, timeout: 15000 },
      (e, stdout) => (e ? reject(e) : resolve(stdout)));
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
      const { clave, ...publica } = CONFIG;
      return responder(res, 200, { ...estado, config: { ...publica, claveConfigurada: !!clave }, registro: registro.slice(-40) });
    }
    if (req.method === "POST" && req.url === "/iniciar") { iniciar(); return responder(res, 200, { ok: true }); }
    if (req.method === "POST" && req.url === "/detener") { detener(); return responder(res, 200, { ok: true }); }
    if (req.method === "GET" && req.url === "/captura.jpg") return responder(res, 200, await captura(), "image/jpeg");
    responder(res, 404, { error: "No existe." });
  } catch (e) {
    responder(res, e.status || 500, { error: e.message });
  }
});

servidor.listen(PUERTO, () => {
  console.log(`[transmision] control en :${PUERTO} · página ${CONFIG.url} · clave ${CONFIG.clave ? "configurada" : "FALTA"}`);
  if (!TOKEN) console.warn("[transmision] Falta TRANSMISION_TOKEN: el control rechaza todo.");
  if (leerActivo() && CONFIG.clave) { anotar("control", "estaba transmitiendo antes de reiniciar: retomo"); iniciar(); }
});

for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => { generacion += 1; matarTodo(); setTimeout(() => process.exit(0), 1500); });
