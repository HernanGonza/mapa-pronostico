const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { pronosticoEnsamble, progresoEnsamble } = require("../lib/ensamble");
const { propuestaInforme } = require("../lib/informeEnsamble");
const { generarDocx } = require("../lib/informePronostico");

const router = express.Router();
// El superadmin y quienes tengan el módulo «ensamble» (ver pantalla Usuarios).
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

// Avance de lo que se descarga (WRF-SMN y MONAN): la pantalla lo mira sólo mientras dura una consulta.
router.get("/ensamble/progreso", requireAuth, soloConModulo, (req, res) => res.set("Cache-Control", "no-store").json(progresoEnsamble()));

// Informe de pronóstico (cajón del ensamble): valores propuestos a partir de los modelos elegidos...
router.post("/ensamble/informe/propuesta", requireAuth, soloConModulo, express.json({ limit: "100kb" }), async (req, res) => {
  const { emision, diaTablas, modelos } = req.body || {};
  try { res.set("Cache-Control", "no-store").json(await propuestaInforme({ emision, diaTablas, modelos: Array.isArray(modelos) ? modelos : [] })); }
  catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    console.error("[ensamble informe]", e); res.status(502).json({ error: `No se pudieron calcular los valores: ${e.cause?.code || e.message}.` });
  }
});

// ...y el .docx del informe, completando la plantilla con lo que se escribió en el asistente.
router.post("/ensamble/informe/docx", requireAuth, soloConModulo, express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const docx = await generarDocx(req.body);
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="PREVISION DEL TIEMPO ${req.body.emision.fecha}.docx"`, "Cache-Control": "no-store" });
    res.send(docx);
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    console.error("[ensamble informe docx]", e); res.status(500).json({ error: "No se pudo armar el informe." });
  }
});

module.exports = router;
