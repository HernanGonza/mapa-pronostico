/**
 * Clima final de un departamento para un día: en cascada,
 *   1) la estación real asignada (SiNaRaMe/INA vía SNIH, o Red
 *      Agrometeorológica INTA vía SIGA — ver riesgoIncendiosEstaciones.js),
 *   2) Open-Meteo (satélite/reanálisis, en el centroide exacto) para lo
 *      que falte: viento cuando la estación es INTA (no lo mide), o
 *      cualquier variable el día que esa estación no haya reportado.
 * Nunca se deja un departamento sin clima: en el peor caso, todo sale de
 * Open-Meteo, como antes de sumar estas dos fuentes.
 */
const { asignacionDe } = require("./riesgoIncendiosEstaciones");
const sinarame = require("./sinarame");
const sigaInta = require("./sigaInta");
const openMeteo = require("./openMeteo");

const fechaHoyART = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

/** Junta la lectura real (puede faltar del todo, o tener algún campo en
 * `null`) con el respaldo de Open-Meteo del mismo día. `fuenteEstacion` es
 * sólo para trazabilidad (queda guardado junto con el índice). */
function combinar(real, respaldo, fuenteEstacion) {
  const r = real || {};
  const usoAlgoDeLaEstacion = r.temperatura != null || r.humedad != null || r.precipitacion != null;
  return {
    temperatura: r.temperatura ?? respaldo.temperatura,
    humedad: r.humedad ?? respaldo.humedad,
    viento: r.viento ?? respaldo.viento,
    precipitacion: r.precipitacion ?? respaldo.precipitacion,
    fuente: usoAlgoDeLaEstacion ? fuenteEstacion : "openmeteo",
  };
}

/** Clima de HOY de un departamento — para el cron diario: usa la lectura
 * más reciente de la estación asignada (no la serie histórica, que puede
 * ir un paso atrás) + Open-Meteo para completar lo que falte. */
async function climaDeHoy(departamentoId, centroide) {
  const { fuente, estacion } = asignacionDe(departamentoId);
  const fecha = fechaHoyART();
  let real = null;
  try {
    if (fuente === "sinarame") real = await sinarame.climaActual(estacion.id);
    else if (fuente === "inta") real = await sigaInta.climaDeUnDia(estacion.id, fecha);
  } catch {
    real = null; // la estación falló hoy — no frena el cálculo, se completa todo con Open-Meteo.
  }
  const dias = await openMeteo.climaReciente(centroide.lat, centroide.lng, 1);
  const respaldo = dias.at(-1);
  return { fecha, estacionNombre: estacion.nombre, ...combinar(real, respaldo, fuente) };
}

/**
 * Serie de clima de un departamento entre dos fechas — UN pedido a la
 * estación asignada y UNO a Open-Meteo para todo el rango (no uno por
 * día), pensado para el backfill. Devuelve un Map fecha -> clima.
 */
async function climaHistoricoPorDepartamento(departamentoId, centroide, desdeISO, hastaISO) {
  const { fuente, estacion } = asignacionDe(departamentoId);
  let serieReal = new Map();
  try {
    if (fuente === "sinarame") serieReal = await sinarame.climaPorDia(estacion.id, desdeISO, hastaISO);
    else if (fuente === "inta") serieReal = await sigaInta.climaEnRango(estacion.id, desdeISO, hastaISO);
  } catch {
    serieReal = new Map(); // la estación falló para todo el rango — se completa todo con Open-Meteo.
  }
  const dias = await openMeteo.climaHistoricoEnRango(centroide.lat, centroide.lng, desdeISO, hastaISO);
  const resultado = new Map();
  for (const [fecha, respaldo] of dias) {
    resultado.set(fecha, { fecha, estacionNombre: estacion.nombre, ...combinar(serieReal.get(fecha), respaldo, fuente) });
  }
  return resultado;
}

module.exports = { climaDeHoy, climaHistoricoPorDepartamento };
