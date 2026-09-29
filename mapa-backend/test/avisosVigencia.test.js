const { test } = require("node:test");
const assert = require("node:assert/strict");
const { errorDeVigencia, MAX_VIGENCIA_HORAS } = require("../src/lib/avisosCortoPlazoStore");

const enHoras = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

test("la vigencia tiene que ser una fecha futura y de hasta 72 horas", () => {
  assert.equal(errorDeVigencia(enHoras(2)), null);
  assert.equal(errorDeVigencia(enHoras(MAX_VIGENCIA_HORAS - 0.1)), null);
  assert.match(errorDeVigencia(enHoras(-1)), /futura/);
  assert.match(errorDeVigencia(enHoras(MAX_VIGENCIA_HORAS + 1)), /72 horas/);
  for (const malo of [undefined, null, "", "mañana", 12345]) assert.match(errorDeVigencia(malo), /Elegí/, String(malo));
});
