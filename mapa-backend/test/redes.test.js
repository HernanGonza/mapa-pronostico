const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { createCanvas } = require("canvas");

const ENV = {
  SUPABASE_URL: "https://storage.test", SUPABASE_SERVICE_ROLE_KEY: "svc", SUPABASE_STORAGE_BUCKET: "placas",
  META_PAGE_ID: "PAG", META_PAGE_ACCESS_TOKEN: "TOK", META_IG_USER_ID: "IG",
  TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", WHATSAPP_NUMERO: "+54 376 400-0000",
};
const PREFIJO = "https://storage.test/storage/v1/object/public/placas/";
let previo, fetchOriginal;
beforeEach(() => { previo = { ...process.env }; Object.assign(process.env, ENV); fetchOriginal = global.fetch; });
afterEach(() => { global.fetch = fetchOriginal; process.env = previo; });
const redes = () => require("../src/lib/redesSociales");
const png = (w, h) => { const c = createCanvas(w, h); c.getContext("2d").fillRect(0, 0, w, h); return c.toBuffer("image/png"); };

test("estado informa qué destinos están configurados y normaliza el WhatsApp", () => {
  assert.deepEqual(redes().estado(), { almacenamiento: true, facebook: true, instagram: true, telegram: false, whatsappNumero: "543764000000" });
  process.env.META_PAGE_ACCESS_TOKEN = "";
  assert.equal(redes().estado().facebook, false);
  assert.equal(redes().estado().instagram, false);
});

test("sólo acepta URLs de placas del bucket propio", () => {
  const { esUrlDePlaca } = redes();
  assert.ok(esUrlDePlaca(`${PREFIJO}avisos/a.png`));
  for (const mala of ["http://169.254.169.254/latest", "https://storage.test/otro/a.png", `${PREFIJO}../secreto`, `${PREFIJO}a.png?x=1`, `${PREFIJO}a b.png`, null, 5]) {
    assert.equal(esUrlDePlaca(mala), false, String(mala));
  }
});

test("valida el pedido: destinos, formatos, URLs y largo del epígrafe", () => {
  const { errorDePedido } = redes();
  const ok = { feedUrl: `${PREFIJO}f.png`, historiasUrl: `${PREFIJO}h.png`, epigrafe: "hola", destinos: ["instagram"], formatos: ["feed"] };
  assert.equal(errorDePedido(ok), null);
  assert.match(errorDePedido({ ...ok, destinos: [] }), /destino/);
  assert.match(errorDePedido({ ...ok, destinos: ["tiktok"] }), /destino/);
  assert.match(errorDePedido({ ...ok, formatos: [] }), /formato/);
  assert.match(errorDePedido({ ...ok, feedUrl: "https://malo.test/x.png" }), /feed/);
  assert.match(errorDePedido({ ...ok, formatos: ["historias"], historiasUrl: "x" }), /historias/);
  assert.match(errorDePedido({ ...ok, epigrafe: "a".repeat(2201) }), /2200/);
  assert.equal(errorDePedido({ ...ok, destinos: ["facebook"], epigrafe: "a".repeat(2201) }), null);
});

test("convierte a JPEG con la proporción exacta que pide Instagram", async () => {
  const { convertirAJpeg } = redes();
  const { loadImage } = require("canvas");
  const feed = await loadImage(await convertirAJpeg(png(2250, 2813), "feed"));
  const historias = await loadImage(await convertirAJpeg(png(2250, 4000), "historias"));
  assert.equal(feed.width / feed.height, 0.8);
  assert.equal(historias.width / historias.height, 1080 / 1920);
});

test("traduce el token vencido de Meta a un mensaje accionable", () => {
  assert.match(redes().mensajeDeMeta({ code: 190, message: "x" }), /META_PAGE_ACCESS_TOKEN/);
  assert.equal(redes().mensajeDeMeta({ code: 1, message: "otro" }), "otro");
});

test("publica feed en Facebook e Instagram y reporta fallos parciales sin lanzar", async () => {
  const llamadas = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    llamadas.push([opts.method || "GET", u.replace(/\?.*/, ""), opts.body instanceof URLSearchParams ? Object.fromEntries(opts.body) : null]);
    const json = (o, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => o });
    if (u.startsWith(PREFIJO)) return { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => png(2250, 2813) };
    if (u.startsWith("https://storage.test/storage/v1/object/placas/")) return json({});
    if (u.endsWith("/PAG/photos")) return json({ id: "F1", post_id: "PAG_F1" });
    if (u.endsWith("/IG/media")) return json({ error: { code: 190, message: "expired" } }, 400);
    throw new Error(`fetch inesperado: ${u}`);
  };
  const res = await redes().publicar({ feedUrl: `${PREFIJO}f.png`, historiasUrl: `${PREFIJO}h.png`, epigrafe: "Alerta", destinos: ["facebook", "instagram"], formatos: ["feed"] });
  const fb = res.find((r) => r.destino === "facebook"), ig = res.find((r) => r.destino === "instagram");
  assert.equal(fb.ok, true);
  assert.equal(fb.permalink, "https://www.facebook.com/PAG_F1");
  assert.equal(ig.ok, false);
  assert.match(ig.error, /token de Meta/);
  const foto = llamadas.find((l) => l[1].endsWith("/PAG/photos"));
  assert.equal(foto[2].caption, "Alerta");
  assert.equal(foto[2].access_token, "TOK");
  assert.match(foto[2].url, /\/redes\/.*-feed\.jpg$/);
  // El JPEG se generó una sola vez aunque haya dos destinos.
  assert.equal(llamadas.filter((l) => l[0] === "POST" && l[1].includes("/object/placas/redes/")).length, 1);
});

test("destino sin configurar devuelve error en vez de llamar a la red", async () => {
  global.fetch = async () => { throw new Error("no debería llamar"); };
  const [r] = await redes().publicar({ feedUrl: `${PREFIJO}f.png`, historiasUrl: "", epigrafe: "", destinos: ["telegram"], formatos: ["feed"] });
  assert.equal(r.ok, false);
  assert.match(r.error, /no está configurado/);
});

test("Telegram manda la imagen como archivo y el epígrafe largo va aparte", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "BOT"; process.env.TELEGRAM_CHAT_ID = "@canal, -100123";
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith(PREFIJO)) return { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => png(2250, 2813) };
    if (u.startsWith("https://storage.test/storage/v1/object/placas/")) return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
    if (u.includes("api.telegram.org/botBOT/")) {
      enviados.push([u.split("/").pop(), opts.body instanceof FormData ? opts.body.get("chat_id") : JSON.parse(opts.body).chat_id]);
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }) };
    }
    throw new Error(`fetch inesperado: ${u}`);
  };
  const [r] = await redes().publicar({ feedUrl: `${PREFIJO}f.png`, historiasUrl: "", epigrafe: "x".repeat(1500), destinos: ["telegram"], formatos: ["feed"] });
  assert.equal(r.ok, true);
  assert.deepEqual(enviados, [["sendPhoto", "@canal"], ["sendMessage", "@canal"], ["sendPhoto", "-100123"], ["sendMessage", "-100123"]]);
});
