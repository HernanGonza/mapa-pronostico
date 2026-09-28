#!/usr/bin/env node
/**
 * Verifica la configuración de redes (Meta y Telegram) SIN publicar nada:
 * que los tokens sean válidos, que los IDs coincidan entre sí y que haya
 * permiso para publicar. Correrlo después de cargar las variables:
 *
 *   docker compose exec backend node scripts/verificar-redes.js
 *   (o local: node scripts/verificar-redes.js, con las variables en el entorno)
 *
 * Sale con código 1 si algo configurado no anda.
 */
const redes = require("../src/lib/redesSociales");

const env = (n) => (process.env[n] || "").trim();
let fallas = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const aviso = (m) => console.log(`  ! ${m}`);
const falla = (m) => { fallas++; console.log(`  ✗ ${m}`); };

async function graph(ruta, params = {}) {
  const qs = new URLSearchParams({ ...params, access_token: env("META_PAGE_ACCESS_TOKEN") });
  const res = await fetch(`${redes.graphBase()}/${ruta}?${qs}`, { signal: AbortSignal.timeout(20_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(redes.mensajeDeMeta(json.error));
  return json;
}

async function verificarMeta() {
  console.log(`\nMeta (${redes.graphBase()})`);
  if (!env("META_PAGE_ACCESS_TOKEN")) return aviso("META_PAGE_ACCESS_TOKEN vacío: Facebook e Instagram quedan sin configurar.");

  let yo;
  try { yo = await graph("me", { fields: "id,name" }); } catch (e) { return falla(`El token no sirve: ${e.message}`); }
  ok(`Token válido, pertenece a «${yo.name}» (${yo.id}).`);

  try {
    const { data } = await graph("debug_token", { input_token: env("META_PAGE_ACCESS_TOKEN") });
    if (data.type !== "PAGE") falla(`El token es de tipo ${data.type}, tiene que ser un token de PÁGINA (sale de GET /me/accounts).`);
    if (data.expires_at && data.expires_at !== 0) aviso(`El token vence el ${new Date(data.expires_at * 1000).toLocaleString("es-AR")}: conviene generarlo desde un token de usuario de larga duración para que no venza.`);
    else ok("El token no vence.");
    const faltan = ["pages_manage_posts", "pages_read_engagement", ...(env("META_IG_USER_ID") ? ["instagram_basic", "instagram_content_publish"] : [])]
      .filter((p) => !(data.scopes || []).includes(p));
    if (faltan.length) falla(`Al token le faltan permisos: ${faltan.join(", ")}.`); else ok("Tiene los permisos para publicar.");
  } catch (e) { aviso(`No se pudieron leer los permisos del token (${e.message}); sigo con el resto.`); }

  const pagina = env("META_PAGE_ID");
  if (!pagina) falla("Falta META_PAGE_ID.");
  else if (pagina !== yo.id) falla(`META_PAGE_ID (${pagina}) no coincide con la página del token (${yo.id}).`);
  else ok(`META_PAGE_ID coincide con la página del token.`);

  const ig = env("META_IG_USER_ID");
  if (!ig) return aviso("META_IG_USER_ID vacío: Instagram queda sin configurar.");
  try {
    const vinculada = (await graph(yo.id, { fields: "instagram_business_account" })).instagram_business_account?.id;
    if (!vinculada) falla("La página no tiene una cuenta de Instagram Business/Creator vinculada.");
    else if (vinculada !== ig) falla(`META_IG_USER_ID (${ig}) no es la cuenta vinculada a la página (${vinculada}).`);
    else ok("META_IG_USER_ID es la cuenta vinculada a la página.");
    const { username } = await graph(ig, { fields: "username" });
    ok(`Instagram: @${username}.`);
    const limite = (await graph(`${ig}/content_publishing_limit`, { fields: "quota_usage,config" })).data?.[0];
    if (limite) ok(`Publicaciones de Instagram en las últimas 24 h: ${limite.quota_usage} de ${limite.config?.quota_total ?? "?"}.`);
  } catch (e) { falla(`Instagram: ${e.message}`); }

  aviso("Recordá: la app de Meta tiene que estar en modo «Activo» (Live). En modo Desarrollo lo que se publica en Facebook solo lo ven quienes tienen rol en la app.");
}

async function verificarTelegram() {
  console.log("\nTelegram");
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) return aviso("TELEGRAM_BOT_TOKEN vacío: Telegram queda sin configurar.");
  const tg = async (metodo, params = {}) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${metodo}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(20_000) });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) throw new Error(json.description || `HTTP ${res.status}`);
    return json.result;
  };
  let bot;
  try { bot = await tg("getMe"); } catch (e) { return falla(`El token del bot no sirve: ${e.message}`); }
  ok(`Bot @${bot.username}.`);
  const chats = env("TELEGRAM_CHAT_ID").split(",").map((s) => s.trim()).filter(Boolean);
  if (!chats.length) return falla("Falta TELEGRAM_CHAT_ID.");
  for (const chat of chats) {
    try {
      const info = await tg("getChat", { chat_id: chat });
      const miembro = await tg("getChatMember", { chat_id: chat, user_id: bot.id });
      const puede = info.type === "channel" ? miembro.status === "administrator" && miembro.can_post_messages !== false : ["administrator", "member", "creator"].includes(miembro.status);
      if (puede) ok(`${chat}: «${info.title}» (${info.type}), el bot puede publicar.`);
      else falla(`${chat}: «${info.title}», el bot es «${miembro.status}» y no puede publicar (en canales tiene que ser administrador).`);
    } catch (e) { falla(`${chat}: ${e.message}`); }
  }
}

(async () => {
  const estado = redes.estado();
  console.log("Almacenamiento de placas:", estado.almacenamiento ? "configurado" : "SIN CONFIGURAR (sin él no se puede publicar en ningún lado)");
  if (!estado.almacenamiento) fallas++;
  await verificarMeta();
  await verificarTelegram();
  console.log(fallas ? `\n${fallas} problema(s) para resolver.` : "\nTodo en orden.");
  process.exit(fallas ? 1 : 0);
})();
