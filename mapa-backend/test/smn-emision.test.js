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

test("si el último informe ya no trae alertas en Misiones, no queda ninguna vigente", async () => {
  const { ultimaEmision, vigentes } = await import("../src/lib/smn/cap.mjs");
  const rows = [alerta("a.1", "2026-09-29T12:08:42.000Z"), alerta("b", "2026-09-29T20:00:00.000Z", [])];
  assert.deepEqual(vigentes(ultimaEmision(rows)), []);
});
