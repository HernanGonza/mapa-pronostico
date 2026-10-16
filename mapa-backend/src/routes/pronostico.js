const express = require("express");
const multer = require("multer");
const path = require("path");
const os = require("os");
const fs = require("fs");

const { extractDocxTables, extractDocxParagraphs } = require("../lib/docxTables");
const { buildForecastRows, ZONAS_PRONOSTICO } = require("../lib/parseForecast");
const { buildExtendedForecast, hayExtendido } = require("../lib/parseForecastExtendido");
const { esInformeNuevo, parseInformeNuevo } = require("../lib/parseInformeNuevo");
const { generateForecastMap, generateForecastMapHistorias } = require("../lib/generateMap");
const { nowInArgentina } = require("../lib/dateUtils");
const { publicar, obtenerActual, obtenerHistorial } = require("../lib/store");
const registrosClimaticosStore = require("../lib/registrosClimaticosStore");
const { resolveIconPath } = require("../lib/iconResolver");
const { MATERIALES_DIR } = require("../lib/generateMap");
const { loadMunicipios, armarMunicipiosConPronostico } = require("../lib/municipios");
const coordinates = require("../config/coordinates");
const requireAuth = require("../middleware/requireAuth");
const { generarInformePdf } = require("../lib/informePronosticoPdf");

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();
const ORIGENES = ["panel", "ensamble"];

function errorDeFilas(filas) {
  if (!Array.isArray(filas) || filas.length === 0) return "Falta el array `filas` en el body";
  if (filas.length > 100) return "El pronóstico supera el máximo de 100 filas";
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i] || {};
    const tmin = Number(f.TMIN);
    const tmax = Number(f.TMAX);
    if (typeof f.LOCALIDAD !== "string" || !f.LOCALIDAD.trim()) {
      return `Fila ${i + 1}: falta LOCALIDAD`;
    }
    if (!Number.isInteger(tmin) || tmin < -15 || tmin > 55) {
      return `Fila ${i + 1}: TMIN inválida`;
    }
    if (!Number.isInteger(tmax) || tmax < -15 || tmax > 55) {
      return `Fila ${i + 1}: TMAX inválida`;
    }
    if (tmin > tmax) return `Fila ${i + 1}: TMIN no puede superar TMAX`;
    if (typeof f.CONDICION !== "string" || !f.CONDICION.trim() || f.CONDICION.length > 100) {
      return `Fila ${i + 1}: CONDICION inválida`;
    }
    // Opcional: los pronósticos publicados antes de que existiera no la traen.
    if (f.ZONA != null && f.ZONA !== "" && !ZONAS_PRONOSTICO.includes(f.ZONA)) {
      return `Fila ${i + 1}: ZONA inválida (Norte, Centro o Sur)`;
    }
  }
  return null;
}

/**
 * POST /api/pronostico/parse
 * form-data: pronostico = archivo .docx
 * Solo parsea y devuelve el JSON — NO publica. El operador lo revisa/edita
 * en el front antes de mandarlo a /publicar. Acepta el .docx de siempre y el informe nuevo de la DGAT
 * (en ese caso la respuesta trae además `formato: "informe-dgat"` y `fechaSugerida`).
 */
router.post("/pronostico/parse", requireAuth, upload.single("pronostico"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Falta el archivo .docx (campo de formulario "pronostico")',
      });
    }
    const tables = await extractDocxTables(req.file.buffer);
    // Dos formatos: el .docx de siempre (3 tablas de localidades norte/centro/sur) y el informe nuevo de la DGAT
    // («PREVISIÓN DEL TIEMPO PARA LA PROVINCIA DE MISIONES», con la tabla de las 13 ciudades). Se distingue solo.
    if (esInformeNuevo(tables)) {
      const r = parseInformeNuevo(tables, await extractDocxParagraphs(req.file.buffer));
      return res.json({ filas: r.filas, extendido: hayExtendido(r.extendido) ? r.extendido : null, formato: "informe-dgat", fechaSugerida: r.fechaSugerida });
    }
    if (tables.length < 3) {
      return res.status(422).json({
        error: `Se esperaban al menos 3 tablas (norte/centro/sur), se encontraron ${tables.length}`,
      });
    }
    const filas = buildForecastRows(tables);
    // "PRONÓSTICO EXTENDIDO" (sábado/domingo por zona) e "INFORMES DE
    // PRONÓSTICO" (texto narrativo por día) vienen como texto libre, no
    // como tabla — si el .docx no los trae, buildExtendedForecast
    // devuelve zonas sin días extra y el front no muestra nada extra.
    const parrafos = await extractDocxParagraphs(req.file.buffer);
    const extendido = buildExtendedForecast(tables, parrafos);
    res.json({ filas, extendido: hayExtendido(extendido) ? extendido : null });
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
router.post("/pronostico/publicar", requireAuth, express.json({ limit: "1mb" }), async (req, res) => {
  const { filas } = req.body || {};
  const errorFilas = errorDeFilas(filas);
  if (errorFilas) return res.status(400).json({ error: errorFilas });
  try {
    // Desde dónde se publica (el panel «Previsión del tiempo» o el cajón del ensamble) y quién: lo ve el equipo en la tarjeta de
    // lo publicado, para saber que ya hay algo y no armar otro. Un origen desconocido cuenta como «panel».
    const origen = ORIGENES.includes(req.body.origen) ? req.body.origen : "panel";
    const publicadoPor = req.usuario?.nombre || req.usuario?.email || null;
    const payload = await publicar(filas, req.body.fechaPronostico, req.body.extendido || null, { origen, publicadoPor });
    // No debe romper ni demorar la publicación si esto falla — es un
    // registro derivado (serie histórica por estación), no la fuente
    // de verdad del pronóstico publicado.
    registrosClimaticosStore.upsertMuchos(filas, req.body.fechaPronostico).catch((e) => console.error("[registrosClimaticos] no se pudo actualizar la serie:", e.message));
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
    // Es público (lo leen el mapa y los embebidos): quién publicó y desde dónde son sólo del panel (ver /pronostico/publicado).
    const { origen, publicadoPor, ...publico } = actual;
    res.json(publico);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pronostico/publicado — qué hay publicado ahora, para la tarjeta del panel: cuándo, de qué día, desde dónde
 * (`origen`: "panel" | "ensamble" | null si es anterior a que se registrara) y quién lo publicó. `publicado: null` si no hay nada.
 */
router.get("/pronostico/publicado", requireAuth, async (req, res) => {
  try {
    const actual = await obtenerActual();
    if (!actual) return res.set("Cache-Control", "no-store").json({ publicado: null });
    const zonas = actual.extendido?.zonas || [];
    res.set("Cache-Control", "no-store").json({ publicado: {
      publicadoEn: actual.publicadoEn, fechaPronostico: actual.fechaPronostico, origen: actual.origen || null, publicadoPor: actual.publicadoPor || null,
      localidades: actual.filas.length, conExtendido: zonas.some((z) => z.dias?.length > 1), conTextos: (actual.extendido?.informes?.length || 0) > 0,
    } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo leer lo publicado." });
  }
});

/**
 * GET /api/pronostico/historial
 * Lista de lo publicado (id + fecha), lo más reciente primero. Vacío si
 * no hay base (persistencia en disco).
 */
router.get("/pronostico/historial", requireAuth, async (req, res) => {
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
router.post("/pronostico/render-png", requireAuth, express.json(), async (req, res) => {
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
    const errorFilas = errorDeFilas(filas);
    if (errorFilas) return res.status(400).json({ error: errorFilas });

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
 * POST /api/pronostico/placa
 * body JSON: { filas, fechaPronostico } (opcional; si no viene, usa el
 * último publicado). Genera feed + historias (mismo criterio que alertas
 * meteorológicas), las sube y graba quién/cuándo las generó.
 */
router.post("/pronostico/placa", requireAuth, express.json(), async (req, res) => {
  try {
    // Si la placa es de un informe, queda anotada en ese informe (para su badge y para volver a verla desde su tarjeta).
    const informeId = Number.isInteger(Number(req.body?.informeId)) ? Number(req.body.informeId) : null;
    const vincular = async (placa) => {
      if (informeId == null || !placa) return placa;
      await require("../lib/informesPronosticoStore").actualizarMeta(informeId, (m) => ({ ...m, placa: { id: placa.id, generadoEn: placa.generadoEn, feedUrl: placa.feedUrl, historiasUrl: placa.historiasUrl, feedNombre: placa.feedNombre, historiasNombre: placa.historiasNombre, por: req.usuario?.nombre || req.usuario?.email || null } })).catch((e) => console.error("[placa] no se pudo anotar en el informe:", e.message));
      return placa;
    };
    let filas = req.body && req.body.filas;
    const fechaPronostico = req.body && req.body.fechaPronostico;
    if (!filas) {
      const actual = await obtenerActual();
      if (!actual) return res.status(400).json({ error: "No se mandaron `filas` y todavía no hay un pronóstico publicado" });
      filas = actual.filas;
    }
    const errorFilas = errorDeFilas(filas);
    if (errorFilas) return res.status(400).json({ error: errorFilas });
    const placas = require("../lib/pronosticoPlacasStore");
    const fecha = nowInArgentina();
    // Estilo nuevo: sobre una de las fotos de las placas diarias, con etiqueta y frase (ver
    // generatePronosticoFoto). Sin `fondo`, la placa de siempre sobre el mapa crema.
    const { fondo = null, etiqueta = null, frase = "", estiloTarjeta = "oscura" } = req.body || {};
    if (fondo != null) {
      const foto = require("../lib/generatePronosticoFoto");
      const error = foto.errorDePlacaFoto({ fondo, etiqueta, frase, estiloTarjeta });
      if (error) return res.status(400).json({ error });
      return await require("../lib/placasPendientes").resolver(req, res, {
        generar: () => foto.generarPlacaPronosticoFotoAmbos({ forecastRows: filas, date: fecha, fondo, etiqueta, frase, estiloTarjeta }),
        guardar: async (pngs) => vincular(await placas.crear({ fechaPronostico, usuarioId: req.usuario.usuarioId, fondo, etiqueta, frase, estiloTarjeta, ...pngs })),
      });
    }
    await require("../lib/placasPendientes").resolver(req, res, {
      generar: async () => {
        const outputPath = path.join(os.tmpdir(), `mapa_prono_feed_${Date.now()}.png`);
        await generateForecastMap({ forecastRows: filas, outputPath, date: fecha });
        const feedPng = fs.readFileSync(outputPath);
        fs.unlink(outputPath, () => {});
        const historiasPng = await generateForecastMapHistorias({ forecastRows: filas, date: fecha });
        return { feedPng, historiasPng };
      },
      guardar: async (pngs) => vincular(await placas.crear({ fechaPronostico, usuarioId: req.usuario.usuarioId, ...pngs })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo generar la placa." });
  }
});

/** GET /api/pronostico/placas/ultima — la última placa generada ({ placa: null } si no hay). */
router.get("/pronostico/placas/ultima", requireAuth, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json({ placa: await require("../lib/pronosticoPlacasStore").ultima() }); }
  catch (e) { console.error(e); res.status(500).json({ error: "No se pudo leer la última placa." }); }
});

/**
 * GET /api/pronostico/fondos
 * Las fotos de fondo de la placa (las de las placas diarias, limpias), con su etiqueta, para
 * elegir en el asistente. Las miniaturas salen de /api/pronostico/fondos/:id.jpg.
 */
router.get("/pronostico/fondos", requireAuth, (req, res) => {
  const { FONDOS, ETIQUETAS, ESTILOS_TARJETA, MAX_FRASE } = require("../lib/generatePronosticoFoto");
  res.json({ fondos: FONDOS, etiquetas: Object.entries(ETIQUETAS).map(([id, e]) => ({ id, texto: e.texto })), estilos: Object.keys(ESTILOS_TARJETA), maxFrase: MAX_FRASE });
});
// Miniatura (360 px de ancho) de una foto de fondo; se arma una vez y queda en memoria.
const miniaturas = new Map();
router.get("/pronostico/fondos/:id.jpg", async (req, res) => {
  const { FONDOS, FONDOS_DIR } = require("../lib/generatePronosticoFoto");
  const id = Number(req.params.id);
  if (!FONDOS.some((f) => f.id === id)) return res.status(404).end();
  try {
    if (!miniaturas.has(id)) {
      const { createCanvas, loadImage } = require("canvas");
      const img = await loadImage(path.join(FONDOS_DIR, `${id}.jpg`));
      const c = createCanvas(360, Math.round((360 * img.height) / img.width));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      miniaturas.set(id, c.toBuffer("image/jpeg", { quality: 0.8 }));
    }
    res.set("Cache-Control", "public, max-age=86400").type("jpeg").send(miniaturas.get(id));
  } catch (e) { console.error(e); res.status(500).end(); }
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
  res.set("Cache-Control", "public, max-age=604800");
  res.sendFile(path.join(__dirname, "..", "..", "data", "municipios.geojson"));
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
 * GET /api/pronostico/mapa
 * Endpoint principal del mapa interactivo: los 79 municipios, cada uno
 * con lat/lng real y, si hay un pronóstico publicado, el dato de la
 * estación (de las 13 que reporta Alerta Temprana) más cercana —
 * marcando `esOficial` cuando el municipio ES una de esas 13.
 */
router.get("/pronostico/mapa", async (req, res) => {
  try {
    const actual = await obtenerActual();
    const municipios = armarMunicipiosConPronostico(actual ? actual.filas : null, actual?.extendido);
    res.json({ publicadoEn: actual ? actual.publicadoEn : null, fechaPronostico: actual?.fechaPronostico || null, municipios });
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
router.post("/pronostico/mapa-preview", requireAuth, express.json(), (req, res) => {
  const { filas, extendido } = req.body || {};
  const errorFilas = errorDeFilas(filas);
  if (errorFilas) return res.status(400).json({ error: errorFilas });
  const municipios = armarMunicipiosConPronostico(filas, extendido);
  res.json({ municipios });
});

/**
 * POST /api/pronostico/informe-pdf
 * body JSON: { informe } (el borrador del asistente de «Previsión del tiempo») → el PDF del informe, cifrado y con marca de agua.
 */
router.post("/pronostico/informe-pdf", requireAuth, express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const pdf = await generarInformePdf(req.body?.informe);
    const fecha = String(req.body?.informe?.fecha || "").replace(/[^0-9-]/g, "");
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="PREVISION DEL TIEMPO ${fecha}.pdf"`, "Cache-Control": "no-store" }).send(pdf);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error("[informe-pdf]", e);
    res.status(500).json({ error: `No se pudo armar el PDF: ${e.message}` });
  }
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
module.exports.errorDeFilas = errorDeFilas;
