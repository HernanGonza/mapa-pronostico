const fs = require("fs");
const path = require("path");
const departamentos = () => require("./departamentos").loadDepartamentos();

// El SMN reemplaza cada emisión por la siguiente: si la última ya no menciona Misiones, la alerta que estaba vigente dejaría de verse
// aunque siga rigiendo. Se recuerda la última que llegó hasta que termina su vigencia (el panel avisa que el SMN ya no la lista).
const ARCHIVO = process.env.ALERTA_SMN_RECORDADA || path.join(__dirname, "..", "..", "data", "store", "alerta-smn-recordada.json");
function leerRecordada() { try { return JSON.parse(fs.readFileSync(ARCHIVO, "utf8")); } catch { return null; } }
function recordar(cand) {
  const previa = leerRecordada();
  if (previa && previa.emision === cand.emision) return;
  try { fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true }); fs.writeFileSync(ARCHIVO, JSON.stringify(cand)); }
  catch (e) { console.error(`[alertas SMN] no se pudo recordar la última alerta: ${e.message}`); }
}

/** La alerta del SMN que vale ahora: la de la última emisión o, si el SMN ya no la lista pero sigue vigente, la recordada (`recordada: true`). */
async function candidataActual(ahora = Date.now()) {
  const { obtenerActual } = await import("./smn/service.mjs");
  const actual = await obtenerActual();
  const consultadoEn = actual.fuentes.SAT?.consultadoEn || null;
  const cand = require("./alertasSmnBase").candidata(actual.fuentes.SAT?.alertas || [], departamentos(), { ahora });
  if (cand) { recordar(cand); return { cand, recordada: false, consultadoEn }; }
  const guardada = leerRecordada();
  if (guardada && Date.parse(guardada.fin) > ahora) return { cand: guardada, recordada: true, consultadoEn };
  return { cand: null, recordada: false, consultadoEn };
}

/**
 * Lo que el SMN mandó en su última emisión, listo para usarse como base de una alerta del módulo «Alertas meteorologicas»
 * (ver alertasSmnBase.js), y si ya está en la pila: `yaPublicada` (la misma emisión) o `actualizaA` (el SMN corrigió una alerta
 * ya publicada: se reconoce por sus horarios, y trae qué cambió).
 */
async function recibidas({ pendientes = require("./alertasMeteorologicasStore").pendientes, ahora = Date.now() } = {}) {
  const base = require("./alertasSmnBase");
  const { cand, recordada, consultadoEn } = await candidataActual(ahora);
  if (!cand) return { alertas: [], consultadoEn };
  const { vigentes, enFila } = await pendientes();
  const { yaPublicada, actualizaA } = base.clasificar(cand, [...vigentes, ...enFila]);
  const { _entera, ...publico } = cand;
  return { consultadoEn, alertas: [{ ...publico, yaPublicada, actualizaA, yaNoLaLista: recordada }] };
}

/** Para guardar con una publicación hecha desde la base `emision`: de dónde salió y los textos con los que arrancan sus placas. */
async function origenYPlacas(emision) {
  const base = require("./alertasSmnBase"), auto = require("./alertasSmnAuto");
  const { cand } = await candidataActual();
  if (!cand || cand.emision !== emision) return null; // el SMN ya mandó otra emisión: se publica igual, sólo que sin esa base
  return { origenSmn: base.origenDe(cand), placasBase: auto.baseDe(cand._entera, require("./generatePlacasAlerta")).ultimos };
}

module.exports = { recibidas, origenYPlacas, recordar };
