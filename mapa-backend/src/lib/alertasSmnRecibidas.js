const departamentos = () => require("./departamentos").loadDepartamentos();

/**
 * Lo que el SMN mandó en su última emisión, listo para usarse como base de una alerta del módulo «Alertas meteorologicas»
 * (ver alertasSmnBase.js), y si ya está en la pila: `yaPublicada` (la misma emisión) o `actualizaA` (el SMN corrigió una alerta
 * ya publicada: se reconoce por sus horarios, y trae qué cambió).
 */
async function recibidas({ pendientes = require("./alertasMeteorologicasStore").pendientes, ahora = Date.now() } = {}) {
  const { obtenerActual } = await import("./smn/service.mjs");
  const actual = await obtenerActual();
  const base = require("./alertasSmnBase");
  const cand = base.candidata(actual.fuentes.SAT?.alertas || [], departamentos(), { ahora });
  if (!cand) return { alertas: [], consultadoEn: actual.fuentes.SAT?.consultadoEn || null };
  const { vigentes, enFila } = await pendientes();
  const { yaPublicada, actualizaA } = base.clasificar(cand, [...vigentes, ...enFila]);
  const { _entera, ...publico } = cand;
  return { consultadoEn: actual.fuentes.SAT?.consultadoEn || null, alertas: [{ ...publico,
    yaPublicada, actualizaA }] };
}

/** Para guardar con una publicación hecha desde la base `emision`: de dónde salió y los textos con los que arrancan sus placas. */
async function origenYPlacas(emision) {
  const { obtenerActual } = await import("./smn/service.mjs");
  const base = require("./alertasSmnBase"), auto = require("./alertasSmnAuto");
  const cand = base.candidata((await obtenerActual()).fuentes.SAT?.alertas || [], departamentos());
  if (!cand || cand.emision !== emision) return null; // el SMN ya mandó otra emisión: se publica igual, sólo que sin esa base
  return { origenSmn: base.origenDe(cand), placasBase: auto.baseDe(cand._entera, require("./generatePlacasAlerta")).ultimos };
}

module.exports = { recibidas, origenYPlacas };
