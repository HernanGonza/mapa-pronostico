import assert from 'node:assert/strict';
import test from 'node:test';
import { resumirRosa } from '../src/lib/rosaVientos.js';

test('agrupa direcciones SMN y convierte bandas de velocidad sin contar datos faltantes', () => {
  const rosa = resumirRosa([
    { viento_maximo_direccion: 0, viento_maximo_intensidad: 2 },
    { viento_maximo_direccion: 36, viento_maximo_intensidad: 4 },
    { viento_maximo_direccion: 9, viento_maximo_intensidad: 7 },
    { viento_maximo_direccion: 18, viento_maximo_intensidad: 0 },
    { viento_maximo_direccion: null, viento_maximo_intensidad: 8 },
  ]);
  assert.equal(rosa.validos, 4);
  assert.equal(rosa.calmas, 1);
  assert.equal(rosa.porcentajes[0][0], 25);
  assert.equal(rosa.porcentajes[0][1], 25);
  assert.equal(rosa.porcentajes[4][2], 25);
  assert.equal(rosa.maximo, 50);
});
