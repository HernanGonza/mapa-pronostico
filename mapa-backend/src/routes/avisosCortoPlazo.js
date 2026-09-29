const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { errorDePoligono, normalizarPoligono } = require("../lib/avisosCortoPlazo");
const avisos = require("../lib/avisosCortoPlazoStore");
const pendientes = require("../lib/placasPendientes");
const { generateAvisoCortoPlazoMap, errorDeAvisoCortoPlazoMap, TITULO } = require("../lib/generateAvisoCortoPlazoMap");

const router = express.Router();

// Genera feed + historias con el polígono real del CAP del SMN (o dibujado
// a mano si el SMN no trajo polígono): el mapa se dibuja entero en el
// backend, sobre el mismo mapa vectorial que usa Alerta Meteorológica, con
// el polígono encima (ver generateAvisoCortoPlazoMap) — no una captura de
// pantalla. El título es siempre el mismo (ya viene impreso en los
// fondos), no es editable. Se persiste todo en la base (polígono incluido).
router.post("/avisos-corto-plazo/generar", requireAuth, express.json({ limit: "256kb" }), async (req, res) => {
  const { poligono, texto, fondo, confirmarToken } = req.body || {};
  // Id del aviso del SMN del que sale la placa (null si se dibujó a mano).
  const smnId = typeof req.body?.smnId === "string" && req.body.smnId.length <= 300 ? req.body.smnId : null;
  const error = errorDePoligono(poligono) || (confirmarToken ? null : errorDeAvisoCortoPlazoMap(texto, fondo));
  if (error) return res.status(400).json({ error });
  try {
    const poligonoNorm = normalizarPoligono(poligono);
    await pendientes.resolver(req, res, {
      generar: async () => {
        const [feedPng, historiasPng] = await Promise.all([
          generateAvisoCortoPlazoMap({ texto, fondo, poligono: poligonoNorm, tamano: "feed" }),
          generateAvisoCortoPlazoMap({ texto, fondo, poligono: poligonoNorm, tamano: "historias" }),
        ]);
        return { feedPng, historiasPng };
      },
      guardar: (pngs) => avisos.crear({ poligono: poligonoNorm, titulo: TITULO, texto, fondo, smnId, usuarioId: req.usuario.usuarioId, ...pngs }),
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

// Publica un aviso ya generado en el mapa público (/embed/avisos-corto-plazo)
// hasta `vigenteHasta` (ISO): pasada esa hora deja de mostrarse solo.
router.post("/avisos-corto-plazo/:id/publicar", requireAuth, express.json(), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido." });
  try {
    res.json(await avisos.publicar(id, req.body?.vigenteHasta));
  } catch (e) {
    if (!e.status) console.error(e);
    const status = [400, 404, 503].includes(e.status) ? e.status : 500;
    res.status(status).json({ error: status === 500 ? "No se pudo publicar el aviso." : e.message });
  }
});

// Lo saca del mapa público antes de que venza.
router.post("/avisos-corto-plazo/:id/despublicar", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido." });
  try {
    await avisos.despublicar(id);
    res.json({ ok: true });
  } catch (e) {
    if (!e.status) console.error(e);
    const status = [404, 503].includes(e.status) ? e.status : 500;
    res.status(status).json({ error: status === 500 ? "No se pudo despublicar el aviso." : e.message });
  }
});

// GET público — lo consume el iframe embebible, sin sesión. Lista vacía = no
// hay avisos vigentes (el iframe muestra "Sin avisos a muy corto plazo").
router.get("/avisos-corto-plazo/vigentes", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store").json({ avisos: await avisos.obtenerVigentes() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudieron leer los avisos vigentes." });
  }
});

router.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "El pedido es demasiado grande." });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "El contenido enviado no es válido." });
  next(err);
});

module.exports = router;
