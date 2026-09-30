const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const publicadas = require("../lib/alertasSmnPublicadasStore");

const router = express.Router();

const error = (res, e, texto) => {
  if (!e.status) console.error(e);
  const status = [400, 404, 503].includes(e.status) ? e.status : 500;
  res.status(status).json({ error: status === 500 ? texto : e.message });
};

// Publica en el embebido una alerta SAT vigente del SMN. Se busca en lo que el
// backend ya tiene del SMN (no se confía en lo que manda el navegador) y se
// guarda una copia; queda visible hasta el fin de la alerta.
router.post("/alertas-meteorologicas/smn/publicar", requireAuth, express.json(), async (req, res) => {
  const smnId = req.body?.smnId;
  if (typeof smnId !== "string" || !smnId.includes(":") || smnId.length > 300) return res.status(400).json({ error: "Alerta inválida." });
  try {
    const { obtenerActual } = await import("../lib/smn/service.mjs");
    const actual = await obtenerActual();
    res.json(await publicadas.publicar(smnId, actual.fuentes.SAT?.alertas || [], req.usuario.usuarioId, actual.colores));
  } catch (e) { error(res, e, "No se pudo publicar la alerta."); }
});

router.post("/alertas-meteorologicas/smn/publicadas/:id/despublicar", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido." });
  try { await publicadas.despublicar(id); res.json({ ok: true }); }
  catch (e) { error(res, e, "No se pudo despublicar la alerta."); }
});

// Público: lo consume el iframe de alertas meteorológicas. [] = ninguna vigente.
router.get("/alertas-meteorologicas/smn/publicadas", async (req, res) => {
  try {
    const alertas = (await publicadas.obtenerVigentes()).map(({ publicadoPorEmail, ...a }) => a);
    res.set("Cache-Control", "no-store").json({ alertas });
  } catch (e) { error(res, e, "No se pudieron leer las alertas publicadas."); }
});

// Panel: las mismas, con quién las publicó.
router.get("/alertas-meteorologicas/smn/publicadas/panel", requireAuth, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json({ alertas: await publicadas.obtenerVigentes() }); }
  catch (e) { error(res, e, "No se pudieron leer las alertas publicadas."); }
});

module.exports = router;
