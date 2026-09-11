/**
 * Cuarta vía, manual y pesada: renderiza una página del SMN con Chrome
 * headless y devuelve el DOM visible, sin intentar extraer el JWT — sirve
 * de respaldo/diagnóstico cuando el RSS/CAP y la API JSON fallan.
 *
 * Puerto a Node de lo que hacía `opensmn/scrape_smn.py` (repo Python clonado
 * aparte, corrido antes como subproceso desde acá); ahora usa el mismo
 * Chromium que `token.mjs`, en el propio proceso del backend.
 */

const NAV_TIMEOUT_MS = 45000;
const CHROMIUM_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROMIUM_PATH || "/usr/bin/chromium";

export async function consultarPagina(
  url = process.env.SMN_SCRAPE_URL || "https://www.smn.gob.ar/alertas",
  timeoutMs = NAV_TIMEOUT_MS
) {
  const { launch } = await import("puppeteer-core");
  const browser = await launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-geolocation",
      "--window-size=1280,1200",
    ],
  });
  try {
    const page = await browser.newPage();
    // UA + `networkidle2` (en vez del `domcontentloaded` + `implicitly_wait(3)`
    // del script Python original): esa combinación se quedaba a mitad del
    // challenge de Cloudflare de /alertas en la práctica.
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    await new Promise((resolve) => setTimeout(resolve, 5000));
    if (/checking your browser|cloudflare|verificaci[oó]n de seguridad/i.test(await page.content())) {
      await new Promise((resolve) => setTimeout(resolve, 12000));
    }
    return await page.evaluate(() => ({
      url: location.href,
      titulo: document.title,
      texto: document.body.innerText,
      enlaces: Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        texto: a.textContent.trim(),
        href: a.href,
      })),
    }));
  } finally {
    await browser.close();
  }
}
