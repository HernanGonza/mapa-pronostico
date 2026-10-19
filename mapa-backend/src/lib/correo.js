/**
 * Envío de correo. Hay dos vías, y se usa la que esté configurada (con las dos, Gmail):
 *
 *  1. Gmail (SMTP con «contraseña de aplicación»): GMAIL_USER (la dirección) y GMAIL_APP_PASSWORD (16 letras, que se genera
 *     en la cuenta de Google con la verificación en dos pasos activada: myaccount.google.com/apppasswords). Opcional:
 *     MAIL_FROM_NOMBRE (cómo se ve el remitente; por defecto «Alerta Temprana — Ecología Misiones»).
 *  2. Microsoft 365 (API Graph), cuando el administrador entregue los datos (abajo).
 *
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
 * Flujo de envío: si todo pesa poco (lo normal: un .docx y un .rtf), un solo pedido `sendMail`, que alcanza con el permiso
 * `Mail.Send`. Si los adjuntos pasan de ~3 MB (un RTF con imágenes) hay que armar un borrador en la casilla, adjuntar (por
 * "upload session" en partes, que es como Graph admite archivos grandes) y enviarlo: eso pide además `Mail.ReadWrite`.
 */
const GRAPH = "https://graph.microsoft.com/v1.0";
const LIMITE_ADJUNTO_DIRECTO = 3 * 1024 * 1024;
const LIMITE_ENVIO_DIRECTO = 2.5 * 1024 * 1024; // suma de adjuntos para `sendMail` (el pedido entero, en base64, tiene que quedar bajo ~4 MB)
const PARTE = 320 * 1024 * 10; // 3.2 MB: Graph pide partes múltiplo de 320 KiB
const TIMEOUT_MS = 60_000;

const env = (k) => (process.env[k] || "").trim();

const gmailConfigurado = () => !!(env("GMAIL_USER") && env("GMAIL_APP_PASSWORD"));
const microsoftConfigurado = () => !!(env("MS_TENANT_ID") && env("MS_CLIENT_ID") && env("MS_CLIENT_SECRET") && env("MAIL_FROM"));

/** { configurado, remitente, via: "gmail" | "microsoft" | null } */
function estado() {
  if (gmailConfigurado()) return { configurado: true, remitente: env("GMAIL_USER"), via: "gmail" };
  if (microsoftConfigurado()) return { configurado: true, remitente: env("MAIL_FROM"), via: "microsoft" };
  return { configurado: false, remitente: env("MAIL_FROM") || env("GMAIL_USER") || null, via: null };
}

// --- Gmail (SMTP) ----------------------------------------------------------------------------------------------
let transporteGmail = null; // se arma al primer envío; los tests lo reemplazan con _usarTransporte
function transporte() {
  if (!transporteGmail) {
    transporteGmail = require("nodemailer").createTransport({
      host: "smtp.gmail.com", port: 465, secure: true, auth: { user: env("GMAIL_USER"), pass: env("GMAIL_APP_PASSWORD").replace(/\s+/g, "") },
      connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 60_000,
    });
  }
  return transporteGmail;
}
function mensajeDeGmail(e) {
  if (e.code === "EAUTH" || /535|Username and Password not accepted|Invalid login/i.test(e.message)) return "Gmail rechazó el usuario o la contraseña de aplicación (GMAIL_USER / GMAIL_APP_PASSWORD). Tiene que ser una «contraseña de aplicación» de 16 letras, no la contraseña de la cuenta.";
  if (e.code === "ETIMEDOUT" || e.code === "ESOCKET" || e.code === "ECONNECTION" || e.code === "ENETUNREACH") return `No se pudo conectar con Gmail (${e.code}). Revisá la conexión a internet del servidor.`;
  if (/552|size|too large/i.test(e.message)) return "Gmail no aceptó el mensaje por su tamaño.";
  if (/550|5\.4\.5|Daily user sending limit|quota/i.test(e.message)) return "Gmail alcanzó el límite diario de envíos de la cuenta. Probá de nuevo más tarde.";
  return `Gmail no pudo enviar el correo: ${e.message}`;
}
async function enviarGmail({ asunto, cuerpo, destinatarios, adjuntos }) {
  const usuario = env("GMAIL_USER");
  try {
    await transporte().sendMail({
      from: { name: env("MAIL_FROM_NOMBRE") || "Alerta Temprana — Ecología Misiones", address: usuario },
      to: usuario, // los destinatarios van en copia oculta: en «Para» va la propia casilla, así queda copia
      bcc: destinatarios.map((d) => (d.nombre ? { name: d.nombre.replace(/[",<>]/g, " "), address: d.email } : d.email)),
      subject: asunto, text: cuerpo,
      attachments: adjuntos.map((a) => ({ filename: a.nombre, content: a.buffer, contentType: a.tipo })),
    });
  } catch (e) { throw error(502, mensajeDeGmail(e)); }
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
  if (status === 403 || /AccessDenied|ErrorAccessDenied/i.test(codigo)) return "La aplicación no tiene permiso para esta operación en la casilla. Para enviar alcanza con «Mail.Send» (de aplicación, con consentimiento del administrador); armar un borrador para adjuntos de más de 3 MB pide además «Mail.ReadWrite». Si ya se lo dieron, puede tardar unos minutos en aplicarse.";
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
  const { configurado, remitente, via } = estado();
  if (!configurado) throw error(503, "El envío por correo todavía no está configurado en el servidor: falta GMAIL_USER y GMAIL_APP_PASSWORD (Gmail) o los datos de Microsoft 365 (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET y MAIL_FROM).");
  if (via === "gmail") return enviarGmail({ asunto, cuerpo, destinatarios, adjuntos });
  const buzon = `/users/${encodeURIComponent(remitente)}`;
  const mensaje = {
    subject: asunto,
    body: { contentType: "Text", content: cuerpo },
    toRecipients: [{ emailAddress: { address: remitente } }],
    bccRecipients: destinatarios.map((d) => ({ emailAddress: { address: d.email, ...(d.nombre ? { name: d.nombre } : {}) } })),
  };
  // Lo normal (adjuntos chicos): un solo pedido, que sólo necesita el permiso Mail.Send.
  if (adjuntos.reduce((n, a) => n + a.buffer.length, 0) <= LIMITE_ENVIO_DIRECTO) {
    await graph("POST", `${buzon}/sendMail`, { message: { ...mensaje, attachments: adjuntos.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.nombre, contentType: a.tipo, contentBytes: a.buffer.toString("base64") })) }, saveToSentItems: true });
    return;
  }
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

module.exports = { estado, enviar, mensajeDeMicrosoft, _reiniciarToken: () => { tokenCache = null; }, _usarTransporte: (t) => { transporteGmail = t; } };
