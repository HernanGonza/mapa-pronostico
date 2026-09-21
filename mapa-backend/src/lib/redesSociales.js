const crypto = require("crypto");
const { createCanvas, loadImage } = require("canvas");
const { subirArchivo, urlPublica, habilitado: storageHabilitado } = require("./storage");

/**
 * Publicación de placas en redes desde el panel.
 *
 * - Facebook (página) e Instagram (cuenta Business/Creator vinculada a la
 *   página): Graph API de Meta. Ambas bajan la imagen desde una URL pública,
 *   así que se reutiliza el bucket público de Supabase Storage donde ya viven
 *   las placas. Instagram sólo acepta JPEG y proporciones 4:5 a 1.91:1 (feed)
 *   o 9:16 (historias), por eso se re-exporta cada placa a JPEG 1080x1350 /
 *   1080x1920 antes de publicar (el feed del generador mide 2250x2813, que
 *   queda apenas por debajo de 4:5 y Meta lo puede rechazar).
 * - Telegram: Bot API (`sendPhoto`) a un canal/grupo configurado.
 * - WhatsApp no se publica desde acá: el front abre WhatsApp Web (ver
 *   `whatsappNumero` en `estado()`).
 *
 * Todo se configura por variables de entorno; sin ellas el destino figura
 * como "sin configurar" y no se ofrece en el panel.
 */

const FORMATOS = ["feed", "historias"];
const DESTINOS = ["facebook", "instagram", "telegram"];
const MAX_EPIGRAFE_INSTAGRAM = 2200;
const MAX_EPIGRAFE_TELEGRAM = 1024; // límite del caption de una foto
const MAX_BYTES_PLACA = 25 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const DIMENSIONES = { feed: [1080, 1350], historias: [1080, 1920] };

const env = (nombre) => (process.env[nombre] || "").trim();

function graphBase() {
  return `https://graph.facebook.com/${env("META_GRAPH_VERSION") || "v21.0"}`;
}

function telegramChats() {
  return env("TELEGRAM_CHAT_ID").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Qué destinos están configurados (sin exponer ningún secreto). */
function estado() {
  const meta = !!env("META_PAGE_ACCESS_TOKEN");
  return {
    almacenamiento: storageHabilitado(),
    facebook: meta && !!env("META_PAGE_ID"),
    instagram: meta && !!env("META_IG_USER_ID"),
    telegram: !!env("TELEGRAM_BOT_TOKEN") && telegramChats().length > 0,
    whatsappNumero: env("WHATSAPP_NUMERO").replace(/\D/g, ""),
  };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Sólo se publican placas que ya viven en nuestro bucket (evita SSRF/abuso). */
function esUrlDePlaca(url) {
  if (typeof url !== "string" || !storageHabilitado()) return false;
  const prefijo = urlPublica("");
  return url.startsWith(prefijo) && !url.includes("..") && !/[?#\s]/.test(url.slice(prefijo.length));
}

function errorDePedido({ feedUrl, historiasUrl, epigrafe, destinos, formatos }) {
  if (!Array.isArray(destinos) || !destinos.length || destinos.some((d) => !DESTINOS.includes(d))) return "Elegí al menos un destino válido.";
  if (!Array.isArray(formatos) || !formatos.length || formatos.some((f) => !FORMATOS.includes(f))) return "Elegí al menos un formato (feed o historias).";
  if (formatos.includes("feed") && !esUrlDePlaca(feedUrl)) return "La imagen de feed no es una placa generada por el sistema.";
  if (formatos.includes("historias") && !esUrlDePlaca(historiasUrl)) return "La imagen de historias no es una placa generada por el sistema.";
  if (epigrafe != null && typeof epigrafe !== "string") return "El epígrafe no es válido.";
  const largo = (epigrafe || "").length;
  if (destinos.includes("instagram") && formatos.includes("feed") && largo > MAX_EPIGRAFE_INSTAGRAM) return `Instagram admite hasta ${MAX_EPIGRAFE_INSTAGRAM} caracteres en el epígrafe (tiene ${largo}).`;
  if (largo > 8000) return "El epígrafe es demasiado largo.";
  return null;
}

async function fetchConTimeout(url, opciones = {}) {
  try {
    return await fetch(url, { ...opciones, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw httpError(502, e.name === "TimeoutError" ? "El servicio externo tardó demasiado en responder." : `No se pudo contactar al servicio externo: ${e.message}`);
  }
}

/** Traduce los errores típicos de Meta a algo accionable para quien opera el panel. */
function mensajeDeMeta(err) {
  const { code, error_subcode: sub, message } = err || {};
  if (code === 190) return "El token de Meta venció o fue revocado. Hay que generar uno nuevo y actualizar META_PAGE_ACCESS_TOKEN (ver docs/redes-sociales.md).";
  if (code === 10 || code === 200 || code === 283) return `Meta rechazó el permiso: ${message}. Revisá que el token tenga los permisos pedidos y que la cuenta tenga rol en la app.`;
  if (code === 4 || code === 17 || code === 32 || code === 613) return "Meta limitó temporalmente las publicaciones por exceso de uso. Reintentá en unos minutos.";
  if (code === 9007 || sub === 2207027) return "Instagram todavía estaba procesando la imagen. Reintentá en unos segundos.";
  if (sub === 2207026 || sub === 2207009) return "Instagram rechazó la proporción de la imagen.";
  return message || "Meta devolvió un error sin detalle.";
}

async function graph(metodo, ruta, params = {}) {
  const token = env("META_PAGE_ACCESS_TOKEN");
  const cuerpo = new URLSearchParams({ ...params, access_token: token });
  const url = `${graphBase()}/${ruta}`;
  const res = metodo === "GET"
    ? await fetchConTimeout(`${url}?${cuerpo}`)
    : await fetchConTimeout(url, { method: "POST", body: cuerpo });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw httpError(502, mensajeDeMeta(json.error));
  return json;
}

/** Re-exporta la placa PNG a JPEG con la proporción exacta que exige Instagram. */
async function convertirAJpeg(buffer, formato) {
  const [w, h] = DIMENSIONES[formato];
  const img = await loadImage(buffer);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; // JPEG no tiene transparencia
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toBuffer("image/jpeg", { quality: 0.92 });
}

async function descargarPlaca(url) {
  const res = await fetchConTimeout(url);
  if (!res.ok) throw httpError(502, `No se pudo leer la placa del almacenamiento (${res.status}).`);
  const largo = Number(res.headers.get("content-length") || 0);
  if (largo > MAX_BYTES_PLACA) throw httpError(400, "La placa es demasiado pesada.");
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_BYTES_PLACA) throw httpError(400, "La placa es demasiado pesada.");
  return buffer;
}

/** Deja una copia JPEG pública de la placa y devuelve su URL (la que consume Meta). */
async function prepararJpeg(placaUrl, formato) {
  const jpeg = await convertirAJpeg(await descargarPlaca(placaUrl), formato);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const ruta = `redes/${stamp}-${crypto.randomBytes(4).toString("hex")}-${formato}.jpg`;
  await subirArchivo(ruta, jpeg, "image/jpeg");
  return { url: urlPublica(ruta), buffer: jpeg };
}

async function publicarFacebook(imagenUrl, formato, epigrafe) {
  const pagina = env("META_PAGE_ID");
  if (formato === "feed") {
    const r = await graph("POST", `${pagina}/photos`, { url: imagenUrl, caption: epigrafe || "", published: "true" });
    const idPost = r.post_id || r.id;
    return { externoId: String(idPost), permalink: `https://www.facebook.com/${idPost}` };
  }
  // Historia de página: subir la foto sin publicar y convertirla en historia.
  const foto = await graph("POST", `${pagina}/photos`, { url: imagenUrl, published: "false" });
  const r = await graph("POST", `${pagina}/photo_stories`, { photo_id: foto.id });
  return { externoId: String(r.post_id || foto.id), permalink: r.post_id ? `https://www.facebook.com/${r.post_id}` : null };
}

async function publicarInstagram(imagenUrl, formato, epigrafe) {
  const cuenta = env("META_IG_USER_ID");
  const params = { image_url: imagenUrl };
  if (formato === "historias") params.media_type = "STORIES";
  else params.caption = epigrafe || "";
  const contenedor = await graph("POST", `${cuenta}/media`, params);
  // Instagram procesa el contenedor de forma asíncrona: hay que esperar FINISHED.
  let estadoContenedor = "IN_PROGRESS";
  for (let i = 0; i < 20 && estadoContenedor === "IN_PROGRESS"; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1000 : 2000));
    estadoContenedor = (await graph("GET", contenedor.id, { fields: "status_code" })).status_code;
  }
  if (estadoContenedor !== "FINISHED") throw httpError(502, `Instagram no terminó de procesar la imagen (estado: ${estadoContenedor}).`);
  const publicado = await graph("POST", `${cuenta}/media_publish`, { creation_id: contenedor.id });
  let permalink = null;
  try {
    permalink = (await graph("GET", publicado.id, { fields: "permalink" })).permalink || null;
  } catch { /* el post ya salió; el enlace es un extra */ }
  return { externoId: String(publicado.id), permalink };
}

async function publicarTelegram(buffer, formato, epigrafe) {
  const token = env("TELEGRAM_BOT_TOKEN");
  const larga = (epigrafe || "").length > MAX_EPIGRAFE_TELEGRAM;
  const ids = [];
  for (const chat of telegramChats()) {
    const form = new FormData();
    form.append("chat_id", chat);
    // Enviar como archivo (no como URL) evita que Telegram tenga que alcanzar el bucket.
    form.append("photo", new Blob([buffer], { type: "image/jpeg" }), `placa-${formato}.jpg`);
    if (formato === "feed" && epigrafe && !larga) form.append("caption", epigrafe);
    const res = await fetchConTimeout(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) throw httpError(502, `Telegram: ${json.description || res.status}`);
    ids.push(`${chat}:${json.result.message_id}`);
    if (formato === "feed" && epigrafe && larga) {
      await fetchConTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: epigrafe }),
      });
    }
  }
  return { externoId: ids.join(","), permalink: null };
}

/**
 * Publica una placa en un destino/formato. Nunca lanza: devuelve
 * `{ ok, externoId?, permalink?, error? }` para poder reportar fallos parciales.
 */
async function publicarUno({ destino, formato, placaUrl, epigrafe, jpegs }) {
  try {
    if (!estado()[destino]) throw httpError(503, "Este destino no está configurado en el servidor.");
    if (!jpegs[formato]) jpegs[formato] = prepararJpeg(placaUrl, formato); // se comparte entre destinos
    const { url, buffer } = await jpegs[formato];
    const r = destino === "facebook" ? await publicarFacebook(url, formato, epigrafe)
      : destino === "instagram" ? await publicarInstagram(url, formato, epigrafe)
      : await publicarTelegram(buffer, formato, epigrafe);
    return { destino, formato, ok: true, ...r };
  } catch (e) {
    if (!e.status) console.error(`[redes] ${destino}/${formato}:`, e);
    return { destino, formato, ok: false, error: e.status ? e.message : "Error inesperado al publicar." };
  }
}

/** Publica en todos los destinos x formatos pedidos (destinos en paralelo, formatos en serie). */
async function publicar({ feedUrl, historiasUrl, epigrafe, destinos, formatos }) {
  const jpegs = {};
  const porDestino = await Promise.all(destinos.map(async (destino) => {
    const salida = [];
    for (const formato of formatos) {
      salida.push(await publicarUno({ destino, formato, placaUrl: formato === "feed" ? feedUrl : historiasUrl, epigrafe, jpegs }));
    }
    return salida;
  }));
  return porDestino.flat();
}

module.exports = { FORMATOS, DESTINOS, DIMENSIONES, estado, esUrlDePlaca, errorDePedido, convertirAJpeg, mensajeDeMeta, publicar };
