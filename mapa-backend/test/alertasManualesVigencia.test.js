const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const en = (h) => new Date(Date.now() + h * 3600e3).toISOString();

test("publicar la alerta manual pide para cuándo es y una vigencia futura de hasta 72 h", () => {
  const { errorDePublicacion } = require("../src/lib/alertasMeteorologicasStore");
  assert.equal(errorDePublicacion({ periodo: "Jueves 01/10", vigenteHasta: en(10) }), null);
  assert.match(errorDePublicacion({ periodo: "  ", vigenteHasta: en(10) }), /para cuándo/);
  assert.match(errorDePublicacion({ periodo: "x".repeat(121), vigenteHasta: en(10) }), /para cuándo/);
  assert.match(errorDePublicacion({ periodo: "Hoy", vigenteHasta: en(-1) }), /futura/);
  assert.match(errorDePublicacion({ periodo: "Hoy", vigenteHasta: en(80) }), /72 horas/);
  assert.match(errorDePublicacion({ periodo: "Hoy" }), /vigente/);
  assert.match(errorDePublicacion({ periodo: "Hoy", vigenteHasta: en(5), reemplazar: ["1"] }), /reemplazar/);
});

// Base simulada, sólo con lo que usan publicar / vigentes / despublicar.
function cargarConBaseFalsa() {
  const pubs = [];
  const q = async (sql, params = []) => {
    if (/^\s*(CREATE|BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    if (sql.includes("INSERT INTO alertas_meteo_publicaciones")) {
      const r = { id: String(pubs.length + 1), publicado_en: new Date(), usuario_id: params[0], vigente_hasta: new Date(params[1]), periodo: params[2] };
      pubs.push(r); return { rows: [r] };
    }
    if (sql.includes("INSERT INTO alertas_meteo_publicacion")) return { rows: [] };
    if (sql.includes("UPDATE alertas_meteo_publicaciones SET vigente_hasta = now() WHERE id = ANY")) {
      pubs.filter((p) => params[0].includes(Number(p.id)) && p.vigente_hasta > new Date()).forEach((p) => { p.vigente_hasta = new Date(Date.now() - 1); });
      return { rowCount: 0 };
    }
    if (sql.includes("UPDATE alertas_meteo_publicaciones SET vigente_hasta = now() WHERE id = $1")) {
      const p = pubs.find((x) => x.id === String(params[0]) && x.vigente_hasta > new Date());
      if (p) p.vigente_hasta = new Date(Date.now() - 1);
      return { rowCount: p ? 1 : 0 };
    }
    if (sql.includes("WHERE vigente_hasta > now()")) return { rows: pubs.filter((p) => p.vigente_hasta > new Date()) };
    if (sql.includes("FROM alertas_meteo_publicacion_departamentos") || sql.includes("FROM alertas_meteo_publicacion_fenomenos")) return { rows: [] };
    throw new Error(`consulta no simulada: ${sql}`);
  };
  const pool = { query: q, connect: async () => ({ query: q, release() {} }) };
  const src = path.join(__dirname, "../src/lib");
  for (const m of ["store", "auth", "departamentosStore", "alertasMeteorologicasStore"]) delete require.cache[require.resolve(path.join(src, m))];
  require.cache[require.resolve(path.join(src, "store"))] = { exports: { usaPostgres: () => true, init: async () => {}, getPool: () => pool } };
  require.cache[require.resolve(path.join(src, "auth"))] = { exports: { init: async () => {} } };
  require.cache[require.resolve(path.join(src, "departamentosStore"))] = { exports: { init: async () => {} } };
  return require(path.join(src, "alertasMeteorologicasStore"));
}

test("varias vigentes a la vez; reemplazar saca la anterior; despublicar la saca antes de tiempo", async () => {
  const s = cargarConBaseFalsa();
  const hoy = await s.publicar([], [], 1, { periodo: "Hoy", vigenteHasta: en(8) });
  const manana = await s.publicar([], [], 1, { periodo: "Mañana", vigenteHasta: en(30) });
  assert.deepEqual((await s.vigentes()).map((v) => v.periodo), ["Hoy", "Mañana"]);
  const hoyCorregida = await s.publicar([], [], 1, { periodo: "Hoy (corregida)", vigenteHasta: en(8), reemplazar: [hoy.id] });
  assert.deepEqual((await s.vigentes()).map((v) => v.periodo), ["Mañana", "Hoy (corregida)"]);
  await s.despublicar(manana.id);
  assert.deepEqual((await s.vigentes()).map((v) => v.id), [hoyCorregida.id]);
  await assert.rejects(s.despublicar(manana.id), { status: 404 });
});
