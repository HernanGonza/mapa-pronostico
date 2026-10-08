const { test } = require("node:test");
const assert = require("node:assert/strict");
const auto = require("../src/lib/alertasSmnAuto");
const { copiaDe } = require("../src/lib/alertasSmnPublicadasStore");

const GEO = { type: "Polygon", coordinates: [[[-55, -27], [-54.9, -27], [-54.9, -27.1], [-55, -27]]] };
const dia = (h, d = 0) => new Date(Date.UTC(2030, 0, 10 + d, h + 3)).toISOString(); // hora argentina
const info = (o = {}) => ({ titulo: "Tormentas", evento: "Tormentas", categoria: "Amarillo", descripcion: "Área afectada por tormentas.", instrucciones: "",
  inicio: dia(9), fin: dia(15), zonas: [{ nombre: "Oberá", departamentos: ["Oberá", "Cainguás"], geometry: GEO }], ...o });
const alerta = (id, i = info(), emitidoEn = "2030-01-10T09:00:00.000Z") => ({ id, emitidoEn, url: "u", infos: [i] });

function repoFalso(previas = []) {
  const filas = previas.map((f, k) => ({ id: k + 1, vigente: true, ...f }));
  let sig = 100;
  return { filas, copiaDe, cambiosNotificados: [],
    candidatas: async () => filas.map((f) => ({ ...f })),
    publicar: async (smnId, alertas) => { const a = alertas.find((x) => smnId.startsWith(x.id)); const d = copiaDe(a, a.infos[0], {}); const f = { id: sig++, smnId, vigente: true, ...d }; filas.push(f); return f; },
    placasDe: async (ids) => Object.fromEntries(ids.map((i) => [i, []])),
    actualizarDatos: async (id, { smnId, datos, cambio }) => { const f = filas.find((x) => x.id === id); Object.assign(f, datos, { smnId }); if (cambio) (f.cambios ||= []).push(cambio); return f; } };
}
const placasFalsas = () => { const l = []; return { l, fn: async (a, tipo, motivo, anterior) => { l.push(`${tipo}/${motivo}/${anterior}`); return { id: 1 }; } }; };
const logger = { error: (m) => { throw new Error(m); }, info() {} };

test("publicar una alerta nueva la publica y saca su placa de aviso", async () => {
  const repo = repoFalso(), p = placasFalsas();
  const fila = await auto.publicarOActualizar("a:0", [alerta("a", info())], 1, {}, { repo, placas: p.fn, logger });
  assert.equal(repo.filas.length, 1); assert.equal(fila.smnId, "a:0"); assert.deepEqual(p.l, ["aviso/nueva/null"]);
});

test("publicar la actualización de una publicada pisa la misma: no se duplica", async () => {
  const repo = repoFalso(), p = placasFalsas();
  await auto.publicarOActualizar("a:0", [alerta("a", info())], 1, {}, { repo, placas: p.fn, logger });
  await auto.publicarOActualizar("b:0", [alerta("b", info({ categoria: "Naranja", fin: dia(18) }), "2030-01-10T11:00:00.000Z")], 1, {}, { repo, placas: p.fn, logger });
  assert.equal(repo.filas.length, 1);
  assert.equal(repo.filas[0].categoria, "Naranja"); assert.equal(repo.filas[0].smnId, "b:0");
  assert.deepEqual(repo.filas[0].cambios[0].tipos, ["nivel", "vigencia"]);
  assert.deepEqual(p.l, ["aviso/nueva/null", "nivel/nivel/Amarillo"]);
});

test("estado: marca qué alerta del SMN corresponde a cada publicada y qué cambió", async () => {
  const repo = repoFalso(), p = placasFalsas();
  await auto.publicarOActualizar("a:0", [alerta("a", info())], 1, {}, { repo, placas: p.fn, logger });
  const igual = auto.estado(repo.filas, [alerta("b", info())]).get(repo.filas[0].id);
  assert.deepEqual(igual, { smnIdActual: "b:0", tipos: [] });
  const cambio = auto.estado(repo.filas, [alerta("c", info({ fin: dia(17) }))]).get(repo.filas[0].id);
  assert.deepEqual(cambio.tipos, ["vigencia"]);
  assert.equal(auto.estado(repo.filas, []).get(repo.filas[0].id), undefined, "si el SMN ya no la trae, sin correspondencia");
});

test("emparejar: otro fenómeno, otro período o zonas distintas son alertas aparte", () => {
  const f = { id: 1, ...info() };
  const n = (o) => ({ ...info(o) });
  assert.equal(auto.emparejar([f], [n({ evento: "Vientos", titulo: "Vientos" })]).length, 0);
  assert.equal(auto.emparejar([f], [n({ inicio: dia(21), fin: dia(9, 1) })]).length, 0);
  assert.equal(auto.emparejar([f], [n({ zonas: [{ nombre: "P", departamentos: ["Capital"], geometry: GEO }] })]).length, 0);
  assert.equal(auto.emparejar([f], [n({ inicio: dia(10), fin: dia(16) })]).length, 1, "un horario corrido sigue siendo la misma");
});

test("revisar avisa de lo nuevo y de lo actualizado, una sola vez, sin publicar nada", async () => {
  const repo = repoFalso(), p = placasFalsas(), notis = [], claves = new Set();
  const notificar = { crearSiNoExiste: async (n) => { if (claves.has(n.clave)) return false; claves.add(n.clave); notis.push(n); return true; } };
  await auto.revisar([alerta("a", info())], { repo, notificar, logger });
  await auto.revisar([alerta("a", info())], { repo, notificar, logger });
  assert.equal(notis.length, 1); assert.match(notis[0].titulo, /Alerta nueva del SMN: Tormentas · Amarillo/); assert.equal(repo.filas.length, 0);
  await auto.publicarOActualizar("a:0", [alerta("a", info())], 1, {}, { repo, placas: p.fn, logger });
  await auto.revisar([alerta("b", info())], { repo, notificar, logger });
  assert.equal(notis.length, 1, "igual que lo publicado: nada que avisar");
  await auto.revisar([alerta("c", info({ categoria: "Naranja" }))], { repo, notificar, logger });
  assert.match(notis[1].titulo, /actualizó una alerta publicada/); assert.match(notis[1].detalle, /pasa de Amarillo a Naranja/);
});

test("sin nivel, sin polígono o fuera de Misiones no es publicable", () => {
  assert.equal(auto.publicable(info({ categoria: "Sin nivel" })), null);
  assert.equal(auto.publicable(info({ zonas: [{ nombre: "a", departamentos: ["Oberá"], geometry: null }] })), null);
  assert.equal(auto.publicable(info({ zonas: [{ nombre: "Salta", departamentos: [], geometry: GEO }] })), null);
});

test("textos de la placa: vigencia de un día y de varios, lista corta de departamentos", () => {
  assert.equal(auto.textoVigencia(dia(9), dia(15)), "jueves 10/01 de 09:00 a 15:00 horas");
  assert.deepEqual(auto.rangoDelDia(dia(21), dia(24)), { fecha: "2030-01-10", desde: "21:00", hasta: "24:00" });
  assert.equal(auto.rangoDelDia(dia(21), dia(9, 1)), null);
  assert.match(auto.textoVigencia(dia(21), dia(9, 1)), /^desde el jueves 10\/01 a las 21:00 hasta el viernes 11\/01 a las 09:00 horas$/);
  assert.equal(auto.listaCorta(["A", "B", "C"]), "A, B y C");
  assert.match(auto.listaCorta(Array.from({ length: 17 }, (_, i) => `Departamento ${i}`), 60), /y \d+ departamentos más$/);
});
