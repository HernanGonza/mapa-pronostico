const express = require("express");
const { solDeMunicipio } = require("../lib/solar");
const { lunaDeMunicipio } = require("../lib/luna");

const router = express.Router();

/** GET /api/sol/:municipioId?fecha=YYYY-MM-DD → { amanecer: "06:10", anochecer: "18:42" } (hora argentina). */
router.get("/sol/:municipioId", async (req, res) => {
  const datos = await solDeMunicipio(req.params.municipioId, req.query.fecha || undefined);
  if (!datos) return res.status(404).json({ error: "Sin datos solares" });
  res.set("Cache-Control", "public, max-age=86400");
  res.json(datos);
});

/** GET /api/luna/:municipioId?fecha=YYYY-MM-DD → { sale: "22:10", sePone: "11:05", fase: "Cuarto creciente", faseId, icono, iluminacion: 52 } (hora argentina). */
router.get("/luna/:municipioId", (req, res) => {
  const datos = lunaDeMunicipio(req.params.municipioId, req.query.fecha || undefined);
  if (!datos) return res.status(404).json({ error: "Sin datos de la luna" });
  res.set("Cache-Control", "public, max-age=86400");
  res.json(datos);
});

module.exports = router;
