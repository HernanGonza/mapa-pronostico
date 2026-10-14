const test = require("node:test");
const assert = require("node:assert/strict");
const { resumir, lecturasDe, validarPunto } = require("../src/lib/arroyos/service");

const AHORA = Date.parse("2026-10-14T12:00:00Z");
const H = 3600e3;
const punto = { id: "a", nombre: "X", arroyo: "Y", estacion: "1", lat: -27, lng: -55, vigilancia: 4, alerta: 6, corte: 8, activo: true };
const lec = (...hs) => hs.map(([h, valor]) => ({ t: AHORA - h * H, valor })); // más nueva primero

test("lecturasDe descarta -999 y ordena de más nueva a más vieja", () => {
  const r = lecturasDe({ Mediciones: [{ FechaHora: "/Date(1000)/", Mediciones: [{ Valor: 1 }] }, { FechaHora: "/Date(3000)/", Mediciones: [{ Valor: -999 }] }, { FechaHora: "/Date(2000)/", Mediciones: [{ Valor: 2 }] }] });
  assert.deepEqual(r.map((x) => x.t), [2000, 1000]);
});

test("estado por umbral y tendencia", () => {
  const r = resumir(punto, lec([1, 6.5], [5, 5.5], [25, 3]), AHORA);
  assert.equal(r.estado.codigo, "alerta");
  assert.equal(r.tendencia, "Sube");
  assert.equal(r.cambio24h, 3.5);
});

test("lectura vieja = sin datos; sin umbrales = sin_umbral; sin estación = sin_sensor", () => {
  assert.equal(resumir(punto, lec([20, 7]), AHORA).estado.codigo, "sin_datos");
  assert.equal(resumir({ ...punto, vigilancia: null, alerta: null, corte: null }, lec([1, 7]), AHORA).estado.codigo, "sin_umbral");
  assert.equal(resumir({ ...punto, estacion: null }, [], AHORA).estado.codigo, "sin_sensor");
});

test("validarPunto exige coordenadas en Misiones y umbrales ordenados", () => {
  const ok = { nombre: "A", arroyo: "B", lat: "-27,4", lng: -55.3, vigilancia: 2, alerta: 3, corte: "4" };
  assert.equal(validarPunto(ok, "id").corte, 4);
  assert.throws(() => validarPunto({ ...ok, lat: 27 }, "id"), /fuera de Misiones/);
  assert.throws(() => validarPunto({ ...ok, alerta: 5 }, "id"), /menor a mayor/);
  assert.throws(() => validarPunto({ ...ok, estacion: "abc" }, "id"), /sólo números/);
});
