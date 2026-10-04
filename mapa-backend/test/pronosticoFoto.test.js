const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { generarPlacaPronosticoFoto, errorDePlacaFoto, etiquetaSugerida, FONDOS, FONDOS_DIR } = require("../src/lib/generatePronosticoFoto");
const coords = require("../src/config/coordinates");

const filas = coords.map((c, i) => ({ LOCALIDAD: c.LOCALIDAD, TMIN: 15, TMAX: 27, CONDICION: i % 3 ? "lluvias" : "nublado" }));

test("las 33 fotos de fondo están y cada una tiene su etiqueta", () => {
  assert.equal(FONDOS.length, 33);
  for (const f of FONDOS) assert.ok(fs.existsSync(path.join(FONDOS_DIR, `${f.id}.jpg`)), `falta ${f.id}.jpg`);
});

test("valida foto, etiqueta y frase; sugiere la etiqueta de la condición que más se repite", () => {
  assert.equal(errorDePlacaFoto({ fondo: 6, etiqueta: "lluvia", frase: "Jornada lluviosa" }), null);
  assert.match(errorDePlacaFoto({ fondo: 99, etiqueta: "lluvia" }), /foto/);
  assert.match(errorDePlacaFoto({ fondo: 6, etiqueta: "granizo" }), /etiqueta/);
  assert.match(errorDePlacaFoto({ fondo: 6, etiqueta: "lluvia", frase: "x".repeat(200) }), /frase/);
  assert.equal(etiquetaSugerida(filas), "lluvia");
  assert.equal(etiquetaSugerida([{ CONDICION: "tormentas aisladas" }, { CONDICION: "despejado" }, { CONDICION: "lluvias y tormentas" }]), "tormenta");
  assert.equal(etiquetaSugerida([]), "despejado");
});

test("genera feed 2250×2813 e historias 2250×4000", { timeout: 60000 }, async () => {
  const { loadImage } = require("canvas");
  for (const [tamano, alto] of [["feed", 2813], ["historias", 4000]]) {
    const img = await loadImage(await generarPlacaPronosticoFoto({ forecastRows: filas, fondo: 6, etiqueta: "lluvia", frase: "Jornada con lluvias", tamano }));
    assert.deepEqual([img.width, img.height], [2250, alto], tamano);
  }
});

test("las tarjetas de las localidades salen en los tres estilos", { timeout: 60000 }, async () => {
  const { loadImage } = require("canvas");
  for (const estiloTarjeta of ["oscura", "sinCaja", "clara"]) {
    assert.equal(errorDePlacaFoto({ fondo: 6, etiqueta: "lluvia", estiloTarjeta }), null);
    const img = await loadImage(await generarPlacaPronosticoFoto({ forecastRows: filas, fondo: 6, etiqueta: "lluvia", estiloTarjeta }));
    assert.deepEqual([img.width, img.height], [2250, 2813], estiloTarjeta);
  }
  assert.match(errorDePlacaFoto({ fondo: 6, etiqueta: "lluvia", estiloTarjeta: "rosa" }), /estilo/);
});
