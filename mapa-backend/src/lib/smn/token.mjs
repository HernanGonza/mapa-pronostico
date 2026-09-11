import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Consigue y renueva el JWT que pide `https://ws1.smn.gob.ar` — el SMN no
 * documenta cómo emitirlo; la única forma es abrir `smn.gob.ar` con un
 * navegador real y leerlo de `localStorage`. Puerto a Node de lo que hacía
 * `opensmn/tokenext.py` (repo Python clonado aparte, con Selenium): esto lo
 * hace Chromium vía `puppeteer-core`, sin depender de otro lenguaje ni de un
 * proceso/servicio adicional para dockerizar.
 *
 * El token se guarda en disco (`SMN_TOKEN_FILE`) y se reutiliza entre
 * reinicios; `leerApiAlertas` (cap.mjs) llama a `refrescarToken` sólo cuando
 * el SMN responde 401.
 */

const SMN_URL = process.env.SMN_URL || "https://www.smn.gob.ar/";
const TOKEN_FILE =
  process.env.SMN_TOKEN_FILE ||
  fileURLToPath(new URL("../../../data/smn/token", import.meta.url));
const HEADLESS = (process.env.SMN_TOKEN_HEADLESS || "true").toLowerCase() !== "false";
const WAIT_MS = Number(process.env.SMN_TOKEN_WAIT_SECONDS || 8) * 1000;
const NAV_TIMEOUT_MS = Number(process.env.SMN_TOKEN_NAV_TIMEOUT_SECONDS || 30) * 1000;
const CHROMIUM_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  process.env.CHROMIUM_PATH ||
  "/usr/bin/chromium";

// Mismos scripts anti-detección que usaba tokenext.py (`inject_stealth_scripts`).
const STEALTH_JS = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  window.chrome = { runtime: {} };
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters)
  );
`;

// Mismos patrones que `extract_token_from_source` (respaldo si localStorage falla).
const PATRONES_TOKEN = [
  /localStorage\.setItem\(\s*['"]token['"]\s*,\s*['"]([^'"]+)['"]\s*\)/,
  /localStorage\.token\s*=\s*['"]([^'"]+)['"]/,
];

export function extraerDeCodigoFuente(html) {
  for (const patron of PATRONES_TOKEN) {
    const m = html.match(patron);
    if (m) return m[1];
  }
  return null;
}

let cache = null;
let enCurso = null;

/** Token vigente: el de disco/memoria si hay, si no dispara una renovación. */
export async function obtenerToken() {
  if (cache) return cache;
  try {
    const raw = (await readFile(TOKEN_FILE, "utf8")).trim();
    if (raw) {
      cache = raw;
      return raw;
    }
  } catch {
    // sin token guardado todavía — se busca uno nuevo abajo
  }
  return refrescarToken();
}

/** Fuerza una renovación (llamado ante un 401 del SMN). Deduplicada. */
export function refrescarToken() {
  if (enCurso) return enCurso;
  enCurso = extraerTokenConChromium()
    .then(async (token) => {
      if (!token) throw new Error("No se pudo extraer el token de smn.gob.ar");
      await mkdir(path.dirname(TOKEN_FILE), { recursive: true });
      await writeFile(TOKEN_FILE, token, "utf8");
      cache = token;
      return token;
    })
    .finally(() => {
      enCurso = null;
    });
  return enCurso;
}

async function extraerTokenConChromium() {
  const { launch } = await import("puppeteer-core");
  const browser = await launch({
    executablePath: CHROMIUM_PATH,
    headless: HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080",
      "--disable-extensions",
      "--disable-popup-blocking",
      "--disable-notifications",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.evaluateOnNewDocument(STEALTH_JS);
    await page.goto(SMN_URL, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

    let html = await page.content();
    if (/checking your browser|cloudflare/i.test(html)) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      html = await page.content();
    }

    let token = await page
      .evaluate(() => window.localStorage.getItem("token"))
      .catch(() => null);
    if (!token) token = extraerDeCodigoFuente(html);
    return token;
  } finally {
    await browser.close();
  }
}
