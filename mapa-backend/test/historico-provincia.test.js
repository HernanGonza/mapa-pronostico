const { test, after } = require("node:test");
const assert = require("node:assert/strict");

// Necesita un Postgres descartable: TEST_DATABASE_URL=postgresql://usuario@127.0.0.1:5432/postgres npm test
// Trabaja en un schema propio y temporal (se borra al terminar): nunca toca `public` ni `alerta_temprana`.
const URL_PRUEBA = process.env.TEST_DATABASE_URL;
const SCHEMA = `test_historico_${process.pid}`;
const saltar = !URL_PRUEBA && "sin TEST_DATABASE_URL";

let store, historico;
if (!saltar) {
  process.env.DATABASE_URL = URL_PRUEBA;
  process.env.DATABASE_SSL = "false";
  process.env.DATABASE_SCHEMA = SCHEMA;
  store = require("../src/lib/store");
  historico = require("../src/lib/historicoEstacionesStore");
}
after(async () => {
  if (saltar) return;
  await store.getPool()?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await store.getPool()?.end();
});

const dias = (a, b) => { const o = []; for (let t = Date.parse(a); t <= Date.parse(b); t += 86400000) o.push(new Date(t).toISOString().slice(0, 10)); return o; };

test("toda la provincia combina las estaciones que ya existían en cada fecha", { skip: saltar }, async () => {
  await historico.init();
  const db = store.getPool();
  // Iguazú y Posadas desde 1980; Bernardo de Irigoyen recién desde 1984. Iguazú no informó 1982-06-15
  // y Bernardo no informó 1985-03-10 (ya existía): esos dos días no se pueden combinar.
  const estaciones = [
    ["iguazu_aero", "1980-01-01", 10, 30, ["1982-06-15"]],
    ["posadas_aero", "1980-01-01", 5, 20, []],
    ["bernardo_de_irigoyen_aero", "1984-01-01", 1, 25, ["1985-03-10"]],
  ];
  for (const [id, desde, lluvia, tmax, faltan] of estaciones) {
    for (const f of dias(desde, "1985-12-31").filter((d) => !faltan.includes(d))) {
      await db.query(`INSERT INTO observaciones_historicas (estacion_id, fecha, temperatura_maxima, temperatura_minima, temperatura_media, precipitacion)
        VALUES ($1, $2::date, $3::numeric, $3::numeric - 10, $3::numeric - 5, $4::numeric)`, [id, f, tmax, lluvia]);
    }
  }
  const serie = await historico.obtenerSerie("toda_provincia", null, null);
  const dia = (f) => serie.find((x) => x.fecha === f);

  assert.equal(serie[0].fecha, "1980-01-01", "la serie arranca cuando hay dos estaciones, no en 1984");
  assert.equal(dia("1980-01-01").precipitacion, 15, "antes de 1984: Iguazú + Posadas");
  assert.equal(dia("1980-01-01").temperatura_maxima, 25, "antes de 1984: promedio de las dos");
  assert.equal(dia("1983-12-31").precipitacion, 15);
  assert.equal(dia("1984-01-01").precipitacion, 16, "desde 1984: las tres");
  assert.ok(Math.abs(dia("1984-01-01").temperatura_maxima - 25) < 1e-9);
  assert.equal(dia("1982-06-15"), undefined, "falta una estación que ya existía: no se suma como si valiera 0");
  assert.equal(dia("1985-03-10"), undefined);

  const [prov] = await historico.obtenerResumen();
  assert.equal(prov.desde, "1980-01-01");
  assert.equal(prov.hasta, "1985-12-31");
  assert.equal(prov.dias, serie.length);
});
