const express = require("express");

const requireAuth = require("../middleware/requireAuth");
const { loadDepartamentos, DEPARTAMENTOS_GEOJSON_PATH } = require("../lib/departamentos");
const { publicar, obtenerActual } = require("../lib/riesgoIncendiosStore");

const router = express.Router();

const { categorias, errorDeZonas, normalizarZonas } = require("../lib/riesgoIncendios");

router.get("/riesgo-incendios/catalogo", (req, res) => {
  res.set("Cache-Control", "public, max-age=604800");
  res.json({ departamentos: loadDepartamentos(), categorias });
});

/**
 * GET /api/departamentos
 * Los 17 departamentos de Misiones (id + nombre), sin categoría — para
 * armar la tabla del panel antes de que haya nada publicado.
 */
router.get("/departamentos", (req, res) => {
  res.json(loadDepartamentos());
});

/**
 * GET /api/departamentos/geojson
 * Los 17 polígonos (disueltos a partir de municipios.geojson).
 */
router.get("/departamentos/geojson", (req, res) => {
  res.set("Cache-Control", "public, max-age=604800");
  res.sendFile(DEPARTAMENTOS_GEOJSON_PATH);
});

/**
 * GET /api/riesgo-incendios/actual
 * Pública (la usa /embed/riesgo-incendios, igual que /pronostico/actual).
 */
router.get("/riesgo-incendios/actual", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const actual = await obtenerActual();
    if (!actual) {
      return res.status(404).json({ error: "Todavía no se publicó el riesgo de incendios" });
    }
    res.json(actual);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo consultar el riesgo de incendios." });
  }
});

/**
 * POST /api/riesgo-incendios/publicar
 * body JSON: { zonas: [{id, categoria}, ...] } — una por cada uno de los
 * 17 departamentos. La categoría la elige el operador a mano (no se
 * calcula acá; ver charla sobre el índice canadiense FWI de ECOSOTAT,
 * quedó fuera de esta integración).
 */
router.post("/riesgo-incendios/publicar", requireAuth, express.json(), async (req, res) => {
  const { zonas } = req.body || {};
  const error = errorDeZonas(zonas);
  if (error) return res.status(400).json({ error });
  try {
    const payload = await publicar(normalizarZonas(zonas));
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo guardar el riesgo de incendios." });
  }
});

// Imagen institucional: plantilla ECOSOTAT, sin dependencia de WebGL ni tiles.
router.post("/riesgo-incendios/render-png", requireAuth, express.json(), async (req, res) => {
  const { generateRiesgoMap, fechaValida } = require("../lib/generateRiesgoMap");
  const { zonas, fecha } = req.body || {};
  const error = errorDeZonas(zonas);
  if (error || !fechaValida(fecha)) return res.status(400).json({ error: error || "Fecha de informe inválida." });
  try {
    const png = await generateRiesgoMap({ zonas: normalizarZonas(zonas), fecha });
    res.set("Cache-Control", "no-store");
    res.set("Content-Disposition", `attachment; filename="riesgo-incendios-${fecha}.png"`);
    res.type("png").send(png);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo generar la imagen institucional." });
  }
});

// Placa para redes en los dos formatos (feed + historias), mismo criterio
// que alertas meteorológicas: genera ambas, las sube y graba quién/cuándo.
router.post("/riesgo-incendios/placa", requireAuth, express.json(), async (req, res) => {
  const { generateRiesgoMap, fechaValida } = require("../lib/generateRiesgoMap");
  const { generateRiesgoMapFeed } = require("../lib/generateRiesgoMapFeed");
  const placas = require("../lib/riesgoPlacasStore");
  const { zonas, fecha } = req.body || {};
  const error = errorDeZonas(zonas);
  if (error || !fechaValida(fecha)) return res.status(400).json({ error: error || "Fecha de informe inválida." });
  try {
    const zonasNorm = normalizarZonas(zonas);
    await require("../lib/placasPendientes").resolver(req, res, {
      generar: async () => {
        const [historiasPng, feedPng] = await Promise.all([generateRiesgoMap({ zonas: zonasNorm, fecha }), generateRiesgoMapFeed({ zonas: zonasNorm, fecha })]);
        return { feedPng, historiasPng };
      },
      guardar: (pngs) => placas.crear({ fecha, usuarioId: req.usuario.usuarioId, ...pngs }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo generar la placa." });
  }
});

module.exports = router;
