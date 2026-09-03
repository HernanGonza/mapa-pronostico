const express = require("express");

const router = express.Router();

/**
 * Mapa de peligro de incendios forestales: hoy lo genera un sistema aparte
 * (Java) que todavía no está integrado a este backend. Este endpoint es un
 * placeholder para que el front tenga algo consistente que pedir en vez de
 * un 404 crudo — cuando se porte/conecte ese generador, esta ruta pasa a
 * devolver el mapa real (o el proxy a ese servicio).
 */
router.get("/riesgo-incendios/actual", (req, res) => {
  res.status(501).json({
    error: "Pendiente: falta integrar el generador del mapa de riesgo de incendios.",
  });
});

module.exports = router;
