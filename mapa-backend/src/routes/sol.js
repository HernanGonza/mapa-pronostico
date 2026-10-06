const express = require("express");
const { solDeMunicipio } = require("../lib/solar");

const router = express.Router();

/** GET /api/sol/:municipioId?fecha=YYYY-MM-DD → { amanecer: "06:10", anochecer: "18:42" } (hora argentina). */
router.get("/sol/:municipioId", async (req, res) => {
  const datos = await solDeMunicipio(req.params.municipioId, req.query.fecha || undefined);
  if (!datos) return res.status(404).json({ error: "Sin datos solares" });
  res.set("Cache-Control", "public, max-age=86400");
  res.json(datos);
});

module.exports = router;
