import test from 'node:test';
import assert from 'node:assert/strict';
import { analizarHistorico, escalaParaRango } from '../src/lib/historicoAnalisis.js';

test('la escala resume 64 años en años y los rangos cortos en días o meses', () => {
  assert.equal(escalaParaRango('1961-01-01', '2025-02-28'), 'anio');
  assert.equal(escalaParaRango('2024-01-01', '2024-12-31'), 'mes');
  assert.equal(escalaParaRango('2025-01-01', '2025-02-28'), 'dia');
});

test('calcula lluvia e índices de rachas sin unir huecos ni inventar faltantes', () => {
  const base = [
    ['2024-01-01', 0, 32, 22],
    ['2024-01-02', 0, 34, 23],
    ['2024-01-04', 12, 36, 24],
    ['2024-01-05', 25, 37, 25],
  ];
  const filas = base.map(([fecha, precipitacion, temperatura_maxima, temperatura_minima]) => ({
    fecha, precipitacion, temperatura_maxima, temperatura_minima, temperatura_media: (temperatura_maxima + temperatura_minima) / 2,
  }));
  const { periodos } = analizarHistorico(filas, '2024-01-01', '2024-01-05');
  assert.equal(periodos.length, 4);
  assert.equal(periodos[2].lluvia, 12);
  assert.equal(periodos[3].lluvia, 25);
  const anual = analizarHistorico(filas, '2024-01-01', '2024-12-31').anuales[0];
  assert.equal(anual.lluvia, null);
  assert.equal(anual.cdd, null);
  assert.ok(anual.coberturaLluvia < 2);
});

test('el resumen anual completo produce R10, R20, Rx1, CDD y CWD', () => {
  const filas = [];
  for (let i = 0; i < 366; i++) {
    const fecha = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    const precipitacion = i === 3 ? 12 : i === 4 ? 25 : 0;
    filas.push({ fecha, precipitacion, temperatura_maxima: 30, temperatura_minima: 20, temperatura_media: 25 });
  }
  const anual = analizarHistorico(filas, '2024-01-01', '2024-12-31').anuales[0];
  assert.equal(anual.lluvia, 37);
  assert.equal(anual.r10, 2);
  assert.equal(anual.r20, 1);
  assert.equal(anual.rx1, 25);
  assert.equal(anual.cwd, 2);
  assert.equal(anual.cdd, 361);
  assert.equal(anual.dtr, 10);
});
