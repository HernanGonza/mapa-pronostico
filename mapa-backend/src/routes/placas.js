const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const pendientes = require("../lib/placasPendientes");

const router = express.Router();

// Imagen de una vista previa de placa todavía no guardada (sólo la ve quien la generó).
router.get("/placas/pendientes/:token/:formato.png", requireAuth, (req, res) => {
  const p = pendientes.obtener(req.params.token, req.usuario.usuarioId);
  const png = req.params.formato === "feed" ? p?.feedPng : req.params.formato === "historias" ? p?.historiasPng : null;
  if (!png) return res.status(404).json({ error: "La vista previa no existe o venció." });
  res.set({ "Content-Type": "image/png", "Cache-Control": "private, no-store" }).send(png);
});

module.exports = router;
