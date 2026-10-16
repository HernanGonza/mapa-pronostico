const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/lib/serieHoraria");

const H = 3600e3, t0 = Date.parse("2026-10-16T00:00:00Z");
const horas = Array.from({ length: 13 }, (_, i) => t0 + i * H);

test("horasDelRango: de 7 días atrás a 9 adelante, horas de Misiones", () => {
  const { horas: h, ms } = S.horasDelRango(Date.parse("2026-10-16T15:00:00Z"));
  assert.equal(h[0], "2026-10-09T00:00");
  assert.equal(h.at(-1), "2026-10-25T23:00");
  assert.equal(h.length, 17 * 24);
  assert.equal(ms[0], Date.parse("2026-10-09T03:00:00Z")); // las 00:00 de Misiones son las 03:00 UTC
});

test("interpolar: lineal entre muestras y null fuera de ellas o con un hueco largo", () => {
  const r = S.interpolar([{ ms: t0 + 3 * H, v: 10 }, { ms: t0 + 9 * H, v: 22 }], horas);
  assert.equal(r[0], null);
  assert.equal(r[3], 10);
  assert.equal(r[6], 16);
  assert.equal(r[9], 22);
  assert.equal(r[12], null);
  const hueco = S.interpolar([{ ms: t0, v: 0 }, { ms: t0 + 12 * H, v: 12 }], horas); // 12 h de hueco: no se inventa
  assert.deepEqual([hueco[0], hueco[6], hueco[12]], [0, null, 12]);
});

test("repartirAcumulado: lo caído en 6 h se reparte parejo entre esas horas (la hora que termina en t va en t)", () => {
  const r = S.repartirAcumulado([{ ms: t0 + 6 * H, mm: 12, horas: 6 }], horas);
  assert.deepEqual(r.slice(0, 7), [null, 2, 2, 2, 2, 2, 2]);
  assert.equal(r[7], null);
  assert.equal(S.repartirAcumulado([{ ms: t0 + 3 * H, mm: -0.01, horas: 1 }], horas)[3], 0); // los -0.0 del modelo no son lluvia negativa
});

test("viento: velocidad en km/h y dirección de DONDE sopla", () => {
  assert.equal(Math.round(S.velocidadKmh(3, 4)), 18); // 5 m/s
  assert.equal(Math.round(S.direccionViento(0, -5)), 0);   // viento del norte (empuja hacia el sur)
  assert.equal(Math.round(S.direccionViento(-5, 0)), 90);  // del este
  assert.equal(Math.round(S.direccionViento(0, 5)), 180);  // del sur
  assert.equal(Math.round(S.direccionViento(5, 0)), 270);  // del oeste
});

test("humedad y punto de rocío son inversos entre sí", () => {
  const td = S.puntoDeRocio(20, 50);
  assert.ok(Math.abs(td - 9.3) < 0.2, `rocío ${td}`);
  assert.ok(Math.abs(S.humedadRelativa(20, td) - 50) < 0.1);
  assert.equal(S.humedadRelativa(10, 15), 100); // el rocío no puede superar la temperatura
});
