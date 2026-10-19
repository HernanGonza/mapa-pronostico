const { test } = require("node:test");
const assert = require("node:assert/strict");
const auto = require("../src/lib/alertasSmnAuto");

const GEO = { type: "Polygon", coordinates: [[[-55, -27], [-54.9, -27], [-54.9, -27.1], [-55, -27]]] };
const dia = (h, d = 0) => new Date(Date.UTC(2030, 0, 10 + d, h + 3)).toISOString(); // hora argentina
const info = (o = {}) => ({ titulo: "Tormentas", evento: "Tormentas", categoria: "Amarillo", descripcion: "Área afectada por tormentas.", instrucciones: "",
  inicio: dia(9), fin: dia(15), zonas: [{ nombre: "Oberá", departamentos: ["Oberá", "Cainguás"], geometry: GEO }], ...o });
const alerta = (id, i = info(), emitidoEn = "2030-01-10T09:00:00.000Z") => ({ id, emitidoEn, url: "u", infos: [i] });

const DEPARTAMENTOS = [{ id: 1, nombre: "Oberá" }, { id: 2, nombre: "Cainguás" }];
const logger = { error: (m) => { throw new Error(m); }, info() {} };

test("revisar avisa en la campanita de lo nuevo y de lo que el SMN corrige en el módulo de alertas, una sola vez", async () => {
  const notis = [], claves = new Set(), pila = { vigentes: [], enFila: [] };
  const notificar = { crearSiNoExiste: async (n) => { if (claves.has(n.clave)) return false; claves.add(n.clave); notis.push(n); return true; } };
  const opciones = { logger, notificar, departamentos: () => DEPARTAMENTOS, pendientes: async () => pila, ahora: Date.parse(dia(8)) };
  const base = require("../src/lib/alertasSmnBase");
  await auto.revisar([alerta("a", info())], opciones);
  await auto.revisar([alerta("a", info())], opciones);
  assert.equal(notis.length, 1);
  assert.match(notis[0].titulo, /Alerta nueva del SMN: Tormentas · Amarillo/);
  assert.equal(notis[0].url, "/panel/alertas-meteorologicas?smn=1");
  // Se publicó en el módulo de alertas con esa emisión como base: ya no hay nada que avisar.
  const cand = base.candidata([alerta("a", info())], DEPARTAMENTOS, { ahora: Date.parse(dia(8)) });
  pila.vigentes.push({ id: 7, periodo: "Jueves", origenSmn: base.origenDe(cand) });
  await auto.revisar([alerta("a", info())], opciones);
  assert.equal(notis.length, 1);
  // El SMN la extiende (otra emisión con otro horario): avisa que actualizó la publicada.
  await auto.revisar([alerta("b", info({ fin: dia(18) }), "2030-01-10T12:00:00.000Z")], opciones);
  assert.equal(notis.length, 2);
  assert.match(notis[1].titulo, /actualizó una alerta publicada/);
  assert.match(notis[1].detalle, /vigencia hasta el/);
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

test("los asistentes de placas arrancan con lo del SMN: textos, nivel anterior, horario por día, recomendaciones y mapa", () => {
  const g = require("../src/lib/generatePlacasAlerta");
  const a = { id: 5, ...info({ categoria: "Naranja", inicio: dia(21), fin: dia(9, 1), instrucciones: "Evite circular durante la tormenta. Asegure objetos que puedan volarse. Llame al 911." }),
    cambios: [{ tipos: ["nivel"], antes: { categoria: "Amarillo" } }] };
  const b = auto.baseDe(a, g);
  assert.equal(b.ultimos.nivel.nivelAnterior, "Amarillo");
  assert.deepEqual(b.ultimos.vigencia.zonas.map((z) => `${z.fecha} ${z.desde}-${z.hasta}`), ["2030-01-10 21:00-24:00", "2030-01-11 00:00-09:00"]);
  assert.deepEqual(b.ultimos.recomendaciones.items.map((i) => i.icono), ["resguardo", "objetos", "emergencias"]);
  assert.equal(b.ultimos.aviso.zona, "Oberá y Cainguás");
  assert.ok(b.iconos.includes("alerta") && b.recomendaciones.length);
  assert.equal(auto.baseDe({ ...a, cambios: [] }, g).ultimos.nivel.nivelAnterior, "Amarillo", "sin cambio anotado: el nivel de abajo");
});
