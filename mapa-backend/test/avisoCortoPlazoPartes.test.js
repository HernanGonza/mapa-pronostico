const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateAvisoCortoPlazoMap, errorDePartes, textoDePartes } = require("../src/lib/generateAvisoCortoPlazoMap");

const partes = { fenomeno: "Tormentas fuertes con ráfagas", emision: "2026-10-03T18:04", validez: "Una (1) hora desde la emisión", zonas: "25 de Mayo - Cainguás" };
const poligono = [[-55.1, -26.8], [-54.5, -26.6], [-54.2, -27.3]];

test("el aviso por partes arma el texto en el orden de la placa", () => {
  assert.equal(textoDePartes(partes), "TORMENTAS FUERTES CON RÁFAGAS\n03/10/2026 a las 18:04hs\nValidez hasta: Una (1) hora desde la emisión\n25 de Mayo - Cainguás");
  assert.equal(textoDePartes({ ...partes, zonas: "" }).split("\n").length, 3);
});

test("valida cada parte", () => {
  assert.equal(errorDePartes(partes), null);
  assert.match(errorDePartes({ ...partes, fenomeno: " " }), /fenómeno/);
  assert.match(errorDePartes({ ...partes, emision: "03/10 18:04" }), /emisión/);
  assert.match(errorDePartes({ ...partes, validez: "" }), /validez/);
  assert.equal(errorDePartes({ ...partes, zonas: undefined }), null);
});

test("genera la placa por partes y la de texto libre de antes, con y sin nivel", async () => {
  for (const color of ["#F9881F", "#8b3fc4"]) {
    assert.ok((await generateAvisoCortoPlazoMap({ partes, fondo: "tormenta", tamano: "historias", poligono, color })).length > 100000);
    assert.ok((await generateAvisoCortoPlazoMap({ texto: "Texto libre", fondo: "nubes", tamano: "feed", poligono, color })).length > 100000);
  }
});
