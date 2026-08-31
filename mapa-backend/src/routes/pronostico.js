const express = require("express");
const multer = require("multer");
const path = require("path");
const os = require("os");
const fs = require("fs");

const { extractDocxTables } = require("../lib/docxTables");
const { buildForecastRows } = require("../lib/parseForecast");
const { generateForecastMap } = require("../lib/generateMap");
const { nowInArgentina } = require("../lib/dateUtils");
const { publicar, obtenerActual, obtenerHistorial } = require("../lib/store");
const { resolveIconPath } = require("../lib/iconResolver");
const { MATERIALES_DIR } = require("../lib/generateMap");
const { loadMunicipios, armarMunicipiosConPronostico } = require("../lib/municipios");
const { obtenerGrillaViento } = require("../lib/viento");
const { obtenerGrillaClima } = require("../lib/clima");
const coordinates = require("../config/coordinates");

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

/**
 * POST /api/pronostico/parse
 * form-data: pronostico = archivo .docx
 * Solo parsea y devuelve el JSON — NO publica. El operador lo revisa/edita
 * en el front antes de mandarlo a /publicar.
 */
router.post("/pronostico/parse", upload.single("pronostico"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Falta el archivo .docx (campo de formulario "pronostico")',
      });
    }
    const tables = await extractDocxTables(req.file.buffer);
    if (tables.length < 3) {
      return res.status(422).json({
        error: `Se esperaban al menos 3 tablas (norte/centro/sur), se encontraron ${tables.length}`,
      });
    }
    const filas = buildForecastRows(tables);
    res.json({ filas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pronostico/publicar
 * body JSON: { filas: [{LOCALIDAD, TMIN, TMAX, CONDICION}, ...] }
 * Guarda el dataset como "el pronóstico actual" — esto es lo que lee
 * el iframe público (/embed en el front).
 */
router.post("/pronostico/publicar", express.json(), async (req, res) => {
  const { filas } = req.body || {};
  if (!Array.isArray(filas) || filas.length === 0) {
    return res.status(400).json({ error: "Falta el array `filas` en el body" });
  }
  try {
    const payload = await publicar(filas);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo guardar: " + err.message });
  }
});

/**
 * GET /api/pronostico/actual
 * Devuelve el último pronóstico publicado (o 404 si todavía no se publicó nada).
 */
router.get("/pronostico/actual", async (req, res) => {
  try {
    const actual = await obtenerActual();
    if (!actual) {
      return res
        .status(404)
        .json({ error: "Todavía no se publicó ningún pronóstico" });
    }
    res.json(actual);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pronostico/historial
 * Lista de lo publicado (id + fecha), lo más reciente primero. Vacío si
 * no hay base (persistencia en disco).
 */
router.get("/pronostico/historial", async (req, res) => {
  try {
    res.json({ historial: await obtenerHistorial() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pronostico/render-png
 * body JSON: { filas: [...] } (opcional; si no viene, usa el último publicado)
 * Genera y devuelve el PNG cuadrado (para redes / Instagram), server-side.
 * Sirve tanto para el botón "generar imagen" manual como para un cron
 * que la publique sola sin operador.
 */
router.post("/pronostico/render-png", express.json(), async (req, res) => {
  try {
    let filas = req.body && req.body.filas;
    if (!filas) {
      const actual = await obtenerActual();
      if (!actual) {
        return res.status(400).json({
          error: "No se mandaron `filas` y todavía no hay un pronóstico publicado",
        });
      }
      filas = actual.filas;
    }

    const outputPath = path.join(os.tmpdir(), `mapa_prono_${Date.now()}.png`);
    await generateForecastMap({ forecastRows: filas, outputPath, date: nowInArgentina() });

    res.sendFile(outputPath, (err) => {
      fs.unlink(outputPath, () => {});
      if (err && !res.headersSent) {
        res.status(500).json({ error: "Error al enviar la imagen generada" });
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/coordenadas
 * Única fuente de verdad de las posiciones X/Y por localidad, consumida
 * tanto por el back (canvas) como por el front (Leaflet CRS.Simple).
 */
/**
 * GET /api/coordenadas
 * Posiciones X/Y (píxel, sobre basemap.png) — SOLO las usa la generación
 * del PNG cuadrado para redes (server-side, canvas). No confundir con
 * /api/municipios, que son coordenadas geográficas reales.
 */
router.get("/coordenadas", (req, res) => {
  res.json(coordinates);
});

/**
 * GET /api/municipios
 * Los 79 municipios de la provincia con lat/lng REAL (dataset propio),
 * sin datos de pronóstico. Sirve para pintar el mapa base antes de que
 * haya nada publicado, o para cualquier otro uso geográfico futuro.
 */
router.get("/municipios", (req, res) => {
  res.json(loadMunicipios());
});

/**
 * GET /api/municipios/geojson
 * Los 79 polígonos reales (de Ordenamiento Territorial, reproyectados a
 * WGS84), sin datos de pronóstico — geometría pura, cambia poco.
 */
router.get("/municipios/geojson", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "data", "municipios.geojson"));
});

/**
 * GET /api/contexto/geojson
 * Países/territorios que rodean Misiones (Paraguay, Brasil, Corrientes/
 * Argentina, Uruguay, Bolivia), recortados a un recuadro alrededor de la
 * provincia. Natural Earth 1:50m (dominio público). Se dibuja plano,
 * solo para que Misiones no quede "flotando en el espacio".
 */
router.get("/contexto/geojson", (req, res) => {
  res.set("Cache-Control", "public, max-age=86400");
  res.sendFile(path.join(__dirname, "..", "..", "data", "contexto.geojson"));
});

/**
 * GET /api/mundo/geojson
 * Tierra firme de todo el mundo (Natural Earth 1:50m, dominio público),
 * simplificada. Solo como fondo plano para que el mapa no se vea
 * "flotando en el espacio" cuando se aleja la cámara.
 */
router.get("/mundo/geojson", (req, res) => {
  res.set("Cache-Control", "public, max-age=604800");
  res.sendFile(path.join(__dirname, "..", "..", "data", "mundo.geojson"));
});

/**
 * GET /api/geo/:archivo
 * GeoJSON estáticos del mapa: division política y rótulos.
 *   paises-labels · provincias · provincias-labels
 * (Natural Earth, dominio público.)
 */
router.get("/geo/:archivo", (req, res) => {
  const permitidos = new Set([
    "paises-labels",
    "provincias",
    "provincias-labels",
  ]);
  if (!permitidos.has(req.params.archivo)) {
    return res.status(404).json({ error: "No existe ese GeoJSON" });
  }
  res.set("Cache-Control", "public, max-age=604800");
  res.sendFile(
    path.join(__dirname, "..", "..", "data", `${req.params.archivo}.geojson`)
  );
});

/**
 * GET /api/clima/grilla
 * Grilla de clima (nubosidad, lluvia, temperatura, viento) por hora, para
 * las capas del mapa. Todo de Open-Meteo. Cacheado 30 min.
 */
router.get("/clima/grilla", async (req, res) => {
  try {
    // Mapa "en vivo": el cliente revalida seguido (el back ya cachea 30 min).
    res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
    res.json(await obtenerGrillaClima());
  } catch (err) {
    console.error(err);
    res
      .status(502)
      .json({ error: "No se pudo obtener el clima de Open-Meteo: " + err.message });
  }
});

/**
 * GET /api/viento/grilla
 * Velocidad + dirección de viento real (modelo numérico vía Open-Meteo)
 * en una grilla sobre la provincia. Cacheado 30 min en el servidor.
 */
router.get("/viento/grilla", async (req, res) => {
  try {
    const { puntos, gridSize, bounds } = await obtenerGrillaViento();
    res.json({ puntos, gridSize, bounds });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "No se pudo obtener el viento de Open-Meteo: " + err.message });
  }
});

/**
 * GET /api/pronostico/mapa
 * Endpoint principal del mapa interactivo: los 79 municipios, cada uno
 * con lat/lng real y, si hay un pronóstico publicado, el dato de la
 * estación (de las 13 que reporta Alerta Temprana) más cercana —
 * marcando `esOficial` cuando el municipio ES una de esas 13.
 */
router.get("/pronostico/mapa", async (req, res) => {
  try {
    const actual = await obtenerActual();
    const municipios = armarMunicipiosConPronostico(actual ? actual.filas : null);
    res.json({ publicadoEn: actual ? actual.publicadoEn : null, municipios });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pronostico/mapa-preview
 * Igual que GET /api/pronostico/mapa pero a partir de un dataset que
 * todavía NO se publicó (lo que el operador está editando en el panel).
 * No toca el store.
 */
router.post("/pronostico/mapa-preview", express.json(), (req, res) => {
  const { filas } = req.body || {};
  if (!Array.isArray(filas)) {
    return res.status(400).json({ error: "Falta el array `filas` en el body" });
  }
  const municipios = armarMunicipiosConPronostico(filas);
  res.json({ municipios });
});

router.get("/materiales/icono/:condicion", (req, res) => {
  const imgsDir = path.join(MATERIALES_DIR, "imgs");
  const iconPath = resolveIconPath(imgsDir, req.params.condicion);
  if (!iconPath) {
    return res.status(404).json({ error: `Sin ícono para "${req.params.condicion}"` });
  }
  res.sendFile(iconPath);
});

module.exports = router;
