const { test } = require("node:test");
const assert = require("node:assert/strict");

const alerta = (id, emitidoEn, infos = [{ fin: "2099-01-01T00:00:00Z" }]) => ({ id, emitidoEn, referencias: ["x"], infos });

test("sólo queda la emisión más reciente del SMN; las reemplazadas no se muestran", async () => {
  const { ultimaEmision, vigentes } = await import("../src/lib/smn/cap.mjs");
  const rows = [
    alerta("a.09.08.42.1", "2026-09-29T12:08:42.000Z"), alerta("a.09.08.42.2", "2026-09-29T12:08:42.000Z"),
    alerta("a.13.21.41.3", "2026-09-29T16:21:41.000Z"), alerta("a.13.21.41.4", "2026-09-29T16:21:41.000Z"),
  ];
  assert.deepEqual(ultimaEmision(rows).map((r) => r.id), ["a.13.21.41.3", "a.13.21.41.4"]);
  assert.deepEqual(ultimaEmision([]), []);
});

test("un informe repartido en varios segundos cuenta como una sola emisión (caso real 29/09)", async () => {
  const { ultimaEmision, vigentes } = await import("../src/lib/smn/cap.mjs");
  // El último mensaje (:44) sólo cierra una zona, sin alertas: antes el filtro
  // se quedaba con ese segundo y desaparecían todas las alertas del informe.
  const rows = [
    alerta("a.09.08.50.1", "2026-09-29T12:08:50.000Z"),
    alerta("a.13.21.41.10", "2026-09-29T16:21:41.000Z"), alerta("a.13.21.42.1", "2026-09-29T16:21:42.000Z"),
    alerta("a.13.21.43.1", "2026-09-29T16:21:43.000Z", []), alerta("a.13.21.44", "2026-09-29T16:21:44.000Z", []),
  ];
  assert.deepEqual(ultimaEmision(rows).map((r) => r.id), ["a.13.21.41.10", "a.13.21.42.1", "a.13.21.43.1", "a.13.21.44"]);
  assert.deepEqual(vigentes(ultimaEmision(rows)).map((r) => r.id), ["a.13.21.41.10", "a.13.21.42.1"]);
});

test("si el último informe ya no trae alertas en Misiones, no queda ninguna vigente", async () => {
  const { ultimaEmision, vigentes } = await import("../src/lib/smn/cap.mjs");
  const rows = [alerta("a.1", "2026-09-29T12:08:42.000Z"), alerta("b", "2026-09-29T20:00:00.000Z", [])];
  assert.deepEqual(vigentes(ultimaEmision(rows)), []);
});

test("la hora del SMN se lee como UTC aunque diga -03:00 (el SMN escribe UTC con ese sufijo)", async () => {
  const { fecha } = await import("../src/lib/smn/cap.mjs");
  // Informe con id …13.21.41 recibido a las 11:04 de Misiones: se emitió a las 10:21 de acá (13:21 UTC).
  assert.equal(fecha("2026-09-29T13:21:41-03:00"), "2026-09-29T13:21:41.000Z");
  // Franja SAT 03:00–08:59 del SMN = bloque 00–06 de Misiones.
  assert.equal(fecha("2026-09-30T03:00:00-03:00"), "2026-09-30T03:00:00.000Z");
  assert.equal(fecha("2026-09-30T03:00:00Z"), "2026-09-30T03:00:00.000Z");
  assert.throws(() => fecha("2026-09-30T03:00:00"), /fecha inválida/);
});

test("lo guardado antes del arreglo se corre 3 h una sola vez", async () => {
  const { corregirHoraVieja, RELOJ_UTC } = await import("../src/lib/smn/cap.mjs");
  const vieja = { id: "a", emitidoEn: "2026-09-29T16:21:41.000Z", infos: [{ inicio: "2026-09-30T06:00:00.000Z", fin: "2026-09-30T11:59:59.000Z" }] };
  const corregida = corregirHoraVieja(vieja);
  assert.equal(corregida.emitidoEn, "2026-09-29T13:21:41.000Z");
  assert.equal(corregida.infos[0].inicio, "2026-09-30T03:00:00.000Z");
  assert.equal(corregida.infos[0].fin, "2026-09-30T08:59:59.000Z");
  assert.equal(corregida.reloj, RELOJ_UTC);
  assert.deepEqual(corregirHoraVieja(corregida), corregida, "no se corrige dos veces");
});

test("los textos del SMN se decodifican (vienen con entidades escapadas)", async () => {
  const { textoPlano } = await import("../src/lib/smn/cap.mjs");
  assert.equal(textoPlano("El &#xE1;rea ser&#xE1; afectada; precipitaci&#243;n &amp; granizo"), "El área será afectada; precipitación & granizo");
});
