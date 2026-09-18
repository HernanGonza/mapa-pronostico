const express = require("express");
const multer = require("multer");
const requireAuth = require("../middleware/requireAuth");
const requireRole = require("../middleware/requireRole");
const { TIPOS_EVENTO, SEVERIDADES } = require("../lib/catalogoEventos");
const { loadDepartamentos } = require("../lib/departamentos");
const eventos = require("../lib/eventosClimaticosStore");
const registros = require("../lib/registrosClimaticosStore");
const estacionesHistoricas = require("../lib/historicoEstacionesStore");
const importador = require("../lib/importadorClimatico");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const SOLO_ESCRITURA = ["admin", "superadmin"];

function status(e) { return [400, 403, 404, 503].includes(e.status) ? e.status : 500; }

// --- Catálogo (tipos de evento, severidades, departamentos) --------------
router.get("/catalogo-eventos", (req, res) => {
  res.json({ tipos: TIPOS_EVENTO, severidades: SEVERIDADES, departamentos: loadDepartamentos() });
});

// --- Eventos climáticos ----------------------------------------------------

router.get("/eventos-climaticos", requireAuth, async (req, res) => {
  try {
    const { tipo, departamento, desde, hasta } = req.query;
    res.json({ eventos: await eventos.listar({ tipo, departamento, desde, hasta, incluirNoPublicados: true }) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Público — lo consume /embed/historico, sin sesión.
router.get("/eventos-climaticos/publicos", async (req, res) => {
  try {
    const { tipo, departamento, desde, hasta } = req.query;
    res.set("Cache-Control", "no-store").json({ eventos: await eventos.listar({ tipo, departamento, desde, hasta }) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get("/eventos-climaticos/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido." });
  try {
    const evento = await eventos.obtener(id, { incluirNoPublicados: true });
    if (!evento) return res.status(404).json({ error: "No existe ese evento." });
    res.json(evento);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/eventos-climaticos", requireAuth, requireRole(...SOLO_ESCRITURA), express.json({ limit: "40mb" }), async (req, res) => {
  try {
    const evento = await eventos.crear({ ...req.body, usuarioId: req.usuario.usuarioId });
    res.status(201).json(evento);
  } catch (e) {
    console.error(e);
    res.status(status(e)).json({ error: status(e) === 500 ? "No se pudo guardar el evento." : e.message });
  }
});

router.patch("/eventos-climaticos/:id", requireAuth, requireRole(...SOLO_ESCRITURA), express.json(), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido." });
  try {
    res.json(await eventos.actualizar(id, req.body || {}));
  } catch (e) {
    console.error(e);
    res.status(status(e)).json({ error: status(e) === 500 ? "No se pudo actualizar el evento." : e.message });
  }
});

router.post("/eventos-climaticos/:id/publicar", requireAuth, requireRole(...SOLO_ESCRITURA), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido." });
  try {
    res.json(await eventos.publicar(id));
  } catch (e) {
    console.error(e);
    res.status(status(e)).json({ error: status(e) === 500 ? "No se pudo publicar el evento." : e.message });
  }
});

router.post("/eventos-climaticos/:id/despublicar", requireAuth, requireRole(...SOLO_ESCRITURA), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido." });
  try {
    res.json(await eventos.despublicar(id));
  } catch (e) {
    console.error(e);
    res.status(status(e)).json({ error: status(e) === 500 ? "No se pudo despublicar el evento." : e.message });
  }
});

// --- Registros climáticos (serie histórica por estación) -------------------

router.get('/estaciones-historicas', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json({ estaciones: await estacionesHistoricas.obtenerResumen() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo consultar el histórico de estaciones.' });
  }
});

router.get('/estaciones-historicas/:id/serie', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json({ serie: await estacionesHistoricas.obtenerSerie(req.params.id, req.query.desde, req.query.hasta) });
  } catch (e) {
    console.error(e);
    res.status(status(e)).json({ error: status(e) === 500 ? 'No se pudo consultar la serie.' : e.message });
  }
});

router.get("/registros-climaticos/estaciones", async (req, res) => {
  try {
    res.json({ estaciones: await registros.obtenerEstaciones() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get("/registros-climaticos/serie", async (req, res) => {
  const { estacion, desde, hasta } = req.query;
  if (!estacion) return res.status(400).json({ error: "Falta el parámetro `estacion`." });
  try {
    res.set("Cache-Control", "no-store").json({ serie: await registros.obtenerSerie(estacion, desde, hasta) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get("/registros-climaticos/estadisticas", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store").json(await registros.obtenerEstadisticas());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Alta manual de un registro suelto (completar un día/estación que no
// vino en ningún archivo — PDFs, datos de memoria, etc.)
router.post("/registros-climaticos", requireAuth, requireRole(...SOLO_ESCRITURA), express.json(), async (req, res) => {
  try {
    await registros.upsertUno({ ...req.body, fuente: "carga_manual" });
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(status(e)).json({ error: status(e) === 500 ? "No se pudo guardar el registro." : e.message });
  }
});

// Importación de datos históricos preexistentes: primero se detectan las
// columnas del CSV para que el operador arme el mapeo, después se importa
// con ese mapeo ya confirmado.
router.post("/registros-climaticos/detectar-columnas", requireAuth, requireRole(...SOLO_ESCRITURA), upload.single("archivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Falta el archivo CSV." });
  try {
    res.json(importador.detectarColumnas(req.file.buffer.toString("utf-8")));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo leer el archivo." });
  }
});

router.post("/registros-climaticos/importar", requireAuth, requireRole(...SOLO_ESCRITURA), upload.single("archivo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Falta el archivo CSV." });
  let mapeo;
  try { mapeo = JSON.parse(req.body.mapeo || "{}"); } catch { return res.status(400).json({ error: "Mapeo de columnas inválido." }); }
  try {
    res.json(await importador.importar(req.file.buffer.toString("utf-8"), mapeo));
  } catch (e) {
    console.error(e);
    res.status(status(e)).json({ error: status(e) === 500 ? "No se pudo importar el archivo." : e.message });
  }
});

router.use((err, req, res, next) => {
  if (err.type === "entity.too.large" || err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "El archivo es demasiado grande." });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "El contenido enviado no es válido." });
  next(err);
});

module.exports = router;
