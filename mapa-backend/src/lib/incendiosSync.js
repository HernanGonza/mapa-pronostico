const incendiosStore = require("./incendiosStore");

/**
 * Sondeo automático de `ALERTAS_INCENDIOS_URL` (el endpoint del sistema de
 * alertas de incendio), mismo patrón que el sondeo del SMN
 * (`lib/smn/service.mjs`): al arrancar el server hace una consulta y desde
 * ahí repite cada `intervalMs`. Así alcanza con cargar la variable de
 * entorno — no hace falta tocar código ni apretar "Recuperar" a mano.
 *
 * El botón "Recuperar" del panel (`POST /incendios/recuperar`) sigue andando
 * igual, para forzar una actualización sin esperar al próximo sondeo.
 */

const INTERVALO = 5 * 60 * 1000; // igual que el sondeo del SMN

let actualizando = null;
let ultimoError = null;
let ultimaConsulta = null;

async function actualizarAhora({ fetchFn = fetch, repository = incendiosStore, logger = console } = {}) {
  if (actualizando) return actualizando;
  const url = process.env.ALERTAS_INCENDIOS_URL;
  if (!url) return;
  actualizando = (async () => {
    const r = await fetchFn(url);
    if (!r.ok) throw new Error(`El sistema de alertas respondió ${r.status}`);
    const datos = await r.json();
    await repository.guardar(datos);
    const cantidad = Array.isArray(datos) ? datos.length : (datos?.length ?? "?");
    logger.log(`[incendios] sondeo completado; ${cantidad} focos recibidos`);
  })()
    .then(() => { ultimoError = null; ultimaConsulta = new Date().toISOString(); })
    .catch((err) => {
      ultimoError = err.message;
      logger.error(`[incendios] no se pudo traer las alertas: ${err.message}`);
    })
    .finally(() => { actualizando = null; });
  return actualizando;
}

function iniciar({ intervalMs = INTERVALO, logger = console } = {}) {
  if (!process.env.ALERTAS_INCENDIOS_URL) {
    logger.log("[incendios] ALERTAS_INCENDIOS_URL no configurado; sondeo automático desactivado.");
    return { async detener() {} };
  }
  let detenido = false;
  const timer = setInterval(() => { if (!detenido) actualizarAhora({ logger }); }, intervalMs);
  timer.unref?.();
  void actualizarAhora({ logger });
  return {
    async detener() {
      detenido = true;
      clearInterval(timer);
      await actualizando;
    },
  };
}

module.exports = {
  actualizarAhora,
  iniciar,
  obtenerEstado: () => ({ ultimoError, ultimaConsulta }),
};
