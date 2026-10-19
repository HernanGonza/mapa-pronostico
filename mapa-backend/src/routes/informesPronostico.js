const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const informes = require("../lib/informesPronosticoStore");
const { generarInformePdf, errorDeInforme } = require("../lib/informePronosticoPdf");
const { generarInformeDocx } = require("../lib/informePronosticoDocx");
const { obtenerActual } = require("../lib/store");
const correo = require("../lib/correo");
const correoStore = require("../lib/correoStore");

/**
 * Informes de pronóstico del día, uno por tarjeta en «Previsión del tiempo» (se arman varios por día). Cada informe tiene su
 * borrador, su PDF, lo que se publicó en los mapas, los correos que salieron y su placa para redes.
 */
const router = express.Router();
const json = express.json({ limit: "1mb" });
const MAX_ASUNTO = 200, MAX_CUERPO = 5000;
const quien = (req) => req.usuario?.nombre || req.usuario?.email || null;
const idDe = (req) => (/^\d{1,12}$/.test(req.params.id) ? Number(req.params.id) : null);
const fallo = (res, e, donde) => {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(`[informes ${donde}]`, e);
  res.status(500).json({ error: `No se pudo completar la operación: ${e.message}` });
};
async function conInforme(req, res, hacer) {
  const id = idDe(req);
  if (id == null) return res.status(400).json({ error: "Id inválido." });
  const informe = await informes.obtener(id);
  if (!informe) return res.status(404).json({ error: "Ese informe ya no existe." });
  return hacer(informe);
}

router.get("/pronostico/informes", requireAuth, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json({ informes: await informes.listar() }); } catch (e) { fallo(res, e, "listar"); }
});

router.post("/pronostico/informes", requireAuth, json, async (req, res) => {
  const error = errorDeInforme(req.body?.borrador);
  if (error) return res.status(400).json({ error });
  try { res.status(201).json(await informes.crear({ borrador: req.body.borrador, usuario: quien(req) })); } catch (e) { fallo(res, e, "crear"); }
});

// El cajón guarda solo mientras se escribe: reemplaza el borrador.
router.put("/pronostico/informes/:id", requireAuth, json, async (req, res) => {
  const error = errorDeInforme(req.body?.borrador);
  if (error) return res.status(400).json({ error });
  const id = idDe(req);
  if (id == null) return res.status(400).json({ error: "Id inválido." });
  try {
    const informe = await informes.guardar(id, req.body.borrador);
    if (!informe) return res.status(404).json({ error: "Ese informe ya no existe." });
    res.json(informe);
  } catch (e) { fallo(res, e, "guardar"); }
});

router.delete("/pronostico/informes/:id", requireAuth, async (req, res) => {
  const id = idDe(req);
  if (id == null) return res.status(400).json({ error: "Id inválido." });
  try { if (!(await informes.borrar(id))) return res.status(404).json({ error: "Ese informe ya no existe." }); res.status(204).end(); } catch (e) { fallo(res, e, "borrar"); }
});

// El PDF de este informe (cifrado, con marca de agua).
router.get("/pronostico/informes/:id/pdf", requireAuth, async (req, res) => {
  try {
    await conInforme(req, res, async (informe) => {
      const pdf = await generarInformePdf(informe.borrador);
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="PREVISION DEL TIEMPO ${informe.fecha}.pdf"`, "Cache-Control": "no-store" }).send(pdf);
    });
  } catch (e) { fallo(res, e, "pdf"); }
});

/**
 * El panel avisa que publicó los mapas con este informe (`publicadoEn` es el de la publicación). Se verifica contra lo que está
 * publicado de verdad, para que la marca no se pueda poner a mano sobre un informe que no se publicó.
 */
router.post("/pronostico/informes/:id/publicado", requireAuth, json, async (req, res) => {
  try {
    await conInforme(req, res, async (informe) => {
      const actual = await obtenerActual();
      const publicadoEn = String(req.body?.publicadoEn || "");
      if (!actual || new Date(actual.publicadoEn).getTime() !== new Date(publicadoEn).getTime()) return res.status(409).json({ error: "Lo publicado ahora no coincide con esa publicación." });
      res.json(await informes.actualizarMeta(informe.id, (m) => ({ ...m, publicadoEn: actual.publicadoEn, publicadoPor: quien(req) })));
    });
  } catch (e) { fallo(res, e, "publicado"); }
});

/**
 * Envía este informe por correo (Word para el formato nuevo, PDF para el viejo). body: { asunto, cuerpo, ids } (ids de la lista de destinatarios). El adjunto se arma acá, con el
 * borrador guardado, así lo que sale es siempre lo que se ve en la tarjeta.
 */
router.post("/pronostico/informes/:id/enviar", requireAuth, json, async (req, res) => {
  const asunto = String(req.body?.asunto || "").trim(), cuerpo = String(req.body?.cuerpo || "").trim();
  if (!asunto || asunto.length > MAX_ASUNTO || /[\r\n]/.test(asunto)) return res.status(400).json({ error: `Escribí el asunto (una línea, hasta ${MAX_ASUNTO} caracteres).` });
  if (!cuerpo || cuerpo.length > MAX_CUERPO) return res.status(400).json({ error: `Escribí el mensaje (hasta ${MAX_CUERPO} caracteres).` });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return res.status(400).json({ error: "Elegí al menos un destinatario." });
  try {
    await conInforme(req, res, async (informe) => {
      const lista = await correoStore.destinatarios();
      const destinatarios = lista.filter((d) => ids.includes(d.id));
      if (!destinatarios.length) return res.status(400).json({ error: "Los destinatarios elegidos ya no están en la lista. Volvé a abrir el asistente." });
      // Los medios reescriben el texto: los informes con el formato nuevo salen en Word (editable), no en PDF. Los viejos no tienen .docx y siguen en PDF.
      const adjuntos = informe.borrador?.version === 2
        ? [{ nombre: `PREVISION DEL TIEMPO ${informe.fecha}.docx`, tipo: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await generarInformeDocx(informe.borrador) }]
        : [{ nombre: `PREVISION DEL TIEMPO ${informe.fecha}.pdf`, tipo: "application/pdf", buffer: await generarInformePdf(informe.borrador) }];
      const registro = { usuarioId: req.usuario.usuarioId, asunto, cuerpo, destinatarios, adjuntos: adjuntos.map(({ nombre, buffer }) => ({ nombre, bytes: buffer.length })) };
      try { await correo.enviar({ asunto, cuerpo, destinatarios, adjuntos }); }
      catch (e) { await correoStore.registrarEnvio({ ...registro, ok: false, error: e.message }).catch(() => {}); throw e; }
      await correoStore.registrarEnvio({ ...registro, ok: true }).catch((e) => console.error("[correo] enviado, pero no se pudo registrar:", e.message));
      const actualizado = await informes.actualizarMeta(informe.id, (m) => ({ ...m, envios: [...(m.envios || []), { en: new Date().toISOString(), por: quien(req), destinatarios: destinatarios.length, asunto }] }));
      res.json({ ok: true, enviados: destinatarios.length, remitente: correo.estado().remitente, informe: actualizado });
    });
  } catch (e) { fallo(res, e, "enviar"); }
});

module.exports = router;
