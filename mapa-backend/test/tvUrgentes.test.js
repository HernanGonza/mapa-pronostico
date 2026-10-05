const { test } = require("node:test");
const assert = require("node:assert/strict");
const { aplicarCambio, conUrgentes } = require("../src/lib/tvStore");

test("por defecto, ACP y alertas: fijos 15 minutos cada 60; lo viejo (booleanos) se traduce", () => {
  assert.deepEqual(conUrgentes(null).acp, { modo: "ciclo", fijoMin: 15, cadaMin: 60, ancla: null, accion: null });
  assert.equal(conUrgentes({ acp: false, alertas: true }).acp.modo, "rotacion");
  assert.equal(conUrgentes({ acp: false, alertas: true }).alertas.modo, "ciclo");
});

test("cambia modo y tiempos, y valida", () => {
  const base = conUrgentes(null);
  const x = aplicarCambio(base, { alertas: { modo: "fijo" }, acp: { fijoMin: 1, cadaMin: 3 } });
  assert.equal(x.alertas.modo, "fijo");
  assert.deepEqual([x.acp.fijoMin, x.acp.cadaMin], [1, 3]);
  assert.throws(() => aplicarCambio(base, { acp: { fijoMin: 30, cadaMin: 20 } }), /más largo/);
  assert.throws(() => aplicarCambio(base, { acp: { modo: "otro" } }), /Modo/);
  assert.throws(() => aplicarCambio(base, { otro: {} }), /acp o alertas/);
  assert.throws(() => aplicarCambio(base, { acp: { fijoMin: 0 } }), /entre 1/);
});

test("los botones guardan cuándo y cuál, y pasan al ciclo", () => {
  const ahora = Date.parse("2026-10-06T10:00:00Z");
  const x = aplicarCambio(conUrgentes({ acp: false }), { acp: { accion: "soltar" } }, ahora);
  assert.deepEqual([x.acp.modo, x.acp.accion, x.acp.ancla], ["ciclo", "soltar", "2026-10-06T10:00:00.000Z"]);
  assert.throws(() => aplicarCambio(x, { acp: { accion: "otra" } }), /Acción/);
});
