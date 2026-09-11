const test = require('node:test');
const assert = require('node:assert/strict');
const { errorDeRecomendaciones } = require('../src/lib/generateAlertaMap');

test('valida texto libre, emojis y límites antes de generar', () => {
  assert.equal(errorDeRecomendaciones('⚠️ Atención\n\n🏠 Quedate en casa', 'tormenta'), null);
  for (const texto of [null, {}, '', ' \n ', 'a'.repeat(2401)]) assert.ok(errorDeRecomendaciones(texto, 'nubes'));
  assert.ok(errorDeRecomendaciones('Atención', '../fondo'));
});

test('guarda recomendaciones con nombres descriptivos y devuelve los mismos para descargar', async t => {
  const storage = require('../src/lib/storage');
  const uploads = [];
  t.mock.method(storage, 'subirArchivo', async (path, buffer) => { uploads.push({ path, buffer }); });
  t.mock.method(storage, 'urlPublica', path => `https://storage.example/${path}`);
  delete require.cache[require.resolve('../src/lib/placasMeteoStore')];
  const { crearRecomendaciones } = require('../src/lib/placasMeteoStore');
  const result = await crearRecomendaciones({ fondo: 'tormenta', feedPng: Buffer.from('feed'), historiasPng: Buffer.from('historias') });
  assert.equal(uploads.length, 2);
  assert.match(result.feedNombre, /^recomendaciones-feed-tormenta-\d{4}-\d{2}-\d{2}\.png$/);
  assert.match(result.historiasNombre, /^recomendaciones-historias-tormenta-\d{4}-\d{2}-\d{2}\.png$/);
  assert.ok(result.feedUrl.endsWith('/' + result.feedNombre));
  assert.ok(result.historiasUrl.endsWith('/' + result.historiasNombre));
  assert.equal(uploads[0].buffer.toString(), 'feed');
  assert.equal(uploads[1].buffer.toString(), 'historias');
});
