const { test } = require('node:test');
const assert = require('node:assert/strict');
const { serie, fecha, vigente, tendencia } = require('../src/lib/cuencas/datos');
const NOW = Date.parse('2026-09-23T10:00:00Z');
test('lecturas ordenadas por fecha, nulos excluidos y zona regional explícita', () => {
  const rows = serie('Fecha;Nivel\n23/09/2026 06:00;4.2\n23/09/2026 07:00;4.4\n23/09/2026 07:15;\n23/09/2026 05:00;"4,1"', 'estacion', NOW);
  assert.equal(rows[0].valor, 4.4);
  assert.equal(rows[0].fecha, '2026-09-23T10:00:00.000Z');
  assert.equal(rows.length, 3);
  assert.ok(Math.abs(tendencia(rows).variacion - .2) < 1e-9);
  assert.equal(vigente(rows[0], 3, NOW + 4 * 3600000), false);
  assert.throws(() => serie('Fecha;Nivel\n23/09/2026 06:00;', 'estacion', NOW));
});
test('Chapecó usa salida turbinada + vertida + aporte y resuelve cambio de año', () => {
  const rows = serie('fecha_hora,volumen_afluente,volumen_turbinado,volumen_vertido,volumen_chapeco\n23/09 06:00,8571.75,1825.34,7162.80,871', 'usina', NOW);
  assert.equal(Math.round(rows[0].valor), 9859);
  assert.equal(fecha('31/12 23:00', Date.parse('2027-01-01T06:00:00Z')), '2027-01-01T02:00:00.000Z');
});
test('ONS tolera columnas reordenadas; no transforma vacíos en caudal cero', () => {
  assert.equal(serie('val_vazaodefluente;din_instante\n0;2026-09-23 07:00:00', 'ons', NOW)[0].valor, 0);
  assert.throws(() => serie('val_vazaodefluente;din_instante\n;2026-09-23 07:00:00', 'ons', NOW));
});
test('fallas parciales conservan solo su fuente y los datos envejecen sin nueva descarga', async () => {
  const service = require('../src/lib/cuencas/service');
  const original = global.fetch;
  let fail = false, caudal = 14000;
  const local = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  const day = `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)} ${local.slice(11, 16)}`;
  global.fetch = async url => {
    if (fail && url.includes('SAN_JAVIER')) throw new Error('fuente caída');
    let text = `din_instante;val_vazaodefluente\n${local};${caudal}`;
    if (url.includes('USINA')) text = `fecha_hora,volumen_turbinado,volumen_vertido,volumen_chapeco\n${day.slice(0, 5)} ${day.slice(11)},1000,2000,500`;
    else if (url.includes('SNIH') || url.includes('SOBERBIO') || url.includes('JAVIER')) text = `Fecha;Nivel\n${day};4`;
    else if (url.includes('.json')) text = JSON.stringify({ features: [{ geometry: { coordinates: [-54, -27] }, properties: { nombre: 'Puerto', valor: 4, fecha: new Date().toISOString() } }] });
    return { ok: true, text: async () => text };
  };
  try {
    await service.actualizarAhora({ logger: { warn() {} } });
    let result = service.obtenerActual();
    assert.equal(result.tarjetas.iguazu.estado.codigo, 'vigilancia');
    for (const [value, expected] of [[12999, 'normal'], [13000, 'vigilancia'], [16000, 'alerta'], [20000, 'emergencia']]) {
      caudal = value;
      await service.actualizarAhora({ logger: { warn() {} } });
      assert.equal(service.obtenerActual().tarjetas.iguazu.estado.codigo, expected);
    }
    fail = true; caudal = 21000;
    await service.actualizarAhora({ logger: { warn() {} } });
    result = service.obtenerActual();
    assert.equal(result.tarjetas.iguazu.valor, 21000);
    assert.equal(result.tarjetas.iguazu.estado.codigo, 'emergencia');
    assert.equal(result.tarjetas.uruguay.localidades[1].valor, 4);
    assert.match(result.error, /1 fuentes/);
    result = service.obtenerActual(Date.now() + 4 * 3600000);
    assert.equal(result.tarjetas.iguazu.estado.codigo, 'sin_datos');
    assert.equal(result.tarjetas.uruguay.estado.codigo, 'sin_datos');
  } finally { global.fetch = original; }
});
