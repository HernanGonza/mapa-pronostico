const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const notificaciones = require("../lib/notificacionesStore");

const router = express.Router();

// Las del usuario (campanita y números de las tarjetas).
router.get("/notificaciones", requireAuth, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await notificaciones.listar(req.usuario.usuarioId)); }
  catch (e) { console.error("[notificaciones]", e.message); res.status(503).json({ error: "No se pudieron leer las notificaciones." }); }
});

// Marcar como leídas: { ids: [..] } | { tipo: "acp" } | { todas: true }.
router.post("/notificaciones/leer", requireAuth, express.json(), async (req, res) => {
  try { res.json({ marcadas: await notificaciones.marcarLeidas(req.usuario.usuarioId, req.body || {}) }); }
  catch (e) { console.error("[notificaciones]", e.message); res.status(503).json({ error: "No se pudieron marcar las notificaciones." }); }
});

module.exports = router;
