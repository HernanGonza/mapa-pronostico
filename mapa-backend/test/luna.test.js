const { test } = require("node:test");
const assert = require("node:assert/strict");
const { lunaDeMunicipio, faseDe, FASES } = require("../src/lib/luna");
const { loadMunicipios } = require("../src/lib/municipios");

const posadas = loadMunicipios().find((m) => /posadas/i.test(m.nombre));

test("faseDe reparte el ciclo en las ocho fases, con la nueva alrededor de 0 y de 1", () => {
  assert.equal(faseDe(0).id, "nueva");
  assert.equal(faseDe(0.99).id, "nueva");
  assert.equal(faseDe(0.125).id, "creciente");
  assert.equal(faseDe(0.25).id, "cuarto-creciente");
  assert.equal(faseDe(0.375).id, "gibosa-creciente");
  assert.equal(faseDe(0.5).id, "llena");
  assert.equal(faseDe(0.625).id, "gibosa-menguante");
  assert.equal(faseDe(0.75).id, "cuarto-menguante");
  assert.equal(faseDe(0.875).id, "menguante");
  assert.equal(new Set(FASES.map((f) => f.icono)).size, 8, "cada fase tiene su ícono");
});

test("la fase coincide con el calendario lunar (luna nueva 10/10/2026, llena 26/10/2026)", () => {
  assert.equal(lunaDeMunicipio(posadas.id, "2026-10-10").faseId, "nueva");
  assert.ok(lunaDeMunicipio(posadas.id, "2026-10-10").iluminacion <= 2);
  const llena = lunaDeMunicipio(posadas.id, "2026-10-26");
  assert.equal(llena.faseId, "llena");
  assert.ok(llena.iluminacion >= 98);
});

test("la luna llena sale cerca del atardecer y se pone cerca del amanecer, en hora argentina", () => {
  const { sale, sePone } = lunaDeMunicipio(posadas.id, "2026-10-26");
  assert.match(sale, /^\d{2}:\d{2}$/); assert.match(sePone, /^\d{2}:\d{2}$/);
  assert.ok(sale >= "17:00" && sale <= "21:00", `salida ${sale}`);
  assert.ok(sePone >= "04:00" && sePone <= "08:00", `puesta ${sePone}`);
});

test("un municipio o una fecha inválidos dan null", () => {
  assert.equal(lunaDeMunicipio("no-existe", "2026-10-10"), null);
  assert.equal(lunaDeMunicipio(posadas.id, "mañana"), null);
});

test("cerca de la luna nueva la luna sale antes del amanecer y se pone de tarde (San Pedro, 8/10/2026: MET Noruega da 04:43 y 16:55)", () => {
  const sanPedro = loadMunicipios().find((m) => /^SAN PEDRO$/i.test(m.nombre));
  const { sale, sePone, faseId } = lunaDeMunicipio(sanPedro.id, "2026-10-08");
  assert.equal(faseId, "menguante");
  const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  assert.ok(Math.abs(min(sale) - min("04:43")) <= 5, `salida ${sale}`);
  assert.ok(Math.abs(min(sePone) - min("16:55")) <= 5, `puesta ${sePone}`);
});
