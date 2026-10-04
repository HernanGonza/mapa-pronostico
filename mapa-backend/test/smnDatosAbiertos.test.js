const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parsearHorario, parsearExtremas } = require("../src/lib/smnDatosAbiertos");
const { resumir, redactar } = require("../src/lib/informesDiarios");

// Renglones copiados de los archivos reales del 03/10/2026 (ancho fijo, columnas vacías sin dato).
const HORARIO = [
  "  FECHA     HORA  TEMP   HUM   PNM    DD    FF     NOMBRE                                             ",
  "          [HOA]  [ºC]   [%]  [hPa]  [gr] [km/hr]                                                     ",
  " 03102026    16  29.6   45  1004.1   20   19     POSADAS AERO                                        ",
  " 03102026    17  18.5   90  1008.0  200   39     POSADAS AERO                                        ",
  " 03102026     0   3.5   88          270   20     BARILOCHE AERO                                      ",
].join("\r\n");
const EXTREMAS = [
  " FECHA    TMAX  TMIN  NOMBRE                                                    ",
  " -------- ----- ----- ----------------------------------------                  ",
  " 03102026  30.8  15.0 POSADAS AERO                                              ",
  " 03102026        10.6 CAMPO DE MAYO AERO                                        ",
].join("\r\n");

test("lee los datos horarios del SMN respetando las columnas vacías", () => {
  const f = parsearHorario(HORARIO);
  assert.equal(f.length, 3);
  assert.deepEqual(f[1], { fecha: "2026-10-03", hora: 17, temp: 18.5, hum: 90, pnm: 1008, dd: 200, ff: 39, estacion: "POSADAS AERO" });
  assert.equal(f[2].pnm, null);
  assert.equal(f[2].dd, 270);
});

test("el histórico viene sin el espacio de adelante y se lee igual", () => {
  assert.deepEqual(parsearHorario("03102026     0   3.5   88          270   20     BARILOCHE AERO      ")[0],
    { fecha: "2026-10-03", hora: 0, temp: 3.5, hum: 88, pnm: null, dd: 270, ff: 20, estacion: "BARILOCHE AERO" });
  assert.deepEqual(parsearExtremas("03102026        10.6 CAMPO DE MAYO AERO   ")[0], { fecha: "2026-10-03", tmax: null, tmin: 10.6, estacion: "CAMPO DE MAYO AERO" });
});

test("lee las temperaturas extremas del SMN", () => {
  const f = parsearExtremas(EXTREMAS);
  assert.deepEqual(f[0], { fecha: "2026-10-03", tmax: 30.8, tmin: 15, estacion: "POSADAS AERO" });
  assert.deepEqual(f[1], { fecha: "2026-10-03", tmax: null, tmin: 10.6, estacion: "CAMPO DE MAYO AERO" });
});

test("con datos horarios sin lluvia: no dice que no llovió y la caída se mide en una hora", () => {
  const t = (h) => Date.parse(`2026-10-03T${h}:00:00-03:00`);
  const serie = [{ t: t(15), lluvia: 0, rafaga: null, viento: 15, temperatura: 30 }, { t: t(16), lluvia: 0, rafaga: null, viento: 19, temperatura: 29.6 }, { t: t(17), lluvia: 0, rafaga: null, viento: 39, temperatura: 18.5 }];
  const r = resumir(serie, { sinLluvia: true, ventanaCaida: 60 });
  assert.equal(r.lluviaTotal, null);
  assert.deepEqual(r.caida, { grados: 11.1, hora: "16:00", t: t(16), minutos: 60 });
  assert.deepEqual(r.viento, { kmh: 39, hora: "17:00" });
  assert.equal(r.sinViento, false);
  const texto = redactar({ fecha: "2026-10-03", desde: "00:00", hasta: "23:59", smn: [],
    estaciones: [{ nombre: "Posadas Aero", red: "SMN", resumen: r, extremas: { tmax: 30.8, tmin: 15 } }] });
  assert.doesNotMatch(texto, /No se registraron lluvias/);
  assert.match(texto, /Posadas Aero a las 16:00 h \(−11,1 °C en una hora\)/);
  assert.match(texto, /extremas oficiales del SMN: Posadas Aero máx\. 30,8 °C \/ mín\. 15 °C/);
});
