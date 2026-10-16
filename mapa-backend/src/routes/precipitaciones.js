const express = require("express");
const multer = require("multer");
const requireAuth = require("../middleware/requireAuth");
const { tiene } = require("../lib/modulos");
const planilla = require("../lib/precipitacionesStore");
const { leerExcel } = require("../lib/precipitacionesImportar");
const { armarExcel } = require("../lib/precipitacionesExcel");

const router = express.Router();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const requireModulo = (req, res, next) => (tiene(req.usuario, "tabla-precipitaciones") ? next() : res.status(403).json({ error: "No tenés habilitado este módulo" }));
const error = (res, e, texto) => { if (!e.status) console.error(e); const st = [400, 403, 404, 503].includes(e.status) ? e.status : 500; res.status(st).json({ error: st === 500 ? texto : e.message }); };
const fechaValida = (f) => FECHA.test(f || "") && !Number.isNaN(Date.parse(f)) && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f;
const dias = (d, h) => (Date.parse(h) - Date.parse(d)) / 864e5;
const idDe = (req, res) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Id inválido." }); return null; } return id; };
const num = (v, max) => (v == null || v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Math.round(Number(v) * 10) / 10 : undefined);
const coord = (v, lim) => (v == null || v === "" ? null : Number.isFinite(Number(v)) && Math.abs(Number(v)) <= lim ? Number(v) : undefined);
const texto = (v, max) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

// Estaciones con sus medias y los mm de cada día entre desde y hasta (hasta 800 días). Sin rango, sólo las estaciones.
// Público (lo usan /embed/precipitaciones y el mapa, sin sesión): lo PUBLICADO. Con sesión y módulo, /borrador: lo que se está cargando.
const datosDe = (borrador) => async (req, res) => {
  const { desde, hasta } = req.query;
  if (desde || hasta) {
    if (!fechaValida(desde) || !fechaValida(hasta) || hasta < desde || dias(desde, hasta) > 800) return res.status(400).json({ error: "El rango de fechas no es válido (hasta 800 días)." });
  }
  try { res.set("Cache-Control", "no-store").json(await planilla.datos({ desde, hasta, borrador })); }
  catch (e) { error(res, e, "No se pudo leer la planilla de precipitaciones."); }
};
router.get("/precipitaciones/datos", datosDe(false));
router.get("/precipitaciones/borrador", requireAuth, requireModulo, datosDe(true));

// Cuándo se publicó por última vez y cuántos cambios hay sin publicar; y publicar (copia el borrador a la tabla y el mapa públicos).
router.get("/precipitaciones/publicacion", requireAuth, requireModulo, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await planilla.estadoPublicacion()); } catch (e) { error(res, e, "No se pudo leer el estado de la publicación."); }
});
router.post("/precipitaciones/publicar", requireAuth, requireModulo, async (req, res) => {
  try { res.json(await planilla.publicar(req.usuario.usuarioId)); } catch (e) { error(res, e, "No se pudo publicar."); }
});

// Excel con fórmulas. ?desde&hasta (las hojas de los meses que toca el rango), ?estaciones=1,2,3 (sólo esas; sin lista, las activas) y ?informe=1 (hoja con el período).
const excelDe = (borrador) => async (req, res) => {
  const { desde, hasta, estaciones: ids, informe } = req.query;
  if (!fechaValida(desde) || !fechaValida(hasta) || hasta < desde || dias(desde, hasta) > 800) return res.status(400).json({ error: "El rango de fechas no es válido (hasta 800 días)." });
  const lista = ids ? String(ids).split(",").map(Number) : null;
  if (lista && (lista.length > 200 || lista.some((x) => !Number.isInteger(x) || x <= 0))) return res.status(400).json({ error: "La lista de estaciones no es válida." });
  try {
    const [a, m] = [desde.slice(0, 4), desde.slice(5, 7)], [fa, fm] = [hasta.slice(0, 4), hasta.slice(5, 7)];
    const inicioMes = `${a}-${m}-01`, finMes = `${fa}-${fm}-31`.replace(/-31$/, `-${String(new Date(Number(fa), Number(fm), 0).getDate()).padStart(2, "0")}`);
    const { estaciones, diarias } = await planilla.datos({ desde: inicioMes, hasta: finMes, borrador });
    const elegidas = lista ? lista.map((id) => estaciones.find((e) => e.id === id)).filter(Boolean) : estaciones.filter((e) => e.activa);
    if (!elegidas.length) return res.status(400).json({ error: "No hay estaciones para exportar." });
    const buffer = await armarExcel({ estaciones: elegidas, todas: estaciones, diarias, desde, hasta, informe: informe === "1" });
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="precipitaciones-${desde}-a-${hasta}.xlsx"`, "Cache-Control": "no-store" });
    res.send(Buffer.from(buffer));
  } catch (e) { error(res, e, "No se pudo armar el Excel."); }
};
router.get("/precipitaciones/excel", excelDe(false)); // lo publicado
router.get("/precipitaciones/excel-borrador", requireAuth, requireModulo, excelDe(true)); // lo que se está cargando (informe del panel)

// --- Con sesión y módulo ---

// Carga o vacía celdas. Body: { cambios: [{ estacionId, fecha, mm }] } (mm null = vaciar la celda).
router.put("/precipitaciones/diarias", requireAuth, requireModulo, express.json({ limit: "1mb" }), async (req, res) => {
  const { cambios } = req.body || {};
  if (!Array.isArray(cambios) || !cambios.length || cambios.length > 5000) return res.status(400).json({ error: "Faltan los cambios (hasta 5000 celdas por vez)." });
  const limpios = [];
  for (const c of cambios) {
    const mm = num(c?.mm, 1500);
    if (!Number.isInteger(c?.estacionId) || c.estacionId <= 0 || !fechaValida(c?.fecha) || mm === undefined) return res.status(400).json({ error: `Dato inválido (${c?.fecha || "sin fecha"}): los mm tienen que ser un número entre 0 y 1500.` });
    limpios.push({ estacionId: c.estacionId, fecha: c.fecha, mm });
  }
  try { res.json({ guardadas: await planilla.guardarDiarias(limpios, req.usuario.usuarioId) }); } catch (e) { error(res, e, "No se pudo guardar la planilla."); }
});

function estacionDe(b, parcial = false) {
  const o = {};
  if (!parcial || "nombre" in b) { o.nombre = texto(b.nombre, 80); if (!o.nombre) return { error: "Escribí el nombre de la estación." }; }
  if (!parcial || "red" in b) { o.red = Number(b.red); if (![1, 2, 3, 4].includes(o.red)) return { error: "La red tiene que ser 1 (SMN), 2 (INTA), 3 (Automática) o 4 (Red Matteo)." }; }
  for (const [k, lim] of [["lat", 90], ["lng", 180]]) if (!parcial || k in b) { o[k] = coord(b[k], lim); if (o[k] === undefined) return { error: `La ${k === "lat" ? "latitud" : "longitud"} no es válida.` }; }
  if ((o.lat == null) !== (o.lng == null) && !parcial) return { error: "Cargá la latitud y la longitud juntas, o ninguna." };
  if ("activa" in b) o.activa = !!b.activa;
  return { o };
}
router.post("/precipitaciones/estaciones", requireAuth, requireModulo, express.json(), async (req, res) => {
  const { o, error: e } = estacionDe(req.body || {});
  if (e) return res.status(400).json({ error: e });
  try { res.json(await planilla.crearEstacion(o)); } catch (err) { error(res, err, "No se pudo crear la estación."); }
});
router.patch("/precipitaciones/estaciones/:id", requireAuth, requireModulo, express.json(), async (req, res) => {
  const id = idDe(req, res); if (id == null) return;
  const { o, error: e } = estacionDe(req.body || {}, true);
  if (e) return res.status(400).json({ error: e });
  try { res.json(await planilla.actualizarEstacion(id, o)); } catch (err) { error(res, err, "No se pudo guardar la estación."); }
});
router.delete("/precipitaciones/estaciones/:id", requireAuth, requireModulo, async (req, res) => {
  const id = idDe(req, res); if (id == null) return;
  try { await planilla.quitarEstacion(id); res.json({ ok: true }); } catch (err) { error(res, err, "No se pudo quitar la estación."); }
});
// Body: { ids: [..] } en el orden nuevo.
router.put("/precipitaciones/orden", requireAuth, requireModulo, express.json(), async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length || ids.length > 300 || ids.some((x) => !Number.isInteger(x) || x <= 0)) return res.status(400).json({ error: "Orden inválido." });
  try { await planilla.reordenar(ids); res.json({ ok: true }); } catch (err) { error(res, err, "No se pudo guardar el orden."); }
});
// Medias de una estación. Body: { medias: [{ mes: 1-12, mediaMm, usaMediaDe }] }
router.put("/precipitaciones/estaciones/:id/medias", requireAuth, requireModulo, express.json(), async (req, res) => {
  const id = idDe(req, res); if (id == null) return;
  const { medias } = req.body || {};
  if (!Array.isArray(medias) || medias.length > 12) return res.status(400).json({ error: "Medias inválidas." });
  const limpias = [];
  for (const m of medias) {
    const mediaMm = num(m?.mediaMm, 3000), usa = m?.usaMediaDe == null || m.usaMediaDe === "" ? null : Number(m.usaMediaDe);
    if (!Number.isInteger(m?.mes) || m.mes < 1 || m.mes > 12 || mediaMm === undefined || (usa != null && (!Number.isInteger(usa) || usa <= 0 || usa === id))) return res.status(400).json({ error: "Hay una media inválida." });
    limpias.push({ mes: m.mes, mediaMm: usa ? null : mediaMm, usaMediaDe: usa });
  }
  try { await planilla.guardarMedias(id, limpias); res.json({ ok: true }); } catch (err) { error(res, err, "No se pudieron guardar las medias."); }
});

// Importar un Excel como el PRECIPITACIONES.xlsx: primero se lee y se muestra qué trae (no guarda nada), después se aplica.
router.post("/precipitaciones/importar/leer", requireAuth, requireModulo, upload.single("archivo"), async (req, res) => {
  const f = req.file;
  if (!f || f.buffer.subarray(0, 2).toString("latin1") !== "PK") return res.status(400).json({ error: "Subí un archivo de Excel (.xlsx)." });
  try {
    const r = await leerExcel(f.buffer);
    if (!r.estaciones.length) return res.status(400).json({ error: "No encontré hojas con el formato esperado (una hoja por mes, llamada como «10,2026»)." });
    res.json(r);
  } catch (e) { console.error(e); res.status(400).json({ error: "No se pudo leer el Excel." }); }
});
router.post("/precipitaciones/importar/aplicar", requireAuth, requireModulo, express.json({ limit: "4mb" }), async (req, res) => {
  const { estaciones } = req.body || {};
  if (!Array.isArray(estaciones) || !estaciones.length || estaciones.length > 300) return res.status(400).json({ error: "No hay nada para importar." });
  const limpias = [];
  for (const e of estaciones) {
    const nombre = texto(e?.nombre, 80), red = Number(e?.red);
    if (!nombre || ![1, 2, 3, 4].includes(red) || !Array.isArray(e.dias) || e.dias.length > 4000) return res.status(400).json({ error: "El archivo tiene datos inválidos." });
    const dias = [];
    for (const d of e.dias) { const mm = num(d?.[1], 1500); if (!fechaValida(d?.[0]) || mm == null) return res.status(400).json({ error: `Dato inválido en «${nombre}».` }); dias.push([d[0], mm]); }
    const medias = {};
    for (const [mes, m] of Object.entries(e.medias || {})) { const mm = num(m?.mm, 3000); if (!(Number(mes) >= 1 && Number(mes) <= 12) || mm === undefined) return res.status(400).json({ error: `Media inválida en «${nombre}».` }); medias[mes] = { mm, ref: texto(m?.ref, 80) }; }
    limpias.push({ nombre, red, dias, medias });
  }
  try { res.json(await planilla.importar(limpias, req.usuario.usuarioId)); } catch (e) { error(res, e, "No se pudo importar."); }
});

module.exports = router;
