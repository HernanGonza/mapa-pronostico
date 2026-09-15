const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { errorDePoligono, normalizarPoligono } = require("../lib/avisosCortoPlazo");
const avisos = require("../lib/avisosCortoPlazoStore");

const router = express.Router();
const TITULO_PREDETERMINADO = "Aviso a muy corto plazo";

// Genera feed + historias con el mismo motor de texto libre que
// "Recomendaciones" (generateAlertaMap.generateRecomendaciones) — el
// polígono dibujado es sólo referencia para escribir el texto, no se
// publica ni se dibuja en la placa. A diferencia de recomendaciones, acá
// sí se persiste todo (polígono incluido).
router.post("/avisos-corto-plazo/generar", requireAuth, express.json({ limit: "1mb" }), async (req, res) => {
  const { poligono, titulo, texto, fondo } = req.body || {};
  const { generateRecomendaciones, errorDeRecomendaciones } = require("../lib/generateAlertaMap");
  const tituloFinal = !titulo ? TITULO_PREDETERMINADO : titulo;
  const error = errorDePoligono(poligono) || errorDeRecomendaciones(texto, fondo, null, tituloFinal);
  if (error) return res.status(400).json({ error });
  try {
    const poligonoNorm = normalizarPoligono(poligono);
    const [feedPng, historiasPng] = await Promise.all([
      generateRecomendaciones({ texto, fondo, titulo: tituloFinal, tamano: "feed" }),
      generateRecomendaciones({ texto, fondo, titulo: tituloFinal, tamano: "historias" }),
    ]);
    const placa = await avisos.crear({
      poligono: poligonoNorm,
      titulo: tituloFinal,
      texto,
      fondo,
      usuarioId: req.usuario.usuarioId,
      feedPng,
      historiasPng,
    });
    res.set("Cache-Control", "no-store").json(placa);
  } catch (e) {
    console.error(e);
    const status = [400, 503].includes(e.status) ? e.status : 500;
    res.status(status).json({ error: status === 500 ? "No se pudo generar el aviso." : e.message });
  }
});

router.get("/avisos-corto-plazo/historial", requireAuth, async (req, res) => {
  try {
    res.json({ historial: await avisos.obtenerHistorial() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "El contenido enviado no es válido." });
  next(err);
});

module.exports = router;
