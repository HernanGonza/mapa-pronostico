/**
 * Envío de correo desde la casilla institucional (Microsoft 365) con la API de
 * Microsoft Graph, sin SDK: `fetch` nativo, como el resto del backend.
 *
 * La cuenta usa autenticación moderna (OAuth2): no hay SMTP con usuario y
 * contraseña. El administrador de Microsoft 365 registra una aplicación en Entra ID
 * con permiso de envío restringido a esa casilla y nos pasa tres datos:
 *   MS_TENANT_ID      Id. de directorio (inquilino)
 *   MS_CLIENT_ID      Id. de aplicación (cliente)
 *   MS_CLIENT_SECRET  valor del secreto de cliente
 *   MAIL_FROM         casilla desde la que sale (alertatemprana@ecologia.misiones.gob.ar)
 * Con eso se pide un token (dura ~1 h, se cachea) y se envía como esa casilla.
 *
 * Flujo de envío: borrador → adjuntos → enviar. Los adjuntos chicos van en un
 * pedido; los de más de 3 MB (un RTF con imágenes puede pesar bastante) por
 * "upload session" en partes, que es como Graph admite archivos grandes.
 */
const GRAPH = "https://graph.microsoft.com/v1.0";
const LIMITE_ADJUNTO_DIRECTO = 3 * 1024 * 1024;
const PARTE = 320 * 1024 * 10; // 3.2 MB: Graph pide partes múltiplo de 320 KiB
const TIMEOUT_MS = 60_000;

const env = (k) => (process.env[k] || "").trim();

function estado() {
  const configurado = !!(env("MS_TENANT_ID") && env("MS_CLIENT_ID") && env("MS_CLIENT_SECRET") && env("MAIL_FROM"));
  return { configurado, remitente: env("MAIL_FROM") || null };
}

function error(status, mensaje) {
  return Object.assign(new Error(mensaje), { status });
}

async function pedir(url, opciones = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opciones, signal: controller.signal });
  } catch (e) {
    throw error(502, e.name === "AbortError" ? "Microsoft tardó demasiado en responder." : `No se pudo conectar con Microsoft: ${e.cause?.code || e.message}`);
  } finally {
    clearTimeout(t);
  }
}

/** Traduce los errores de Microsoft a algo accionable para el panel. */
function mensajeDeMicrosoft(status, json) {
  const codigo = json?.error?.code || json?.error || "";
  const detalle = json?.error?.message || json?.error_description || "";
  if (/AADSTS7000215|invalid_client/i.test(`${codigo} ${detalle}`)) return "Microsoft rechazó el secreto de cliente (MS_CLIENT_SECRET): puede estar mal copiado o vencido.";
  if (/AADSTS700016|AADSTS90002|unauthorized_client/i.test(`${codigo} ${detalle}`)) return "Microsoft no reconoce la aplicación: revisá MS_TENANT_ID y MS_CLIENT_ID.";
  if (status === 403 || /AccessDenied|ErrorAccessDenied/i.test(codigo)) return "La aplicación no tiene permiso para enviar desde esta casilla. Lo tiene que habilitar el administrador de Microsoft 365.";
  if (status === 404 || /ErrorInvalidUser|MailboxNotEnabled/i.test(codigo)) return "Microsoft no encuentra la casilla de MAIL_FROM.";
  return `Microsoft respondió ${status}${detalle ? `: ${detalle}` : ""}`;
}

let tokenCache = null; // { token, vence }

async function token() {
  if (tokenCache && tokenCache.vence > Date.now()) return tokenCache.token;
  const res = await pedir(`https://login.microsoftonline.com/${encodeURIComponent(env("MS_TENANT_ID"))}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: env("MS_CLIENT_ID"),
      client_secret: env("MS_CLIENT_SECRET"),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw error(502, mensajeDeMicrosoft(res.status, json));
  tokenCache = { token: json.access_token, vence: Date.now() + (Number(json.expires_in || 3600) - 120) * 1000 };
  return tokenCache.token;
}

async function graph(metodo, ruta, cuerpo) {
  const res = await pedir(`${GRAPH}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${await token()}`, ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (res.status === 202 || res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw error(502, mensajeDeMicrosoft(res.status, json));
  return json;
}

async function adjuntar(buzon, idMensaje, { nombre, tipo, buffer }) {
  const base = `/users/${encodeURIComponent(buzon)}/messages/${encodeURIComponent(idMensaje)}/attachments`;
  if (buffer.length < LIMITE_ADJUNTO_DIRECTO) {
    await graph("POST", base, { "@odata.type": "#microsoft.graph.fileAttachment", name: nombre, contentType: tipo, contentBytes: buffer.toString("base64") });
    return;
  }
  const { uploadUrl } = await graph("POST", `${base}/createUploadSession`, { AttachmentItem: { attachmentType: "file", name: nombre, size: buffer.length, contentType: tipo } });
  for (let inicio = 0; inicio < buffer.length; inicio += PARTE) {
    const parte = buffer.subarray(inicio, Math.min(inicio + PARTE, buffer.length));
    // La URL de la sesión ya viene autorizada: no lleva el token.
    const res = await pedir(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", "Content-Range": `bytes ${inicio}-${inicio + parte.length - 1}/${buffer.length}` },
      body: parte,
    });
    if (!res.ok) throw error(502, mensajeDeMicrosoft(res.status, await res.json().catch(() => ({}))));
  }
}

/**
 * Envía un correo desde MAIL_FROM. Los destinatarios van en copia oculta (nadie ve
 * las direcciones de los demás); en "Para" va la propia casilla, así queda copia.
 *   destinatarios: [{ nombre, email }]   adjuntos: [{ nombre, tipo, buffer }]
 */
async function enviar({ asunto, cuerpo, destinatarios, adjuntos = [] }) {
  const { configurado, remitente } = estado();
  if (!configurado) throw error(503, "El envío por correo todavía no está configurado en el servidor: faltan los datos de Microsoft 365 (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET y MAIL_FROM).");
  const buzon = `/users/${encodeURIComponent(remitente)}`;
  const borrador = await graph("POST", `${buzon}/messages`, {
    subject: asunto,
    body: { contentType: "Text", content: cuerpo },
    toRecipients: [{ emailAddress: { address: remitente } }],
    bccRecipients: destinatarios.map((d) => ({ emailAddress: { address: d.email, ...(d.nombre ? { name: d.nombre } : {}) } })),
  });
  try {
    for (const a of adjuntos) await adjuntar(remitente, borrador.id, a);
    await graph("POST", `${buzon}/messages/${encodeURIComponent(borrador.id)}/send`);
  } catch (e) {
    // Que no quede un borrador a medio armar en la casilla.
    graph("DELETE", `${buzon}/messages/${encodeURIComponent(borrador.id)}`).catch(() => {});
    throw e;
  }
}

module.exports = { estado, enviar, mensajeDeMicrosoft, _reiniciarToken: () => { tokenCache = null; } };
