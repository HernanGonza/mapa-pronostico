const { calcularHoy } = require("./riesgoIncendiosIndiceCalculo");

/**
 * Corrida diaria del índice de riesgo de incendios (FWI) de los 17
 * departamentos — mismo patrón que cuencas/service.js. Corre cada hora en
 * vez de una vez al día: no hay forma barata de saber desde acá cuándo
 * Open-Meteo "cierra" el día en su propio análisis, así que simplemente
 * se reintenta seguido — total, recalcular el mismo día no hace daño
 * (ON CONFLICT actualiza la fila, ver riesgoIncendiosIndiceStore.js).
 *
 * Esto llena `riesgo_incendios_indice` (el cálculo). NO publica nada en
 * el mapa público: `riesgo_incendios` (la categoría publicada) la sigue
 * confirmando una persona desde el panel — ver GET /riesgo-incendios/automatico.
 */
const INTERVALO = 60 * 60 * 1000;
let estado = { calculadoEn: null, error: null, resultados: null, errores: null };
let corriendo = null;

async function actualizarAhora({ logger = console } = {}) {
  if (corriendo) return corriendo;
  corriendo = calcularHoy()
    .then(({ resultados, errores }) => {
      estado = { calculadoEn: new Date().toISOString(), error: null, resultados, errores };
      logger.log(`[riesgoIncendiosIndice] calculado: ${resultados.length}/${resultados.length + errores.length} departamentos${errores.length ? ` (falló: ${errores.map((e) => e.nombre).join(", ")})` : ""}`);
    })
    .catch((err) => {
      estado = { ...estado, error: err.message };
      logger.error("[riesgoIncendiosIndice]", err.message);
    })
    .finally(() => {
      corriendo = null;
    });
  return corriendo;
}

function iniciar({ intervalMs = INTERVALO, logger = console } = {}) {
  let detenido = false;
  const timer = setInterval(() => {
    if (!detenido) actualizarAhora({ logger });
  }, intervalMs);
  timer.unref?.();
  actualizarAhora({ logger });
  return {
    detener() {
      detenido = true;
      clearInterval(timer);
    },
  };
}

function obtenerEstado() {
  return estado;
}

module.exports = { actualizarAhora, iniciar, obtenerEstado };
