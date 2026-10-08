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
    res.json(await require("../lib/alertasSmnAuto").publicarOActualizar(smnId, actual.fuentes.SAT?.alertas || [], req.usuario.usuarioId, actual.colores));
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

// Panel: las mismas, con quién las publicó y las placas que se generaron de cada una.
router.get("/alertas-meteorologicas/smn/publicadas/panel", requireAuth, async (req, res) => {
  try {
    const alertas = await publicadas.obtenerVigentes();
    const placas = await publicadas.placasDe(alertas.map((a) => a.id));
    // Qué dice hoy el SMN de cada una (¿la actualizó?): ver alertasSmnAuto.estado.
    const { obtenerActual } = await import("../lib/smn/service.mjs");
    const hoy = require("../lib/alertasSmnAuto").estado(alertas, (await obtenerActual()).fuentes.SAT?.alertas || []);
    const departamentos = require("../lib/departamentos").loadDepartamentos();
    res.set("Cache-Control", "no-store").json({ alertas: alertas.map((a) => ({ ...a, placas: placas[a.id] || [], mapaBase: require("../lib/alertasSmnAuto").mapaDe(a, departamentos), smnIdActual: hoy.get(a.id)?.smnIdActual || null, actualizacion: hoy.get(a.id)?.tipos.length ? { tipos: hoy.get(a.id).tipos } : null })) });
  }
  catch (e) { error(res, e, "No se pudieron leer las alertas publicadas."); }
});

// Placas de una alerta del SMN ya publicada: las mismas que las de las alertas manuales (mapa, vigencia,
// recomendaciones, aviso de alerta, actualización de nivel), con los asistentes del panel manual.
// Vista previa y después confirmar, igual que allá. `reemplaza`: id de la placa que se está editando.
const vigente = async (id) => (await publicadas.obtenerVigentes()).find((a) => a.id === id);
const idDe = (req, res) => { const id = Number(req.params.id); if (Number.isInteger(id) && id > 0) return id; res.status(400).json({ error: "Id inválido." }); return null; };

router.post("/alertas-meteorologicas/smn/publicadas/:id/placas", requireAuth, express.json({ limit: "4mb" }), async (req, res) => {
  const id = idDe(req, res); if (!id) return;
  const { generarPlacaAlertaAmbos, errorDePlacaAlerta, normalizarPlacaAlerta } = require("../lib/generatePlacasAlerta");
  const { errorDePlacaMapa, normalizarPlacaMapa, generarPlacaMapa } = require("./alertasMeteorologicas").placaMapa;
  const { tipo, nivel, datos, reemplaza = null } = req.body || {};
  const problema = (tipo === "mapa" ? errorDePlacaMapa(datos) : errorDePlacaAlerta({ tipo, nivel, datos }))
    || (reemplaza !== null && (!Number.isInteger(reemplaza) || reemplaza <= 0) ? "Placa a editar inválida." : null);
  if (problema) return res.status(400).json({ error: problema });
  try {
    if (!(await vigente(id))) return res.status(404).json({ error: "Esa alerta ya no está publicada." });
    const placa = tipo === "mapa" ? normalizarPlacaMapa(datos) : normalizarPlacaAlerta({ tipo, nivel, datos });
    await require("../lib/placasPendientes").resolver(req, res, {
      generar: () => (tipo === "mapa" ? generarPlacaMapa(placa.datos) : generarPlacaAlertaAmbos(placa)),
      guardar: (pngs) => (reemplaza
        ? publicadas.reemplazarPlaca({ id: reemplaza, alertaId: id, ...placa, usuarioId: req.usuario.usuarioId, ...pngs })
        : publicadas.crearPlaca({ alertaId: id, motivo: "manual", ...placa, usuarioId: req.usuario.usuarioId, ...pngs })),
    });
  } catch (e) { error(res, e, "No se pudo generar la placa."); }
});

// Con qué arrancan los asistentes: los textos, niveles y horarios que trae el SMN (ver alertasSmnAuto.baseDe).
router.get("/alertas-meteorologicas/smn/publicadas/:id/placas/base", requireAuth, async (req, res) => {
  const id = idDe(req, res); if (!id) return;
  try {
    const alerta = await vigente(id);
    if (!alerta) return res.status(404).json({ error: "Esa alerta ya no está publicada." });
    res.set("Cache-Control", "no-store").json(require("../lib/alertasSmnAuto").baseDe(alerta, require("../lib/generatePlacasAlerta")));
  } catch (e) { error(res, e, "No se pudieron preparar las placas."); }
});

// Saca una placa de la tarjeta (queda en la base). No la borra de las redes.
router.delete("/alertas-meteorologicas/smn/placas/:id", requireAuth, async (req, res) => {
  const id = idDe(req, res); if (!id) return;
  try { await publicadas.eliminarPlaca(id); res.json({ ok: true }); }
  catch (e) { error(res, e, "No se pudo eliminar la placa."); }
});

module.exports = router;
