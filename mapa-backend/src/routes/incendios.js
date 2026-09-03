const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const requireApiKey = require("../middleware/requireApiKey");
const incendiosStore = require("../lib/incendiosStore");
const { parseCsv } = require("../lib/csv");

const router = express.Router();

/**
 * POST /api/incendios/webhook
 * El sistema de alertas nos empuja acá cada tanda apenas la recibe de NASA
 * FIRMS (en vez de que nosotros salgamos a buscarla) — así el mapa se arma
 * en tiempo real. No hay browser ni sesión del otro lado, así que en vez de
 * cookie se protege con un header fijo (`X-Api-Key`, ver requireApiKey).
 *
 * Acepta JSON o CSV — todavía no está confirmado con qué formato manda el
 * otro sistema. Si el Content-Type dice csv se parsea como CSV; si no, se
 * intenta JSON primero y CSV como respaldo (por si mandan CSV sin avisarlo
 * en el header). El resultado se guarda tal cual — el front ya sabe leer
 * tanto un array de objetos (JSON o CSV parseado) como los otros shapes
 * que probamos en `extraerFocos`.
 */
router.post(
  "/incendios/webhook",
  requireApiKey,
  express.text({ type: "*/*", limit: "2mb" }),
  async (req, res) => {
    const contentType = req.headers["content-type"] || "";
    let datos;
    try {
      if (contentType.includes("csv")) {
        datos = parseCsv(req.body);
      } else {
        try {
          datos = JSON.parse(req.body);
        } catch {
          datos = parseCsv(req.body);
        }
      }
    } catch (err) {
      return res.status(400).json({ error: "No se pudo interpretar el body: " + err.message });
    }
    if (!datos || (Array.isArray(datos) && datos.length === 0)) {
      return res.status(400).json({ error: "El body no tiene datos reconocibles" });
    }
    try {
      const payload = await incendiosStore.guardar(datos);
      res.json(payload);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /api/incendios/historial
 * Últimas tandas recibidas, para la lista del panel (protegida por sesión,
 * a diferencia del webhook que la alimenta).
 */
router.get("/incendios/historial", requireAuth, async (req, res) => {
  try {
    const historial = await incendiosStore.obtenerHistorial(10);
    res.json(historial);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/incendios/recuperar
 * Fallback manual (botón del panel, previo al webhook de arriba): le pide
 * al sistema de alertas su último JSON por pull en vez de esperar a que lo
 * empuje. Se mantiene por si hace falta forzar una actualización a mano.
 * Requiere `ALERTAS_INCENDIOS_URL` (todavía no configurado).
 */
router.post("/incendios/recuperar", requireAuth, async (req, res) => {
  const url = process.env.ALERTAS_INCENDIOS_URL;
  if (!url) {
    return res.status(501).json({
      error:
        "Falta configurar ALERTAS_INCENDIOS_URL (el endpoint del sistema de alertas de incendio).",
    });
  }
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`El sistema de alertas respondió ${r.status}`);
    const datos = await r.json();
    const payload = await incendiosStore.guardar(datos);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "No se pudo traer las alertas: " + err.message });
  }
});

/**
 * GET /api/incendios/actual
 * Pública (la usa /embed/alertas-incendios, igual que /pronostico/actual).
 */
router.get("/incendios/actual", async (req, res) => {
  try {
    const actual = await incendiosStore.obtenerActual();
    if (!actual) {
      return res.status(404).json({ error: "Todavía no se recuperó ninguna alerta" });
    }
    res.json(actual);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
