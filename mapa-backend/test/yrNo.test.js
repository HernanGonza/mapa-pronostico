const { test } = require("node:test");
const assert = require("node:assert/strict");
const { columnas, stampART } = require("../src/lib/yrNo");

// Dos pasos horarios y uno de 6 h (sin next_1_hours), como los devuelve Locationforecast.
const respuesta = { properties: { timeseries: [
  { time: "2026-10-16T14:00:00Z", data: { instant: { details: { air_temperature: 22.6, apparent_air_temperature: 23, wind_speed: 5, wind_from_direction: 200, relative_humidity: 60, cloud_area_fraction: 20, dew_point_temperature: 14 } }, next_1_hours: { details: { precipitation_amount: 1.2 } } } },
  { time: "2026-10-16T15:00:00Z", data: { instant: { details: { air_temperature: 24 } }, next_1_hours: { details: { precipitation_amount: 0.4 } } } },
  { time: "2026-10-19T06:00:00Z", data: { instant: { details: { air_temperature: 30 } }, next_6_hours: { details: { precipitation_amount: 3 } } } },
] } };

test("stampART pasa de UTC a la hora de Misiones (UTC−3)", () => {
  assert.equal(stampART(Date.parse("2026-10-16T14:00:00Z")), "2026-10-16T11:00");
  assert.equal(stampART(Date.parse("2026-10-16T01:00:00Z")), "2026-10-15T22:00");
});

test("columnas: variables en las unidades de Open-Meteo y lluvia en la hora en que termina", () => {
  const horas = ["2026-10-16T11:00", "2026-10-16T12:00", "2026-10-16T13:00", "2026-10-19T03:00"];
  const c = columnas(respuesta, new Map(horas.map((h, i) => [h, i])), horas.length);
  assert.deepEqual(c.temperature_2m, [22.6, 24, null, null]);   // el paso de 6 h no se usa
  assert.equal(c.wind_speed_10m[0], 18);                          // 5 m/s = 18 km/h
  assert.equal(c.apparent_temperature[0], 23);
  // la lluvia de «next_1_hours» de las 14Z (11:00 ART) es la de la hora 11–12: en Open-Meteo va en las 12:00
  assert.deepEqual(c.precipitation, [null, 1.2, 0.4, null]);
});
