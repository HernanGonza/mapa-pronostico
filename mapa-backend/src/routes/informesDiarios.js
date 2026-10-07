const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { recolectar, errorDeConsulta } = require("../lib/informesDiarios");
const informes = require("../lib/informesDiariosStore");

const requireRole = require("../middleware/requireRole");

const router = express.Router();
// En desarrollo: el superadmin y quienes tengan el módulo «informes-diarios» (ver pantalla Usuarios).
const soloSuperadmin = require("../middleware/requireModulo")("informes-diarios");
const error = (res, e, texto) => { if (!e.status) console.error(e); const st = [400, 403, 404, 503].includes(e.status) ? e.status : 500; res.status(st).json({ error: st === 500 ? texto : e.message }); };

// Junta los datos de un rango (no guarda nada): { fecha: "AAAA-MM-DD", desde: "HH:MM", fechaHasta?: "AAAA-MM-DD", hasta: "HH:MM" }
// (sin fechaHasta, el mismo día). Ej.: ayer 00:00 → hoy 09:00.
router.post("/informes-diarios/recolectar", requireAuth, soloSuperadmin, express.json(), async (req, res) => {
  const { fecha, fechaHasta = fecha, desde = "00:00", hasta = "23:59" } = req.body || {};
  const e = errorDeConsulta({ fecha, fechaHasta, desde, hasta });
  if (e) return res.status(400).json({ error: e });
  try { res.set("Cache-Control", "no-store").json(await recolectar({ fecha, fechaHasta, desde, hasta })); }
  catch (err) { error(res, err, "No se pudieron juntar los datos de las estaciones."); }
});

// Excel con todo lo que trajeron las estaciones, en crudo. Body: { datos } (lo juntado, con `crudo`)
// o { fecha, desde, hasta } para juntarlo en el momento (también si `datos` es de antes del crudo).
router.post("/informes-diarios/excel", requireAuth, soloSuperadmin, express.json({ limit: "12mb" }), async (req, res) => {
  try {
    let datos = req.body?.datos;
    const tieneCrudo = datos?.estaciones?.some((e) => Array.isArray(e.crudo));
    if (!tieneCrudo) {
      const { fecha, fechaHasta = fecha, desde = "00:00", hasta = "23:59" } = datos || req.body || {};
      const e = errorDeConsulta({ fecha, fechaHasta, desde, hasta });
      if (e) return res.status(400).json({ error: e });
      datos = await recolectar({ fecha, fechaHasta, desde, hasta });
    }
    const buffer = await require("../lib/informesDiariosExcel").armarExcel(datos);
    const fin = datos.fechaHasta || datos.fecha, hhmm = (h) => h.replace(":", "");
    const nombre = fin !== datos.fecha ? `informe-${datos.fecha}-${hhmm(datos.desde)}-a-${fin}-${hhmm(datos.hasta)}.xlsx`
      : `informe-diario-${datos.fecha}${datos.desde !== "00:00" || datos.hasta !== "23:59" ? `-${hhmm(datos.desde)}-${hhmm(datos.hasta)}` : ""}.xlsx`;
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${nombre}"`, "Cache-Control": "no-store" });
    res.send(Buffer.from(buffer));
  } catch (err) { error(res, err, "No se pudo armar el Excel."); }
});

router.get("/informes-diarios", requireAuth, soloSuperadmin, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json({ informes: await informes.listar() }); } catch (e) { error(res, e, "No se pudieron leer los informes."); }
});
router.get("/informes-diarios/:id", requireAuth, soloSuperadmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido." });
  try { res.set("Cache-Control", "no-store").json(await informes.obtener(id)); } catch (e) { error(res, e, "No se pudo leer el informe."); }
});
// Guarda (o, con `id`, actualiza) un informe: { id?, fecha, fechaHasta?, desde, hasta, titulo, resumen, datos }.
router.post("/informes-diarios", requireAuth, soloSuperadmin, express.json({ limit: "12mb" }), async (req, res) => {
  const { id = null, fecha, fechaHasta = fecha, desde, hasta, titulo, resumen, datos } = req.body || {};
  const e = errorDeConsulta({ fecha, fechaHasta, desde, hasta }) || (typeof titulo !== "string" || !titulo.trim() || titulo.length > 160 ? "Escribí el título del informe." : null)
    || (typeof resumen !== "string" || !resumen.trim() || resumen.length > 8000 ? "Escribí el texto del informe (hasta 8000 caracteres)." : null)
    || (!datos || typeof datos !== "object" ? "Faltan los datos del informe." : null)
    || (id !== null && (!Number.isInteger(id) || id <= 0) ? "Id inválido." : null);
  if (e) return res.status(400).json({ error: e });
  try { res.json(await informes.guardar({ id, fecha, fechaHasta, desde, hasta, titulo: titulo.trim(), resumen: resumen.trim(), datos, usuarioId: req.usuario.usuarioId })); }
  catch (err) { error(res, err, "No se pudo guardar el informe."); }
});

module.exports = router;
