const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { tiene } = require("../lib/modulos");
// Quien arma el informe («informes-diarios») o quien sólo maneja la tabla («tabla-precipitaciones»).
const requireModulo = (req, res, next) => (tiene(req.usuario, "informes-diarios") || tiene(req.usuario, "tabla-precipitaciones") ? next() : res.status(403).json({ error: "No tenés habilitado este módulo" }));
const tabla = require("../lib/precipitacionesTablaStore");

const router = express.Router();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const error = (res, e, texto) => { if (!e.status) console.error(e); const st = [400, 403, 404, 503].includes(e.status) ? e.status : 500; res.status(st).json({ error: st === 500 ? texto : e.message }); };
const num = (v, max = 5000) => (v == null || v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= -max && Number(v) <= max ? Math.round(Number(v) * 10) / 10 : undefined);
const texto = (v, max) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

const claveDe = (nombre) => `tabla-${nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
/** Una fila válida y redondeada, o null. Sin `clave` (carga a mano) se arma con el nombre de la estación. */
function limpiar(f) {
  const lluvia = num(f?.lluvia), max = num(f?.max), mes = num(f?.mes, 10000), media = num(f?.media, 10000), anomalia = num(f?.anomalia, 10000);
  const estacion = texto(f?.estacion, 120), red = texto(f?.red, 40), clave = texto(f?.clave, 80) || (estacion ? claveDe(estacion).slice(0, 80) : null);
  if (!clave || !estacion || !red || lluvia == null || [lluvia, max, mes, media, anomalia].includes(undefined)) return null;
  return { clave, estacion, red, fuente: texto(f.fuente, 120), lat: Number.isFinite(f.lat) && Math.abs(f.lat) <= 90 ? f.lat : null, lng: Number.isFinite(f.lng) && Math.abs(f.lng) <= 180 ? f.lng : null, lluvia, max, maxMinutos: f.maxMinutos === 60 ? 60 : max == null ? null : 30, mes, media, anomalia };
}

// Público — lo consume /embed/precipitaciones, sin sesión. Filtros: desde, hasta (AAAA-MM-DD), red, q.
router.get("/precipitaciones-tabla/publico", async (req, res) => {
  const { desde, hasta, red, q } = req.query;
  if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta))) return res.status(400).json({ error: "Fecha inválida." });
  try { res.set("Cache-Control", "no-store").json({ registros: await tabla.listar({ desde, hasta, red: texto(red, 40), q: texto(q, 80) }) }); }
  catch (e) { error(res, e, "No se pudo leer la tabla de precipitaciones."); }
});

// Carga las filas de un período (si ya estaban, las actualiza). Body: { desde, hasta, filas: [{ clave, estacion, red, fuente?, lat?, lng?, lluvia, max?, maxMinutos?, mes?, media?, anomalia? }] }
router.post("/precipitaciones-tabla", requireAuth, requireModulo, express.json({ limit: "500kb" }), async (req, res) => {
  const { desde, hasta, filas } = req.body || {};
  if (!FECHA.test(desde || "") || !FECHA.test(hasta || "") || hasta < desde) return res.status(400).json({ error: "El período no es válido." });
  if (!Array.isArray(filas) || !filas.length || filas.length > 300) return res.status(400).json({ error: "Faltan las estaciones (hasta 300)." });
  const limpias = [];
  for (const f of filas) {
    const l = limpiar(f);
    if (!l) return res.status(400).json({ error: `Datos inválidos en «${f?.estacion || "una estación"}».` });
    limpias.push(l);
  }
  try { res.json({ cargadas: await tabla.publicar({ desde, hasta, filas: limpias, usuarioId: req.usuario.usuarioId }) }); }
  catch (e) { error(res, e, "No se pudo cargar la tabla."); }
});

// Saca de la tabla un período entero. Body: { desde, hasta }
router.post("/precipitaciones-tabla/quitar", requireAuth, requireModulo, express.json(), async (req, res) => {
  const { desde, hasta } = req.body || {};
  if (!FECHA.test(desde || "") || !FECHA.test(hasta || "")) return res.status(400).json({ error: "El período no es válido." });
  try { res.json({ quitadas: await tabla.quitarPeriodo({ desde, hasta }) }); } catch (e) { error(res, e, "No se pudo quitar el período."); }
});

// Excel con lo mismo que lista el público (mismos filtros).
router.get("/precipitaciones-tabla/excel", async (req, res) => {
  const { desde, hasta, red, q } = req.query;
  if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta))) return res.status(400).json({ error: "Fecha inválida." });
  try {
    const registros = await tabla.listar({ desde, hasta, red: texto(red, 40), q: texto(q, 80) });
    const ExcelJS = require("exceljs"), libro = new ExcelJS.Workbook(), hoja = libro.addWorksheet("Precipitaciones");
    hoja.columns = [["Estación", 30], ["Red", 14], ["Desde", 12], ["Hasta", 12], ["Lluvia (mm)", 12], ["Máxima (mm)", 12], ["Ventana (min)", 12], ["Mes (mm)", 11], ["Media (mm)", 11], ["Anomalía (mm)", 13], ["Latitud", 11], ["Longitud", 11]].map(([header, width]) => ({ header, width }));
    hoja.getRow(1).font = { bold: true };
    hoja.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of registros) hoja.addRow([r.estacion, r.red, r.desde, r.hasta, r.lluvia, r.max, r.maxMinutos, r.mes, r.media, r.anomalia, r.lat, r.lng]);
    hoja.autoFilter = { from: "A1", to: "L1" };
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="precipitaciones-misiones.xlsx"', "Cache-Control": "no-store" });
    res.send(Buffer.from(await libro.xlsx.writeBuffer()));
  } catch (e) { error(res, e, "No se pudo armar el Excel."); }
});

const idDe = (req, res) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Id inválido." }); return null; } return id; };

// Agrega una fila a mano (estación + período). Si ya había una igual, la actualiza. Body: una fila de las de arriba más { desde, hasta }.
router.post("/precipitaciones-tabla/fila", requireAuth, requireModulo, express.json(), async (req, res) => {
  const { desde, hasta } = req.body || {}, f = limpiar(req.body);
  if (!FECHA.test(desde || "") || !FECHA.test(hasta || "") || hasta < desde) return res.status(400).json({ error: "El período no es válido." });
  if (!f) return res.status(400).json({ error: "Completá la estación, la red y la lluvia del período." });
  try { await tabla.publicar({ desde, hasta, filas: [f], usuarioId: req.usuario.usuarioId }); res.json({ ok: true }); } catch (e) { error(res, e, "No se pudo agregar la fila."); }
});

// Corrige una fila. Body: cualquiera de { estacion, red, desde, hasta, lluvia, max, maxMinutos, mes, media, anomalia }.
router.patch("/precipitaciones-tabla/:id", requireAuth, requireModulo, express.json(), async (req, res) => {
  const id = idDe(req, res); if (id == null) return;
  const b = req.body || {}, c = {};
  if ("estacion" in b) { c.estacion = texto(b.estacion, 120); if (!c.estacion) return res.status(400).json({ error: "Escribí la estación." }); }
  if ("red" in b) { c.red = texto(b.red, 40); if (!c.red) return res.status(400).json({ error: "Escribí la red." }); }
  for (const k of ["desde", "hasta"]) if (k in b) { if (!FECHA.test(b[k] || "")) return res.status(400).json({ error: "Fecha inválida." }); c[k] = b[k]; }
  if (c.desde && c.hasta && c.hasta < c.desde) return res.status(400).json({ error: "«Hasta» es anterior a «desde»." });
  for (const k of ["lluvia", "max", "mes", "media", "anomalia"]) if (k in b) { const v = num(b[k], k === "lluvia" || k === "max" ? 5000 : 10000); if (v === undefined || (k === "lluvia" && v == null)) return res.status(400).json({ error: `«${k}» no es un número válido.` }); c[k] = v; }
  for (const [k, lim] of [["lat", 90], ["lng", 180]]) if (k in b) { const v = b[k] == null || b[k] === "" ? null : Number(b[k]); if (v !== null && !(Number.isFinite(v) && Math.abs(v) <= lim)) return res.status(400).json({ error: `La ${k === "lat" ? "latitud" : "longitud"} no es válida.` }); c[k] = v; }
  if ("maxMinutos" in b) c.maxMinutos = b.maxMinutos === 60 ? 60 : b.maxMinutos == null ? null : 30;
  try { res.json(await tabla.actualizar(id, c)); } catch (e) { error(res, e, "No se pudo guardar el cambio."); }
});

router.delete("/precipitaciones-tabla/:id", requireAuth, requireModulo, async (req, res) => {
  const id = idDe(req, res); if (id == null) return;
  try { await tabla.quitar(id); res.json({ ok: true }); } catch (e) { error(res, e, "No se pudo quitar la fila."); }
});

module.exports = router;
