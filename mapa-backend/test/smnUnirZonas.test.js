const test = require('node:test');
const assert = require('node:assert/strict');

const info = (zona, extra = {}) => ({ evento: 'Tormentas', titulo: 'Tormentas', categoria: 'Amarillo', inicio: '2026-10-08T00:00:00.000Z', fin: '2026-10-08T11:59:59.000Z',
  descripcion: 'El área será afectada por tormentas.', zonas: [{ nombre: 'Área', departamentos: [zona], geometry: { type: 'Polygon', coordinates: [[[0, 0], [zona.length, 0], [0, 1], [0, 0]]] } }], ...extra });
const alerta = (id, emitidoEn, ...infos) => ({ id, emitidoEn, infos });

test('unirZonas junta las subzonas de una misma alerta en un solo aviso', async () => {
  const { unirZonas } = await import('../src/lib/smn/cap.mjs');
  const r = unirZonas([alerta('a', '2026-10-06T12:00:01Z', info('Norte')), alerta('b', '2026-10-06T12:00:02Z', info('Sur'))]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'b'); // el mensaje más reciente
  assert.equal(r[0].infos.length, 1);
  assert.deepEqual(r[0].infos[0].zonas.map(z => z.departamentos[0]).sort(), ['Norte', 'Sur']);
});

test('unirZonas no junta avisos de otro nivel, horario o texto, ni repite una zona', async () => {
  const { unirZonas } = await import('../src/lib/smn/cap.mjs');
  const r = unirZonas([
    alerta('a', '2026-10-06T12:00:01Z', info('Norte')),
    alerta('b', '2026-10-06T12:00:02Z', info('Sur', { categoria: 'Naranja' })),
    alerta('c', '2026-10-06T12:00:03Z', info('Centro', { fin: '2026-10-08T23:59:59.000Z' })),
    alerta('d', '2026-10-06T12:00:04Z', info('Norte')),
  ]);
  assert.equal(r.flatMap(a => a.infos).length, 3);
  const amarillo = r.flatMap(a => a.infos).find(i => i.categoria === 'Amarillo' && i.fin.startsWith('2026-10-08T11'));
  assert.equal(amarillo.zonas.length, 1);
});
