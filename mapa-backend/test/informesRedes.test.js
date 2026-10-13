const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resumir, redactar, REDES } = require("../src/lib/informesDiarios");
const { limpiarNombre, msDe } = require("../src/lib/snihEstaciones");

const H = 3600e3, t0 = Date.parse("2026-10-12T03:00:00Z"); // 00:00 en Misiones
const hora = (h, lluvia, temperatura = 18) => ({ t: t0 + h * H, lluvia, rafaga: null, viento: 10, temperatura });

test("las estaciones horarias miden la lluvia más intensa en una hora (la lluvia de una lectura), no en 30 minutos", () => {
  const serie = [hora(0, 0), hora(1, 2.5), hora(2, 10.6), hora(3, 1)];
  const r = resumir(serie, { ventanaCaida: 60, ventanaLluvia: 60 });
  assert.equal(r.lluviaTotal, 14.1);
  assert.deepEqual([r.lluvia30.mm, r.lluvia30.minutos], [10.6, 60]);
  const diez = [0, 10, 20, 30].map((m) => ({ t: t0 + m * 60e3, lluvia: 1, rafaga: null, temperatura: 18 }));
  assert.equal(resumir(diez).lluvia30.minutos, 30, "las de 10 minutos siguen midiendo 30 minutos");
});

test("el viento medio de una estación sin ráfaga queda como viento (no se inventa una ráfaga)", () => {
  const r = resumir([hora(0, 0), { ...hora(1, 0), viento: 23 }], { ventanaCaida: 60, ventanaLluvia: 60 });
  assert.equal(r.rafaga, null);
  assert.equal(r.viento.kmh, 23);
});

const est = (red, nombre, lluviaTotal, minutos = 30) => ({ red, nombre, resumen: { sinLluvia: false, lluviaTotal, lluvia30: { mm: lluviaTotal / 2, hora: "10:00", minutos }, caida: null, rafaga: null, tMax: null, tMin: null } });
test("el texto nombra las redes que realmente están en el informe (las apagadas no figuran)", () => {
  const base = { fecha: "2026-10-12", desde: "00:00", hasta: "23:59", smn: [] };
  const todas = redactar({ ...base, estaciones: [est("INTA", "Cerro Azul", 54.8), est("RMET", "Posadas", 62.6, 60), est("RHN", "Campo Grande", 48.3, 60)] });
  assert.match(todas.split("\n")[0], /del INTA, de la Red Meteorológica \(RMET\) y de la Red Hidrológica Nacional/);
  const sinInta = redactar({ ...base, estaciones: [est("RMET", "Posadas", 62.6, 60)] });
  assert.match(sinInta.split("\n")[0], /según las estaciones automáticas de la Red Meteorológica \(RMET\)\./);
  assert.doesNotMatch(sinInta, /INTA|SiNaRaMe|Hidrológica/);
});
test("la lluvia más intensa de una estación horaria se cuenta en una hora", () => {
  const t = redactar({ fecha: "2026-10-12", desde: "00:00", hasta: "23:59", smn: [], estaciones: [est("RMET", "Posadas", 62.6, 60)] });
  assert.match(t, /en una hora/); assert.doesNotMatch(t, /en 30 minutos/);
});

test("las redes del catálogo tienen id y nombre de red únicos", () => {
  assert.equal(new Set(REDES.map((r) => r.id)).size, REDES.length);
  assert.deepEqual(REDES.map((r) => r.red), ["INTA", "SiNaRaMe", "RMET", "RHN", "SMN"]);
});

test("nombres de estaciones del SNIH: sin « - Misiones» y con coma en vez de guion", () => {
  assert.equal(limpiarNombre("Posadas - Misiones"), "Posadas");
  assert.equal(limpiarNombre("Uruguay - San Javier"), "Uruguay, San Javier");
  assert.equal(limpiarNombre("San Pedro-Araucaria - Misiones"), "San Pedro-Araucaria");
  assert.equal(msDe("/Date(1791897000000)/"), 1791897000000);
});
