const { test } = require("node:test");
const assert = require("node:assert/strict");
const { horaria, juntar } = require("../src/lib/observaciones");
const { parsear, descomprimirZip } = require("../src/lib/smnPronostico");
const { asignar, dentro } = require("../src/lib/asignarEstaciones");
const zlib = require("node:zlib");

const H = 3600e3, t0 = Date.parse("2026-10-16T03:00:00Z"); // las 00:00 de Misiones
const horas = Array.from({ length: 6 }, (_, i) => t0 + i * H);

test("horaria: lo instantáneo es el promedio a ±30 min de la hora, la ráfaga el máximo y la lluvia la suma de la hora que termina en t", () => {
  const s = horaria([
    { ms: t0 + 10 * 60e3, temp: 20, rafaga: 30, lluvia: 0.2 },        // 00:10
    { ms: t0 + 50 * 60e3, temp: 22, rafaga: 40, lluvia: 0.3 },        // 00:50 → ya cuenta para la hora 01:00 (promedio) y 01:00 (lluvia)
    { ms: t0 + 1 * H, temp: 21, rafaga: 10, lluvia: 0.1 },            // 01:00 en punto
    { ms: t0 + 3 * H, temp: 18, lluvia: 0 },
  ], horas);
  assert.equal(s.temp[0], 20);                    // sólo la de las 00:10
  assert.equal(s.temp[1], 21.5);                  // 00:50 y 01:00
  assert.equal(s.rafaga[1], 40);
  assert.equal(s.lluvia[0], null);                // ninguna lectura cae en (23:00, 00:00]
  assert.equal(Math.round(s.lluvia[1] * 10) / 10, 0.6); // 00:10 + 00:50 + 01:00
  assert.equal(s.lluvia[3], 0);                   // hubo lectura: un cero medido es un dato
  assert.equal(s.lluvia[2], null);                // sin lecturas no se inventan ceros
  assert.equal(s.temp[4], null);
});

test("juntar: promedia las estaciones hora a hora ignorando las que no tienen lectura (y el máximo para ráfagas)", () => {
  const a = { temp: [10, null, 12], rafaga: [5, null, 9] }, b = { temp: [20, 30, null], rafaga: [7, 8, null] };
  assert.deepEqual(juntar([a, b], "temp"), [15, 30, 12]);
  assert.deepEqual(juntar([a, b], "rafaga", "max"), [7, 8, 9]);
});

test("pronóstico del SMN: lee la hora de Misiones y sólo las estaciones de Misiones", () => {
  const texto = [
    " AEROPARQUE", " ================", "      FECHA *          TEMPERATURA      VIENTO      PRECIPITACION(mm)", "                                     (DIR | KM/H)", " ================",
    "  16/OCT/2026 00Hs.        12.8       156 |  16         0.2 ", "",
    " POSADAS_AERO", " ================", "      FECHA *          TEMPERATURA      VIENTO      PRECIPITACION(mm)", "                                     (DIR | KM/H)", " ================",
    "  16/OCT/2026 00Hs.        13.4       193 |   4         0.0 ", "  16/OCT/2026 03Hs.        12.5       242 |   4         1.2 ",
  ].join("\r\n");
  const r = parsear(texto);
  assert.deepEqual(Object.keys(r), ["POSADAS_AERO"]);
  assert.equal(r.POSADAS_AERO.length, 2);
  assert.equal(r.POSADAS_AERO[0].ms, Date.parse("2026-10-16T00:00:00-03:00"));
  assert.deepEqual([r.POSADAS_AERO[1].temp, r.POSADAS_AERO[1].dir, r.POSADAS_AERO[1].viento, r.POSADAS_AERO[1].lluvia], [12.5, 242, 4, 1.2]);
});

test("descomprimirZip: abre un zip de un solo archivo", () => {
  const dato = Buffer.from("hola pronóstico");
  const comp = zlib.deflateRawSync(dato), nombre = Buffer.from("a.txt");
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(dato.length, 22); local.writeUInt16LE(nombre.length, 26);
  assert.equal(descomprimirZip(Buffer.concat([local, nombre, comp])).toString(), "hola pronóstico");
});

test("asignarEstaciones: una estación adentro del departamento le corresponde a ese departamento; las ciudades usan un radio", () => {
  const cuadrado = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  assert.ok(dentro(cuadrado, 5, 5)); assert.ok(!dentro(cuadrado, 11, 5));
  // Posadas Aero (SMN) cae en el departamento Capital (id 4); a la ciudad «ciudad:X» sólo si está a menos de 25 km
  const r = asignar([{ id: "4", lat: -27.55, lng: -55.86 }, { id: "ciudad:Posadas", lat: -27.37, lng: -55.9 }, { id: "ciudad:Lejos", lat: -26, lng: -54 }], [{ lat: -27.39, lng: -55.97 }]);
  assert.deepEqual(r, [[0], [0], []]);
});
