const { test } = require("node:test");
const assert = require("node:assert/strict");
const pendientes = require("../src/lib/placasPendientes");

const png = (n) => Buffer.from([0x89, 0x50, 0x4e, 0x47, n]);
function respuesta() {
  const r = { code: 200, cabeceras: {}, cuerpo: null };
  r.set = (k, v) => { r.cabeceras[k] = v; return r; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}
const pedido = (body, usuarioId = 1) => ({ body, usuario: { usuarioId } });

test("vista previa: genera y NO guarda; confirmar guarda la misma imagen sin regenerar", async () => {
  let generadas = 0, guardadas = [];
  const opciones = { generar: async () => { generadas++; return { feedPng: png(1), historiasPng: png(2) }; }, guardar: async (p) => { guardadas.push(p); return { id: 7 }; } };

  const previa = respuesta();
  await pendientes.resolver(pedido({ vistaPrevia: true }), previa, opciones);
  assert.equal(previa.cuerpo.vistaPrevia, true);
  assert.match(previa.cuerpo.feedUrl, /^\/api\/placas\/pendientes\/[0-9a-f]{32}\/feed\.png$/);
  assert.equal(generadas, 1); assert.equal(guardadas.length, 0, "la vista previa no persiste nada");
  assert.ok(pendientes.obtener(previa.cuerpo.token, 1));

  const conf = respuesta();
  await pendientes.resolver(pedido({ confirmarToken: previa.cuerpo.token }), conf, opciones);
  assert.deepEqual(conf.cuerpo, { id: 7 });
  assert.equal(generadas, 1, "confirmar no vuelve a generar");
  assert.equal(guardadas.length, 1); assert.deepEqual(guardadas[0].feedPng, png(1));

  const otra = respuesta();
  await pendientes.resolver(pedido({ confirmarToken: previa.cuerpo.token }), otra, opciones);
  assert.equal(otra.code, 410, "una vista previa se confirma una sola vez");
});

test("una vista previa es de quien la generó", async () => {
  const opciones = { generar: async () => ({ feedPng: png(1), historiasPng: png(2) }), guardar: async () => ({ id: 1 }) };
  const previa = respuesta();
  await pendientes.resolver(pedido({ vistaPrevia: true }, 1), previa, opciones);
  assert.equal(pendientes.obtener(previa.cuerpo.token, 2), null);
  const ajena = respuesta();
  await pendientes.resolver(pedido({ confirmarToken: previa.cuerpo.token }, 2), ajena, opciones);
  assert.equal(ajena.code, 410);
});

test("sin vistaPrevia ni token sigue guardando directo (compatibilidad)", async () => {
  let guardadas = 0;
  const r = respuesta();
  await pendientes.resolver(pedido({}), r, { generar: async () => ({ feedPng: png(1), historiasPng: png(2) }), guardar: async () => { guardadas++; return { id: 3 }; } });
  assert.deepEqual(r.cuerpo, { id: 3 }); assert.equal(guardadas, 1);
});

test("tiene un tope de vistas previas en memoria", async () => {
  const opciones = { generar: async () => ({ feedPng: png(1), historiasPng: png(2) }), guardar: async () => ({}) };
  const tokens = [];
  for (let i = 0; i < pendientes.MAXIMO + 5; i++) { const r = respuesta(); await pendientes.resolver(pedido({ vistaPrevia: true }, 9), r, opciones); tokens.push(r.cuerpo.token); }
  assert.equal(pendientes.obtener(tokens[0], 9), null, "la más vieja se descartó");
  assert.ok(pendientes.obtener(tokens.at(-1), 9));
});
