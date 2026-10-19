const test = require('node:test');
const assert = require('node:assert/strict');
const { zonasEn, errorDeTramos, normalizarTramos } = require('../src/lib/tramosAlerta');

const zonas = [{ id: '1', categoria: 'Naranja' }, { id: '2', categoria: 'Naranja' }, { id: '3', categoria: 'Amarillo' }];
const h = (hora) => `2026-10-09T${hora}:00.000Z`;
const tramos = { 1: [{ categoria: 'Naranja', hasta: h('06:00') }, { categoria: 'Amarillo', hasta: h('12:00') }], 2: [{ categoria: 'Naranja', hasta: h('18:00') }] };
const en = (hora) => Date.parse(h(hora));

test('sin tramos las zonas quedan como se publicaron', () => {
  assert.deepEqual(zonasEn(zonas, {}, en('03:00')), zonas);
  assert.deepEqual(zonasEn(zonas, undefined, en('03:00')), zonas);
});

test('cada departamento pasa de nivel cuando termina su tramo', () => {
  const nivel = (hora) => Object.fromEntries(zonasEn(zonas, tramos, en(hora)).map((z) => [z.id, z.categoria]));
  assert.deepEqual(nivel('03:00'), { 1: 'Naranja', 2: 'Naranja', 3: 'Amarillo' });
  assert.deepEqual(nivel('08:00'), { 1: 'Amarillo', 2: 'Naranja', 3: 'Amarillo' });
  assert.deepEqual(nivel('13:00'), { 1: 'Verde', 2: 'Naranja', 3: 'Amarillo' });
  assert.deepEqual(nivel('19:00'), { 1: 'Verde', 2: 'Verde', 3: 'Amarillo' });
});

test('valida los tramos', () => {
  const ids = new Set(['1', '2', '3']);
  const tope = h('23:00');
  assert.equal(errorDeTramos(tramos, ids, tope), null);
  assert.match(errorDeTramos({ 9: tramos[1] }, ids, tope), /desconocido/);
  assert.match(errorDeTramos({ 1: [{ categoria: 'Azul', hasta: h('06:00') }] }, ids, tope), /Nivel/);
  assert.match(errorDeTramos({ 1: [{ categoria: 'Naranja', hasta: h('06:00') }, { categoria: 'Amarillo', hasta: h('05:00') }] }, ids, tope), /después del anterior/);
  assert.match(errorDeTramos({ 1: [{ categoria: 'Naranja', hasta: h('23:30') }] }, ids, tope), /vigencia de la alerta/);
  assert.match(errorDeTramos({ 1: [{ categoria: 'Naranja' }] }, ids, tope), /hora de fin/);
});

test('normaliza y omite departamentos sin tramos', () => {
  assert.deepEqual(normalizarTramos({ 1: tramos[1], 2: [] }), { 1: tramos[1] });
});

test('un ícono de dos colores deja el que sigue vigente', () => {
  const { iconosEn } = require('../src/lib/tramosAlerta');
  const icono = { id: 'tormenta', categoria: 'Naranja', categoria2: 'Amarillo' };
  const z = (...c) => c.map((categoria, i) => ({ id: String(i), categoria }));
  assert.deepEqual(iconosEn([icono], z('Naranja', 'Amarillo')), [icono]);
  assert.deepEqual(iconosEn([icono], z('Amarillo', 'Amarillo', 'Verde')), [{ id: 'tormenta', categoria: 'Amarillo' }]);
  assert.deepEqual(iconosEn([icono], z('Naranja', 'Verde')), [{ id: 'tormenta', categoria: 'Naranja' }]);
  assert.deepEqual(iconosEn([icono], z('Verde')), [icono]);
  assert.deepEqual(iconosEn([{ id: 'x', categoria: 'Rojo' }], z('Amarillo')), [{ id: 'x', categoria: 'Rojo' }]);
});

test("publicarDesde: una alerta que empieza en más de 12 h queda programada 12 h antes; si no, se publica ya", () => {
  const { publicarDesde } = require("../src/lib/tramosAlerta");
  const ahora = Date.parse("2026-10-19T12:00:00Z"), h = (n) => new Date(ahora + n * 3600e3).toISOString();
  const zonas = [{ id: "1", categoria: "Naranja" }, { id: "2", categoria: "Verde" }];
  const t = (n) => ({ 1: [{ categoria: "Verde", hasta: h(n) }, { categoria: "Naranja", hasta: h(n + 6) }] });
  assert.equal(publicarDesde(zonas, t(48), ahora).toISOString(), h(36));
  assert.equal(publicarDesde(zonas, t(10), ahora), null);
  assert.equal(publicarDesde(zonas, {}, ahora), null); // sin tramos: ya está vigente
  assert.equal(publicarDesde([{ id: "1", categoria: "Naranja" }, { id: "3", categoria: "Rojo" }], t(48), ahora), null); // otro departamento arranca ya
  assert.equal(publicarDesde(zonas, {}, ahora, h(48)).toISOString(), h(36)); // sin tramos, pero el SMN dice cuándo empieza
  assert.equal(publicarDesde(zonas, {}, ahora, h(-2)), null);
  assert.equal(publicarDesde([{ id: "2", categoria: "Verde" }], {}, ahora), null);
});
