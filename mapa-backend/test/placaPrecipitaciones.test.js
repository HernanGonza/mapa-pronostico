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

test("la placa lleva firma invisible y metadatos de autoría (siempre)", async () => {
  const { createCanvas, loadImage } = require("canvas");
  const { detectarFirma, leerTextos } = require("../src/lib/proteccionPlaca");
  const png = await generarPlacaPrecipitaciones({ subtitulo: "Provincia de Misiones · Octubre 2026", periodo: "8 al 13/10", filas, fondo: 8, tamano: "feed", fecha: "2026-10-13" });
  const t = leerTextos(png);
  assert.match(t.Author, /Alerta Temprana/); assert.match(t.Copyright, /2026 Gobierno de Misiones/); assert.equal(t["AI-Training"], "prohibited");
  const img = await loadImage(png), c = createCanvas(img.width, img.height), ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  assert.equal(detectarFirma(ctx.getImageData(0, 0, img.width, img.height)), "GOB-MNES-ALERTA-TEMP-20261013___");
  // una imagen sin firma no da la firma
  const vacia = createCanvas(400, 400).getContext("2d"); vacia.fillStyle = "#345"; vacia.fillRect(0, 0, 400, 400);
  assert.notEqual(detectarFirma(vacia.getImageData(0, 0, 400, 400)), "GOB-MNES-ALERTA-TEMP-20261013___");
});
