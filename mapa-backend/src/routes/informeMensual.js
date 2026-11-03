const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { tiene } = require("../lib/modulos");
const { errorDeInformeMensual, normalizarInformeMensual, MESES } = require("../lib/informeMensual");
const { generarInformeMensualPdf } = require("../lib/informeMensualPdf");
const guardados = require("../lib/informesMensualesStore");
const semanales = require("../lib/informesSemanalesStore");
const eventos = require("../lib/informeEventos");
const { generarInformeEventosPdf, subtituloDe } = require("../lib/informeEventosPdf");

/** Informe mensual (módulo «informe-mensual»): se guarda uno por mes y año, y se baja en PDF con el formato de los informes de la DGAT. */
const router = express.Router();
const requireModulo = (req, res, next) => (tiene(req.usuario, "informe-mensual") ? next() : res.status(403).json({ error: "No tenés habilitado este módulo" }));
const json = express.json({ limit: "40mb" }); // las imágenes de los mapas viajan dentro del informe
const quien = (req) => req.usuario?.nombre || req.usuario?.email || null;
const periodo = (req, res) => {
  const anio = Number(req.params.anio), mes = Number(req.params.mes);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) { res.status(400).json({ error: "El mes o el año no son válidos." }); return null; }
  return { anio, mes };
};
const falla = (res, e, texto) => { if (!e.status) console.error("[informe-mensual]", e); res.status(e.status || 500).json({ error: e.status ? e.message : texto }); };

router.get("/informe-mensual", requireAuth, requireModulo, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json({ informes: await guardados.listar() }); } catch (e) { falla(res, e, "No se pudieron leer los informes."); }
});

router.get("/informe-mensual/:anio/:mes", requireAuth, requireModulo, async (req, res) => {
  const p = periodo(req, res); if (!p) return;
  try {
    const r = await guardados.obtener(p.anio, p.mes);
    if (!r) return res.status(404).json({ error: "Todavía no hay un informe de ese mes." });
    res.set("Cache-Control", "no-store").json(r);
  } catch (e) { falla(res, e, "No se pudo leer el informe."); }
});

router.put("/informe-mensual/:anio/:mes", requireAuth, requireModulo, json, async (req, res) => {
  const p = periodo(req, res); if (!p) return;
  const b = { ...req.body?.borrador, ...p };
  const error = errorDeInformeMensual(b);
  if (error) return res.status(400).json({ error });
  try { res.json(await guardados.guardar(p.anio, p.mes, normalizarInformeMensual(b), quien(req))); } catch (e) { falla(res, e, "No se pudo guardar el informe."); }
});

router.delete("/informe-mensual/:anio/:mes", requireAuth, requireModulo, async (req, res) => {
  const p = periodo(req, res); if (!p) return;
  try { res.json({ borrado: await guardados.borrar(p.anio, p.mes) }); } catch (e) { falla(res, e, "No se pudo borrar el informe."); }
});

// --- Informe semanal: mismas partes que el mensual, con todos los títulos editables; uno por semana (se identifica por el día en que empieza) ---
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const semana = (req, res) => {
  const desde = String(req.params.desde || "");
  if (!RE_FECHA.test(desde) || Number.isNaN(Date.parse(desde))) { res.status(400).json({ error: "La fecha no es válida." }); return null; }
  return desde;
};
router.get("/informe-semanal", requireAuth, requireModulo, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json({ informes: await semanales.listar() }); } catch (e) { falla(res, e, "No se pudieron leer los informes."); }
});
router.get("/informe-semanal/:desde", requireAuth, requireModulo, async (req, res) => {
  const desde = semana(req, res); if (!desde) return;
  try {
    const r = await semanales.obtener(desde);
    if (!r) return res.status(404).json({ error: "Todavía no hay un informe de esa semana." });
    res.set("Cache-Control", "no-store").json(r);
  } catch (e) { falla(res, e, "No se pudo leer el informe."); }
});
router.put("/informe-semanal/:desde", requireAuth, requireModulo, json, async (req, res) => {
  const desde = semana(req, res); if (!desde) return;
  const b = { ...req.body?.borrador, tipo: "semanal", desde };
  const error = errorDeInformeMensual(b);
  if (error) return res.status(400).json({ error });
  try { res.json(await semanales.guardar(desde, normalizarInformeMensual(b), quien(req))); } catch (e) { falla(res, e, "No se pudo guardar el informe."); }
});
router.delete("/informe-semanal/:desde", requireAuth, requireModulo, async (req, res) => {
  const desde = semana(req, res); if (!desde) return;
  try { res.json({ borrado: await semanales.borrar(desde) }); } catch (e) { falla(res, e, "No se pudo borrar el informe."); }
});

// --- Resumen de eventos del mes o de la semana (ACP, alertas, avisos…), leído de la base ---
router.get("/informe-eventos", requireAuth, requireModulo, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await eventos.reunir(String(req.query.desde || ""), String(req.query.hasta || ""))); } catch (e) { falla(res, e, "No se pudieron leer los eventos."); }
});
router.post("/informe-eventos/pdf", requireAuth, requireModulo, json, async (req, res) => {
  try {
    const { desde, hasta } = req.body || {};
    const pdf = await generarInformeEventosPdf(await eventos.reunir(String(desde || ""), String(hasta || "")));
    const nombre = `EVENTOS ${subtituloDe(desde, hasta).replace(/^DEL /, "").replace(/\//g, "-")}`;
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nombre}.pdf"`, "Cache-Control": "no-store" }).send(pdf);
  } catch (e) { falla(res, e, "No se pudo armar el PDF."); }
});

/** body: { borrador } → el PDF (cifrado y con marca de agua), aunque el borrador esté incompleto. */
router.post("/informe-mensual/pdf", requireAuth, requireModulo, json, async (req, res) => {
  try {
    const b = req.body?.borrador;
    const pdf = await generarInformeMensualPdf(b);
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${b.tipo === "semanal" ? `BALANCE SEMANA ${b.desde}` : `BALANCE ${MESES[b.mes - 1].toUpperCase()} ${b.anio}`}.pdf"`, "Cache-Control": "no-store" }).send(pdf);
  } catch (e) { falla(res, e, "No se pudo armar el PDF."); }
});

module.exports = router;
