const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const ENV = { MS_TENANT_ID: "TEN", MS_CLIENT_ID: "CLI", MS_CLIENT_SECRET: "SEC", MAIL_FROM: "alertatemprana@ecologia.misiones.gob.ar" };
let previo, fetchOriginal;
beforeEach(() => { previo = { ...process.env }; Object.assign(process.env, ENV); fetchOriginal = global.fetch; require("../src/lib/correo")._reiniciarToken(); });
afterEach(() => { global.fetch = fetchOriginal; process.env = previo; });
const correo = () => require("../src/lib/correo");
const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });

/** Microsoft simulado: registra cada pedido y responde como Graph. */
function microsoftFalso({ errorToken = null } = {}) {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    pedidos.push({ metodo: opts.method || "GET", url: u, headers: opts.headers || {}, body: opts.body });
    if (u.includes("login.microsoftonline.com/TEN/oauth2/v2.0/token")) return errorToken ? json(errorToken, 401) : json({ access_token: "TOK", expires_in: 3600 });
    if (u.endsWith("/messages") && opts.method === "POST") return json({ id: "MSG1" }, 201);
    if (u.endsWith("/attachments/createUploadSession")) return json({ uploadUrl: "https://outlook.test/upload/1" }, 201);
    if (u.startsWith("https://outlook.test/upload/")) return json({}, 200);
    if (u.endsWith("/attachments")) return json({ id: "ADJ" }, 201);
    if (u.endsWith("/send")) return { ok: true, status: 202, json: async () => ({}) };
    if (opts.method === "DELETE") return { ok: true, status: 204, json: async () => ({}) };
    throw new Error(`pedido inesperado: ${opts.method} ${u}`);
  };
  return pedidos;
}
const DEST = [{ nombre: "Canal 12", email: "a@gmail.com" }, { nombre: "", email: "b@gmail.com" }];

test("sin los datos de Microsoft avisa que falta configurar, sin llamar a la red", async () => {
  delete process.env.MS_CLIENT_SECRET;
  global.fetch = async () => { throw new Error("no debería llamar"); };
  assert.equal(correo().estado().configurado, false);
  await assert.rejects(correo().enviar({ asunto: "x", cuerpo: "y", destinatarios: DEST }), { status: 503, message: /MS_CLIENT_SECRET/ });
});

test("envía como la casilla institucional: destinatarios en copia oculta, adjuntos y envío", async () => {
  const pedidos = microsoftFalso();
  await correo().enviar({ asunto: "Pronóstico 30/09", cuerpo: "Buen día", destinatarios: DEST,
    adjuntos: [{ nombre: "p.docx", tipo: "application/x-docx", buffer: Buffer.from("PK..") }, { nombre: "p.rtf", tipo: "application/rtf", buffer: Buffer.from("{\\rtf1}") }] });
  const tokenPedido = pedidos[0];
  assert.equal(Object.fromEntries(tokenPedido.body).grant_type, "client_credentials");
  assert.equal(Object.fromEntries(tokenPedido.body).scope, "https://graph.microsoft.com/.default");
  const borrador = pedidos.find((p) => p.url.endsWith("/users/alertatemprana%40ecologia.misiones.gob.ar/messages"));
  const cuerpo = JSON.parse(borrador.body);
  assert.equal(cuerpo.subject, "Pronóstico 30/09");
  assert.deepEqual(cuerpo.toRecipients, [{ emailAddress: { address: "alertatemprana@ecologia.misiones.gob.ar" } }]);
  assert.deepEqual(cuerpo.bccRecipients.map((r) => r.emailAddress.address), ["a@gmail.com", "b@gmail.com"]);
  assert.equal(borrador.headers.Authorization, "Bearer TOK");
  const adjuntos = pedidos.filter((p) => p.url.endsWith("/attachments")).map((p) => JSON.parse(p.body));
  assert.deepEqual(adjuntos.map((a) => a.name), ["p.docx", "p.rtf"]);
  assert.equal(Buffer.from(adjuntos[1].contentBytes, "base64").toString(), "{\\rtf1}");
  assert.ok(pedidos.at(-1).url.endsWith("/messages/MSG1/send"));
});

test("un adjunto grande (RTF con imágenes) va en partes por upload session, sin token", async () => {
  const pedidos = microsoftFalso();
  const grande = Buffer.alloc(8 * 1024 * 1024, 1);
  await correo().enviar({ asunto: "x", cuerpo: "y", destinatarios: DEST, adjuntos: [{ nombre: "g.rtf", tipo: "application/rtf", buffer: grande }] });
  const partes = pedidos.filter((p) => p.url.startsWith("https://outlook.test/upload/"));
  assert.equal(partes.length, 3);
  assert.equal(partes[0].headers["Content-Range"], `bytes 0-${320 * 1024 * 10 - 1}/${grande.length}`);
  assert.equal(partes.at(-1).headers["Content-Range"].endsWith(`-${grande.length - 1}/${grande.length}`), true);
  assert.ok(partes.every((p) => !p.headers.Authorization));
});

test("reusa el token mientras no venza", async () => {
  const pedidos = microsoftFalso();
  const envio = { asunto: "x", cuerpo: "y", destinatarios: DEST };
  await correo().enviar(envio); await correo().enviar(envio);
  assert.equal(pedidos.filter((p) => p.url.includes("oauth2")).length, 1);
});

test("traduce los errores de Microsoft a mensajes accionables", async () => {
  microsoftFalso({ errorToken: { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." } });
  await assert.rejects(correo().enviar({ asunto: "x", cuerpo: "y", destinatarios: DEST }), { status: 502, message: /secreto de cliente/ });
  assert.match(correo().mensajeDeMicrosoft(403, { error: { code: "ErrorAccessDenied" } }), /permiso para enviar/);
});

test("la lista de destinatarios se valida y normaliza", () => {
  const { normalizarLista, LISTA_BASE } = require("../src/lib/correoStore");
  assert.equal(LISTA_BASE.length, 22);
  assert.deepEqual(normalizarLista([{ nombre: " Canal 12 ", email: " Foo@Gmail.com " }]).lista, [{ nombre: "Canal 12", email: "foo@gmail.com" }]);
  assert.match(normalizarLista([{ email: "no-es-mail" }]).error, /Fila 1/);
  assert.match(normalizarLista([{ email: "a@b.com" }, { email: "A@b.com" }]).error, /repetida/);
  assert.ok(LISTA_BASE.every(([, email]) => !normalizarLista([{ email }]).error), "la lista base es válida");
});
