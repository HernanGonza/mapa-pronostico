const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const placas = require("../lib/placasPrecipitacionesStore");
const pendientes = require("../lib/placasPendientes");
const { generarPlacaPrecipitacionesAmbos, errorDePlacaPrecipitaciones, FONDOS, FONDO_POR_DEFECTO, NOTAS } = require("../lib/generatePlacaPrecipitaciones");

const router = express.Router();

// Las fotos que se pueden elegir y las notas de las estaciones (para armar el asistente).
router.get("/placas-precipitaciones/opciones", requireAuth, (req, res) => res.json({ fondos: FONDOS, fondoPorDefecto: FONDO_POR_DEFECTO, notas: NOTAS }));

// Genera feed + historias de la placa de precipitaciones. JSON: { subtitulo, periodo, fondo, filas: [{ nombre, nota, periodo, mes, media, anomalia }] }
// y vistaPrevia: true — o, para guardar la vista previa ya revisada, confirmarToken (con los mismos datos; no se vuelve a generar).
// La marca de agua y la franja «Datos recopilados por…» las pone siempre el servidor: no hay forma de pedir la placa sin ellas.
router.post("/placas-precipitaciones/generar", requireAuth, express.json({ limit: "300kb" }), async (req, res) => {
  const { subtitulo, periodo, fondo, filas, confirmarToken } = req.body || {};
  const error = errorDePlacaPrecipitaciones({ subtitulo, periodo, filas, fondo });
  if (error) return res.status(400).json({ error });
  try {
    await pendientes.resolver(req, res, {
      generar: () => generarPlacaPrecipitacionesAmbos({ subtitulo, periodo, filas, fondo: Number(fondo) }),
      guardar: (pngs) => placas.crear({ subtitulo, periodo, fondo: Number(fondo), filas, usuarioId: req.usuario.usuarioId, ...pngs }),
    });
  } catch (e) {
    if (!e.status) console.error(e);
    const status = [400, 503].includes(e.status) ? e.status : 500;
    res.status(status).json({ error: status === 500 ? "No se pudo generar la placa de precipitaciones." : e.message });
  }
});

router.get("/placas-precipitaciones/historial", requireAuth, async (req, res) => {
  try { res.json({ historial: await placas.obtenerHistorial() }); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

module.exports = router;
