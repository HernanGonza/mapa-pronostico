const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { pronosticoEnsamble, progresoWrf } = require("../lib/ensamble");

const router = express.Router();
// En desarrollo: el superadmin y quienes tengan el módulo «ensamble» (ver pantalla Usuarios).
const soloConModulo = require("../middleware/requireModulo")("ensamble");

// Lo que dice cada modelo en el centroide de cada uno de los 17 departamentos, entre ?desde= y ?hasta=
// («AAAA-MM-DDTHH:MM», hora de Misiones). Se consulta en el momento, cada vez: no hay caché.
router.get("/ensamble", requireAuth, soloConModulo, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await pronosticoEnsamble({ desde: req.query.desde, hasta: req.query.hasta, modelos: String(req.query.modelos || "").split(",").filter(Boolean) })); }
  catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    console.error("[ensamble]", e); res.status(502).json({ error: `No se pudo consultar a los modelos: ${e.cause?.code || e.message}. Probá de nuevo en unos minutos.` });
  }
});

// Avance de la descarga del WRF-SMN (la pantalla lo mira sólo mientras dura una consulta).
router.get("/ensamble/progreso", requireAuth, soloConModulo, (req, res) => res.set("Cache-Control", "no-store").json(progresoWrf()));

module.exports = router;
