const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { leerMensaje, valorEn, bits } = require("../src/lib/grib2");

// Dos campos reales del Eta 8 km del INPE (GRIB2, plantilla 5.3: empaquetado complejo con diferencias espaciales). Los valores esperados
// salen de ecCodes 2.50 (que marca los faltantes con 9999): este lector tiene que dar lo mismo.
const dir = path.join(__dirname, "fixtures");
const esperado = JSON.parse(fs.readFileSync(path.join(dir, "eta8km-esperado.json"), "utf8"));
const leer = (n) => leerMensaje(fs.readFileSync(path.join(dir, n)));

test("bits: lee anchos que no son múltiplo de 8 y cruzan bytes", () => {
  const b = Buffer.from([0b10110011, 0b01010101, 0b11110000]);
  assert.equal(bits(b, 0, 3), 0b101);
  assert.equal(bits(b, 3, 7), 0b1001101);
  assert.equal(bits(b, 6, 12), 0b110101010111);
  assert.equal(bits(b, 0, 24), 0xb355f0);
  assert.equal(bits(b, 5, 0), 0);
});

test("campo sin faltantes (punto de rocío a 2 m): rejilla, identificación y valores idénticos a ecCodes", () => {
  const m = leer("eta8km-rocio-2m.grib2"), e = esperado.rocio;
  assert.deepEqual([m.ni, m.nj, m.categoria, m.numero, m.nivelTipo, m.nivelValor], [e.ni, e.nj, 0, 6, 103, 2]);
  assert.deepEqual([m.la1, m.lo1], [-55, 270]); // el Eta recorre de sur a norte y de oeste a este
  for (const [i, v] of Object.entries(e.muestras)) assert.ok(Math.abs(m.valores[i] - v) < 1e-9, `punto ${i}: ${m.valores[i]} ≠ ${v}`);
  const suma = m.valores.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(suma - e.suma_validos) < 1e-3 * Math.abs(e.suma_validos) + 1e-6, `suma ${suma} ≠ ${e.suma_validos}`);
});

test("campo con faltantes (lluvia convectiva): los puntos sin dato son NaN y el resto coincide", () => {
  const m = leer("eta8km-acpcp-con-faltantes.grib2"), e = esperado.acpcp;
  assert.equal(m.proceso, 1); // acumulado
  assert.equal(m.valores.filter(Number.isNaN).length, e.faltantes);
  for (const [i, v] of Object.entries(e.muestras)) {
    if (v === 9999) assert.ok(Number.isNaN(m.valores[i]), `el punto ${i} debería faltar`);
    else assert.ok(Math.abs(m.valores[i] - v) < 1e-9, `punto ${i}: ${m.valores[i]} ≠ ${v}`);
  }
  const suma = m.valores.reduce((a, b) => (Number.isNaN(b) ? a : a + b), 0);
  assert.ok(Math.abs(suma - e.suma_validos) < 1e-3 * e.suma_validos, `suma ${suma} ≠ ${e.suma_validos}`);
});

test("valorEn: interpola entre los 4 vecinos y devuelve null fuera de la rejilla", () => {
  const m = leer("eta8km-rocio-2m.grib2");
  const posadas = valorEn(m, -27.3671, -55.8961);
  assert.ok(posadas > 270 && posadas < 300, `rocío de ${posadas} K en Posadas`);
  assert.equal(valorEn(m, 60, -55), null); // al norte del dominio (llega a 19,4°N)
  assert.equal(valorEn(m, -27, 10), null); // fuera de las longitudes (270–340°E)
});

test("identificar: reconoce el campo con sólo el principio del mensaje", () => {
  const b = fs.readFileSync(path.join(dir, "eta8km-acpcp-con-faltantes.grib2"));
  const id = require("../src/lib/grib2").identificar(b.subarray(0, 220));
  assert.deepEqual([id.categoria, id.numero, id.nivelTipo, id.nivelValor, id.proceso, id.largoRangoHoras], [1, 10, 1, null, 1, 1]); // lluvia convectiva, acumulado de 1 h
  assert.equal(id.largo, b.length);
});
