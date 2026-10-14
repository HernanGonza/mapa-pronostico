const test = require("node:test");
const assert = require("node:assert/strict");
const { periodosDe } = require("../src/lib/ensamble");
const { horarios } = require("../src/lib/ensambleDescargas");

const horas = (d, h) => { const r = []; for (let ms = Date.parse(`${d}:00Z`); ms <= Date.parse(`${h}:00Z`); ms += 3600e3) r.push(new Date(ms).toISOString().slice(0, 16)); return r; };
const D = "2026-10-14T09:00", H = "2026-10-15T15:00";

test("intervalos entre horas: se alinean a las 00:00 y la lluvia no cuenta la hora de inicio", () => {
  const p = periodosDe("3h", D, H, horas(D, H));
  assert.equal(p.length, 10);
  assert.deepEqual([p[0].desde, p[0].hasta, p[0].horas], ["2026-10-14T09:00", "2026-10-14T12:00", 3]);
  assert.ok(p.every((x) => x.exclusivo));
  assert.equal(periodosDe("hora", D, H, horas(D, H)).length, 30);
});

test("día, mes y año agrupan por calendario; rango es un solo período", () => {
  assert.deepEqual(periodosDe("dia", D, H, horas(D, H)).map((x) => x.horas), [15, 16]);
  assert.equal(periodosDe("mes", D, H, horas(D, H)).length, 1);
  const r = periodosDe("rango", D, H, horas(D, H));
  assert.equal(r.length, 1); assert.equal(r[0].horas, 30);
});

test("más de 240 columnas se rechaza", () => {
  assert.equal(periodosDe("hora", "2026-10-14T00:00", "2026-10-24T00:00", horas("2026-10-14T00:00", "2026-10-24T00:00")).length, 240);
  assert.throws(() => periodosDe("hora", "2026-10-14T00:00", "2026-10-25T00:00", horas("2026-10-14T00:00", "2026-10-25T00:00")), /máximo es 240/);
});

test("horarios fijos: último y próximo", () => {
  const h = horarios([5.5, 17.5], Date.parse("2026-10-14T13:38:00Z"));
  assert.equal(new Date(h.ultimo).toISOString(), "2026-10-14T05:30:00.000Z");
  assert.equal(new Date(h.proximo).toISOString(), "2026-10-14T17:30:00.000Z");
});
