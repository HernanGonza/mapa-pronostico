const fs = require("fs");
const path = require("path");
const departamentos = () => require("./departamentos").loadDepartamentos();

// El SMN reemplaza cada emisión por la siguiente: si la última ya no menciona Misiones, la alerta que estaba vigente dejaría de verse
// aunque siga rigiendo. Se recuerda la última que llegó hasta que termina su vigencia (el panel avisa que el SMN ya no la lista).
const ARCHIVO = process.env.ALERTA_SMN_RECORDADA || path.join(__dirname, "..", "..", "data", "store", "alerta-smn-recordada.json");
function leerRecordadas() { try { return [].concat(JSON.parse(fs.readFileSync(ARCHIVO, "utf8")) || []); } catch { return []; } } // antes se guardaba una sola
function recordar(cand) {
  const previas = leerRecordadas();
  if (previas.some((p) => p.emision === cand.emision)) return;
  // Se recuerdan las de la misma emisión (una por día); las de emisiones anteriores se reemplazan.
  const lista = [...previas.filter((p) => p.emitidoEn === cand.emitidoEn), cand];
  try { fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true }); fs.writeFileSync(ARCHIVO, JSON.stringify(lista)); }
  catch (e) { console.error(`[alertas SMN] no se pudo recordar la última alerta: ${e.message}`); }
}

/** Las alertas del SMN que valen ahora (una por día): las de la última emisión o, si el SMN ya no las lista pero siguen vigentes, las recordadas (`recordada: true`). */
async function candidatasActuales(ahora = Date.now()) {
  const { obtenerActual } = await import("./smn/service.mjs");
  const actual = await obtenerActual();
  const consultadoEn = actual.fuentes.SAT?.consultadoEn || null;
  const cands = require("./alertasSmnBase").candidatas(actual.fuentes.SAT?.alertas || [], departamentos(), { ahora });
  if (cands.length) { cands.forEach(recordar); return { cands, recordada: false, consultadoEn }; }
  const guardadas = leerRecordadas().filter((g) => Date.parse(g.fin) > ahora);
  return { cands: guardadas, recordada: guardadas.length > 0, consultadoEn };
}

/**
 * Lo que el SMN mandó en su última emisión, listo para usarse como base de una alerta del módulo «Alertas meteorologicas»
 * (ver alertasSmnBase.js), y si ya está en la pila: `yaPublicada` (la misma emisión) o `actualizaA` (el SMN corrigió una alerta
 * ya publicada: se reconoce por sus horarios, y trae qué cambió).
 */
async function recibidas({ pendientes = require("./alertasMeteorologicasStore").pendientes, ahora = Date.now() } = {}) {
  const base = require("./alertasSmnBase");
  const { cands, recordada, consultadoEn } = await candidatasActuales(ahora);
  const { vigentes, enFila } = await pendientes();
  if (!cands.length) return { alertas: await reemplazadas([], pendientes), consultadoEn };
  const alertas = cands.map((cand) => {
    const { yaPublicada, actualizaA } = base.clasificar(cand, [...vigentes, ...enFila]);
    const { _entera, ...publico } = cand;
    return { ...publico, yaPublicada, actualizaA, yaNoLaLista: recordada };
  });
  return { consultadoEn, alertas: [...alertas, ...(await reemplazadas([...cands.map((c) => c.emision), ...[...vigentes, ...enFila].map((p) => p.origenSmn?.emision)], pendientes))] };
}

/** Emisiones del SMN ya reemplazadas por otra publicación, para mostrarlas apagadas (`reemplazada`). `excluir`: emisiones que ya se ven. */
async function reemplazadas(excluir, pendientes) {
  if (pendientes !== require("./alertasMeteorologicasStore").pendientes) return []; // en pruebas con una pila de mentira
  const { categorias } = require("./alertasMeteorologicas");
  const ORDEN = { Amarillo: 1, Naranja: 2, Rojo: 3 };
  const vistos = new Set(excluir.filter(Boolean));
  const salida = [];
  for (const r of await require("./alertasMeteorologicasStore").reemplazadasDelSmn()) {
    const o = r.origenSmn;
    if (vistos.has(o.emision)) continue;
    vistos.add(o.emision);
    const nivel = [...(o.niveles || [])].sort((a, b) => ORDEN[b] - ORDEN[a])[0];
    salida.push({ emision: o.emision, emitidoEn: String(o.emision).split("#")[0], color: categorias.find((c) => c.nombre === nivel)?.color || null, niveles: o.niveles || [], fenomenos: o.fenomenos || [], fenomenosLeidos: o.fenomenos || [],
      departamentos: o.departamentos || [], inicio: o.inicio, fin: o.fin, lineas: [], avisos: [], base: { periodo: r.periodo }, yaPublicada: null, actualizaA: null, yaNoLaLista: false, reemplazada: { id: r.id, por: r.por } });
  }
  return salida;
}

/** Para guardar con una publicación hecha desde la base `emision`: de dónde salió y los textos con los que arrancan sus placas. */
async function origenYPlacas(emision) {
  const base = require("./alertasSmnBase"), auto = require("./alertasSmnAuto");
  const cand = (await candidatasActuales()).cands.find((c) => c.emision === emision);
  if (!cand) return null; // el SMN ya mandó otra emisión: se publica igual, sólo que sin esa base
  return { origenSmn: base.origenDe(cand), placasBase: auto.baseDe(cand._entera, require("./generatePlacasAlerta")).ultimos };
}

module.exports = { recibidas, origenYPlacas, recordar };
