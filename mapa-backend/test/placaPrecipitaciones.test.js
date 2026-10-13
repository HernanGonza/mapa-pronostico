const test = require("node:test");
const assert = require("node:assert");
const { generarPlacaPrecipitaciones, errorDePlacaPrecipitaciones, anomaliaDe } = require("../src/lib/generatePlacaPrecipitaciones");

const filas = [{ nombre: "Posadas", nota: 3, periodo: "214,4", mes: 257, media: 253.4 }, { nombre: "Cerro Azul", nota: 2, periodo: 138, mes: 196.3, media: 227.6 }];

test("la anomalía sale de mes − media, o la escrita", () => {
  assert.equal(anomaliaDe(filas[0]), 3.6);
  assert.equal(anomaliaDe(filas[1]), -31.3);
  assert.equal(anomaliaDe({ ...filas[0], anomalia: "5" }), 5);
  assert.equal(anomaliaDe({ periodo: 1 }), null);
});

test("valida los datos", () => {
  const ok = { subtitulo: "Provincia de Misiones", periodo: "8 al 13/10", filas, fondo: 6 };
  assert.equal(errorDePlacaPrecipitaciones(ok), null);
  assert.match(errorDePlacaPrecipitaciones({ ...ok, filas: [] }), /al menos una/);
  assert.match(errorDePlacaPrecipitaciones({ ...ok, fondo: 20 }), /foto/);
  assert.match(errorDePlacaPrecipitaciones({ ...ok, periodo: "" }), /período/);
  assert.match(errorDePlacaPrecipitaciones({ ...ok, filas: [{ nombre: "X", periodo: "abc" }] }), /no es un número/);
});

test("genera feed e historias con las medidas de siempre (la marca de agua no es opcional)", async () => {
  const datos = { subtitulo: "Provincia de Misiones", periodo: "8 al 13/10", filas, fondo: 6 };
  const feed = await generarPlacaPrecipitaciones({ ...datos, tamano: "feed" });
  const hist = await generarPlacaPrecipitaciones({ ...datos, tamano: "historias", fondo: 3 });
  assert.equal(feed.readUInt32BE(16), 2250); assert.equal(feed.readUInt32BE(20), 2813);
  assert.equal(hist.readUInt32BE(20), 4000);
  await assert.rejects(generarPlacaPrecipitaciones({ ...datos, tamano: "x" }), /Tamaño/);
});
