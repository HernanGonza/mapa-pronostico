const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { errorDePoligono, normalizarPoligono } = require("../lib/avisosCortoPlazo");
const avisos = require("../lib/avisosCortoPlazoStore");
const pendientes = require("../lib/placasPendientes");
const { generateAvisoCortoPlazoMap, errorDeAvisoCortoPlazoMap, TITULO } = require("../lib/generateAvisoCortoPlazoMap");

const router = express.Router();

// Genera feed + historias con el polígono real del CAP del SMN (o dibujado
// a mano si el SMN no trajo polígono), ya sobre el mapa con la capa de
// municipios — la captura viaja como PNG (`imagen`) y se dibuja en un
// recuadro fijo de la placa (ver generateAvisoCortoPlazoMap). El título es
// siempre el mismo (ya viene impreso en los fondos), no es editable. Se
// persiste todo en la base (polígono incluido).
router.post("/avisos-corto-plazo/generar", requireAuth, express.json({ limit: "8mb" }), async (req, res) => {
  const { poligono, texto, fondo, imagen, confirmarToken } = req.body || {};
  // Al confirmar (confirmarToken) no se vuelve a generar ni se manda `imagen`
  // de nuevo (placasPendientes.resolver persiste la vista previa ya hecha) —
  // sólo hace falta validar el polígono, que se guarda siempre en la base.
  const error = errorDePoligono(poligono) || (confirmarToken ? null : errorDeAvisoCortoPlazoMap(texto, fondo, imagen));
  if (error) return res.status(400).json({ error });
  try {
    const poligonoNorm = normalizarPoligono(poligono);
    await pendientes.resolver(req, res, {
      generar: async () => {
        const [feedPng, historiasPng] = await Promise.all([
          generateAvisoCortoPlazoMap({ texto, fondo, imagen, tamano: "feed" }),
          generateAvisoCortoPlazoMap({ texto, fondo, imagen, tamano: "historias" }),
        ]);
        return { feedPng, historiasPng };
      },
      guardar: (pngs) => avisos.crear({ poligono: poligonoNorm, titulo: TITULO, texto, fondo, usuarioId: req.usuario.usuarioId, ...pngs }),
    });
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
