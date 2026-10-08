const test = require('node:test');
const assert = require('node:assert/strict');

test('cada ACP vigente suma una notificación con zonas y hora de fin', async () => {
  const { avisarAcpNuevos } = await import('../src/lib/smn/service.mjs');
  const creadas = [];
  const notificar = { crearSiNoExiste: async (n) => { creadas.push(n); } };
  await avisarAcpNuevos([{ id: 'abc', infos: [
    { titulo: 'AVISO NARANJA por tormentas', fin: '2026-10-08T21:30:00.000Z', zonas: [{ nombre: 'Área', departamentos: ['Eldorado', 'Montecarlo'] }, { nombre: 'Posadas', departamentos: [] }] },
    { titulo: 'Otro aviso', fin: '2026-10-08T22:00:00.000Z', zonas: [] },
  ] }], { error() {} }, notificar);
  assert.equal(creadas.length, 2);
  assert.equal(creadas[0].clave, 'acp:abc:0');
  assert.equal(creadas[0].tipo, 'acp');
  assert.equal(creadas[0].url, '/panel/avisos-corto-plazo?acp=abc%3A0');
  assert.match(creadas[0].detalle, /^Eldorado, Montecarlo, Posadas · vigente hasta las 18:30 h$/);
  assert.equal(creadas[1].clave, 'acp:abc:1');
  assert.match(creadas[1].detalle, /^vigente hasta las 19:00 h$/);
});

test('si falla guardar una notificación, sigue con las demás', async () => {
  const { avisarAcpNuevos } = await import('../src/lib/smn/service.mjs');
  let llamadas = 0, errores = 0;
  const notificar = { crearSiNoExiste: async () => { llamadas++; if (llamadas === 1) throw new Error('boom'); } };
  await avisarAcpNuevos([{ id: 'x', infos: [{ titulo: 'A', fin: '2026-10-08T21:30:00.000Z', zonas: [] }, { titulo: 'B', fin: '2026-10-08T21:30:00.000Z', zonas: [] }] }], { error: () => { errores++; } }, notificar);
  assert.equal(llamadas, 2);
  assert.equal(errores, 1);
});
