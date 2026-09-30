const express = require("express");
const multer = require("multer");
const requireAuth = require("../middleware/requireAuth");
const correo = require("../lib/correo");
const correoStore = require("../lib/correoStore");

const router = express.Router();
const MAX_ARCHIVO = 20 * 1024 * 1024;
const MAX_ASUNTO = 200, MAX_CUERPO = 5000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ARCHIVO, files: 2 } });

// El .docx es un zip ("PK") y el .rtf empieza con "{\rtf": se mira el contenido, no sólo el nombre.
const ARCHIVOS = {
  docx: { tipo: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ok: (b) => b.subarray(0, 2).toString("latin1") === "PK" },
  rtf: { tipo: "application/rtf", ok: (b) => b.subarray(0, 5).toString("latin1") === "{\\rtf" },
};

const responderError = (res, e, texto) => {
  if (!e.status) console.error(e);
  const status = [400, 502, 503].includes(e.status) ? e.status : 500;
  res.status(status).json({ error: status === 500 ? texto : e.message });
};

router.get("/correo/estado", requireAuth, (req, res) => res.json(correo.estado()));

router.get("/correo/destinatarios", requireAuth, async (req, res) => {
  try { res.json({ destinatarios: await correoStore.destinatarios() }); }
  catch (e) { responderError(res, e, "No se pudo leer la lista de destinatarios."); }
});

// Reemplaza la lista completa: [{ nombre, email }].
router.put("/correo/destinatarios", requireAuth, express.json({ limit: "64kb" }), async (req, res) => {
  const { lista, error } = correoStore.normalizarLista(req.body?.destinatarios);
  if (error) return res.status(400).json({ error });
  try { res.json({ destinatarios: await correoStore.guardarDestinatarios(lista) }); }
  catch (e) { responderError(res, e, "No se pudo guardar la lista de destinatarios."); }
});

/**
 * Envía el pronóstico del día. multipart/form-data:
 *   docx, rtf   los dos archivos adjuntos
 *   asunto, cuerpo
 *   ids         JSON con los ids de la lista a los que se manda (sólo de la lista fija)
 */
router.post("/correo/pronostico", requireAuth, upload.fields([{ name: "docx", maxCount: 1 }, { name: "rtf", maxCount: 1 }]), async (req, res) => {
  const asunto = String(req.body?.asunto || "").trim(), cuerpo = String(req.body?.cuerpo || "").trim();
  if (!asunto || asunto.length > MAX_ASUNTO || /[\r\n]/.test(asunto)) return res.status(400).json({ error: `Escribí el asunto (una línea, hasta ${MAX_ASUNTO} caracteres).` });
  if (!cuerpo || cuerpo.length > MAX_CUERPO) return res.status(400).json({ error: `Escribí el mensaje (hasta ${MAX_CUERPO} caracteres).` });
  const adjuntos = [];
  for (const [campo, { tipo, ok }] of Object.entries(ARCHIVOS)) {
    const f = req.files?.[campo]?.[0];
    if (!f || !ok(f.buffer)) return res.status(400).json({ error: `Falta el archivo .${campo} o no es un .${campo} válido.` });
    adjuntos.push({ nombre: f.originalname || `pronostico.${campo}`, tipo, buffer: f.buffer });
  }
  let ids;
  try { ids = JSON.parse(req.body?.ids || "[]"); } catch { ids = null; }
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "Elegí al menos un destinatario." });

  let destinatarios = [];
  try {
    const lista = await correoStore.destinatarios();
    const elegidos = new Set(ids.map(Number));
    destinatarios = lista.filter((d) => elegidos.has(d.id));
    if (!destinatarios.length) return res.status(400).json({ error: "Los destinatarios elegidos ya no están en la lista. Volvé a abrir el asistente." });
    await correo.enviar({ asunto, cuerpo, destinatarios, adjuntos });
  } catch (e) {
    await correoStore.registrarEnvio({ usuarioId: req.usuario.usuarioId, asunto, cuerpo, destinatarios, adjuntos: adjuntos.map(({ nombre, buffer }) => ({ nombre, bytes: buffer.length })), ok: false, error: e.message }).catch(() => {});
    return responderError(res, e, "No se pudo enviar el correo.");
  }
  await correoStore.registrarEnvio({ usuarioId: req.usuario.usuarioId, asunto, cuerpo, destinatarios, adjuntos: adjuntos.map(({ nombre, buffer }) => ({ nombre, bytes: buffer.length })), ok: true })
    .catch((e) => console.error("[correo] enviado, pero no se pudo registrar:", e.message));
  res.json({ ok: true, enviados: destinatarios.length, remitente: correo.estado().remitente });
});

router.get("/correo/envios", requireAuth, async (req, res) => {
  try { res.json({ envios: await correoStore.envios() }); }
  catch (e) { responderError(res, e, "No se pudo leer el registro de envíos."); }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Cada archivo puede pesar hasta 20 MB." : "Los archivos enviados no son válidos." });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "La lista es demasiado grande." });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "El contenido enviado no es válido." });
  next(err);
});

module.exports = router;
