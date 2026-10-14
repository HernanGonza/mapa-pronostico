const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const service = require("../lib/arroyos/service");

const router = express.Router();
// El superadmin y quienes tengan el módulo «inundaciones» (ver pantalla Usuarios).
const soloConModulo = require("../middleware/requireModulo")("inundaciones");
const json = express.json({ limit: "20kb" });

const fallo = (res, e, donde) => {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(`[arroyos ${donde}]`, e);
  res.status(502).json({ error: `No se pudo completar la operación: ${e.message}` });
};

// Para el embed del sitio web: público, sin sesión (como /api/cuencas). Comparte la caché de 10 minutos.
router.get("/arroyos/publico", async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await service.obtenerPublico()); } catch (e) { fallo(res, e, "publico"); }
});

// Estado actual de todos los puntos (caché de 10 minutos).
router.get("/arroyos", requireAuth, soloConModulo, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await service.obtener()); } catch (e) { fallo(res, e, "obtener"); }
});

// Vuelve a consultar el SNIH ahora.
router.post("/arroyos/actualizar", requireAuth, soloConModulo, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await service.obtener({ forzar: true })); } catch (e) { fallo(res, e, "actualizar"); }
});

router.post("/arroyos/puntos", requireAuth, soloConModulo, json, async (req, res) => {
  try { res.status(201).json(await service.crearPunto(req.body || {})); } catch (e) { fallo(res, e, "crear"); }
});

router.put("/arroyos/puntos/:id", requireAuth, soloConModulo, json, async (req, res) => {
  try { res.json(await service.editarPunto(req.params.id, req.body || {})); } catch (e) { fallo(res, e, "editar"); }
});

router.delete("/arroyos/puntos/:id", requireAuth, soloConModulo, async (req, res) => {
  try { await service.borrarPunto(req.params.id); res.status(204).end(); } catch (e) { fallo(res, e, "borrar"); }
});

module.exports = router;
