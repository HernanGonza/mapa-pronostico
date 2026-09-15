const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { errorDePoligono, normalizarPoligono } = require("../lib/avisosCortoPlazo");
const avisos = require("../lib/avisosCortoPlazoStore");

const router = express.Router();
const TITULO_PREDETERMINADO = "Aviso a muy corto plazo";

// Genera feed + historias con el mismo motor de texto libre que
// "Recomendaciones" (generateAlertaMap.generateRecomendaciones) — el mapa
// dibujado (municipios + polígono) viaja como captura PNG (`imagen`) y
// queda arriba del texto en la placa, igual que la imagen opcional de
// recomendaciones. También se persiste todo en la base (polígono incluido).
router.post("/avisos-corto-plazo/generar", requireAuth, express.json({ limit: "8mb" }), async (req, res) => {
  const { poligono, titulo, texto, fondo, imagen } = req.body || {};
  const { generateRecomendaciones, errorDeRecomendaciones } = require("../lib/generateAlertaMap");
  const tituloFinal = !titulo ? TITULO_PREDETERMINADO : titulo;
  const error = errorDePoligono(poligono) || errorDeRecomendaciones(texto, fondo, imagen || null, tituloFinal);
  if (error) return res.status(400).json({ error });
  try {
    const poligonoNorm = normalizarPoligono(poligono);
    const [feedPng, historiasPng] = await Promise.all([
      generateRecomendaciones({ texto, fondo, titulo: tituloFinal, imagen: imagen || null, tamano: "feed" }),
      generateRecomendaciones({ texto, fondo, titulo: tituloFinal, imagen: imagen || null, tamano: "historias" }),
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

// Marca un aviso ya generado como el que se muestra en el mapa público
// (/embed/avisos-corto-plazo) — mismo criterio de "publicar" que el resto
// de las pantallas del panel.
router.post("/avisos-corto-plazo/:id/publicar", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido." });
  try {
    res.json(await avisos.publicar(id));
  } catch (e) {
    console.error(e);
    const status = [400, 404, 503].includes(e.status) ? e.status : 500;
    res.status(status).json({ error: status === 500 ? "No se pudo publicar el aviso." : e.message });
  }
});

// GET público — lo consume el iframe embebible, sin sesión.
router.get("/avisos-corto-plazo/actual", async (req, res) => {
  try {
    const actual = await avisos.obtenerActual();
    if (!actual) return res.status(404).json({ error: "Todavía no se publicó ningún aviso." });
    res.set("Cache-Control", "no-store").json(actual);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "La captura del mapa es demasiado grande." });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "El contenido enviado no es válido." });
  next(err);
});

module.exports = router;
