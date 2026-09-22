const test = require("node:test");
const assert = require("node:assert/strict");
const { lluviaHastaLas9 } = require("../src/lib/openMeteo");

test("la lluvia FWI usa las 24 horas anteriores a las 09:00, sin anticipar lluvia futura", () => {
  const time = [];
  const precipitation = [];
  for (const fecha of ["2026-09-21", "2026-09-22"]) {
    for (let hora = 0; hora < 24; hora++) {
      time.push(`${fecha}T${String(hora).padStart(2, "0")}:00`);
      precipitation.push(hora === 10 && fecha === "2026-09-21" ? 5 : hora === 15 && fecha === "2026-09-22" ? 100 : 0);
    }
  }
  assert.equal(lluviaHastaLas9({ hourly: { time, precipitation } }, "2026-09-22"), 5);
  assert.equal(lluviaHastaLas9({ hourly: { time: time.slice(11), precipitation: precipitation.slice(11) } }, "2026-09-22"), null);
});
