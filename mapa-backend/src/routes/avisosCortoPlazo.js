const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { errorDePoligono, normalizarPoligono } = require("../lib/avisosCortoPlazo");
const avisos = require("../lib/avisosCortoPlazoStore");
const pendientes = require("../lib/placasPendientes");
const { generateAvisoCortoPlazoMap, errorDeAvisoCortoPlazoMap, errorDePartes, normalizarPartes, textoDePartes, TITULO } = require("../lib/generateAvisoCortoPlazoMap");
const { colorDeAcp, nivelDeTitulo, intervalosAlertas } = require("../lib/colorAcp");

const router = express.Router();

/** Nivel del titular ("AVISO NARANJA…") del ACP del SMN `smnId` ("<id CAP>:<info>:<zona>"), o null. */
async function nivelDelSmn(smnId) {
  try {
    const { obtenerActual } = await import("../lib/smn/service.mjs");
    // El id del CAP ya trae ":" ("urn:oid:2.49…"): info y zona son los dos números del final.
    const m = /^(.+):(\d+):(\d+)$/.exec(smnId);
    if (!m) return null;
    const info = ((await obtenerActual()).fuentes.ACP?.alertas || []).find((a) => a.id === m[1])?.infos?.[Number(m[2])];
    return info ? nivelDeTitulo(info.titulo) || nivelDeTitulo(info.evento) : null;
  } catch (e) { console.error("[ACP] nivel del SMN:", e.message); return null; }
}

// Genera feed + historias con el polígono real del CAP del SMN (o dibujado
// a mano si el SMN no trajo polígono): el mapa se dibuja entero en el
// backend, sobre el mismo mapa vectorial que usa Alerta Meteorológica, con
// el polígono encima (ver generateAvisoCortoPlazoMap) — no una captura de
// pantalla. El título es siempre el mismo (ya viene impreso en los
// fondos), no es editable. Se persiste todo en la base (polígono incluido).
router.post("/avisos-corto-plazo/generar", requireAuth, express.json({ limit: "256kb" }), async (req, res) => {
  // `partes` (fenómeno, emisión, validez, zonas): el aviso como lo arma el asistente, paso por
  // paso. Sin `partes`, `texto` libre como antes.
  const { poligono, fondo, confirmarToken } = req.body || {};
  const partesError = req.body?.partes != null ? errorDePartes(req.body.partes) : null;
  if (partesError) return res.status(400).json({ error: partesError });
  const partes = req.body?.partes != null ? normalizarPartes(req.body.partes) : null;
  const texto = partes ? textoDePartes(partes) : req.body?.texto;
  // Id del aviso del SMN del que sale la placa (null si se dibujó a mano).
  const smnId = typeof req.body?.smnId === "string" && req.body.smnId.length <= 300 ? req.body.smnId : null;
  const error = errorDePoligono(poligono) || (confirmarToken ? null : errorDeAvisoCortoPlazoMap(texto, fondo));
  if (error) return res.status(400).json({ error });
  try {
    const poligonoNorm = normalizarPoligono(poligono);
    const nivel = smnId ? await nivelDelSmn(smnId) : null;
    // El polígono, el título y el fenómeno van del color del nivel del aviso del SMN (su titular)
    // o, si no lo dice, del de la alerta vigente ahora (violeta si no hay ninguna). Se guarda con
    // qué nivel salió y de dónde.
    const { nivel: nivelPlaca, color } = colorDeAcp(await intervalosAlertas(), new Date().toISOString(), undefined, nivel);
    const nivelOrigen = nivel ? "titular" : nivelPlaca ? "alerta" : null;
    await pendientes.resolver(req, res, {
      generar: async () => {
        const [feedPng, historiasPng] = await Promise.all([
          generateAvisoCortoPlazoMap({ texto, partes, fondo, poligono: poligonoNorm, tamano: "feed", color }),
          generateAvisoCortoPlazoMap({ texto, partes, fondo, poligono: poligonoNorm, tamano: "historias", color }),
        ]);
        return { feedPng, historiasPng };
      },
      guardar: (pngs) => avisos.crear({ poligono: poligonoNorm, titulo: TITULO, texto, partes, fondo, smnId, nivel, nivelPlaca, nivelOrigen, usuarioId: req.usuario.usuarioId, ...pngs }),
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
    // Cada uno con el color de la alerta en cuya vigencia cae (ver colorAcp.js).
    const [vigentes, intervalos] = await Promise.all([avisos.obtenerVigentes(), intervalosAlertas()]);
    res.set("Cache-Control", "no-store").json({ avisos: vigentes.map((a) => ({ ...a, ...colorDeAcp(intervalos, a.publicadoEn, a.vigenteHasta, a.nivelSmn) })) });
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
