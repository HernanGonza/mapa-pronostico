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
