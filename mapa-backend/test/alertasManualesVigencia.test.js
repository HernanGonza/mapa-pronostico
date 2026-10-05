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
  const pubs = [], eventos = [];
  const q = async (sql, params = []) => {
    if (/^\s*(CREATE|BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    if (sql.includes("INSERT INTO alertas_meteo_eventos")) { eventos.push({ publicacionId: String(params[0]), evento: params[1], detalle: JSON.parse(params[2]) }); return { rows: [] }; }
    if (sql.includes("SELECT vigente_hasta FROM alertas_meteo_publicaciones WHERE id = $1")) {
      return { rows: pubs.filter((p) => p.id === String(params[0]) && p.vigente_hasta > new Date()) };
    }
    if (sql.includes("INSERT INTO alertas_meteo_publicaciones")) {
      const r = { id: String(pubs.length + 1), publicado_en: new Date(), usuario_id: params[0], vigente_hasta: new Date(params[1]), periodo: params[2], en_fila_de: params[3] ?? null };
      pubs.push(r); return { rows: [r] };
    }
    if (sql.includes("INSERT INTO alertas_meteo_publicacion")) return { rows: [] };
    if (sql.includes("UPDATE alertas_meteo_publicaciones SET vigente_hasta = now() WHERE id = ANY")) {
      const sacadas = pubs.filter((p) => params[0].includes(Number(p.id)) && p.vigente_hasta > new Date());
      sacadas.forEach((p) => { p.vigente_hasta = new Date(Date.now() - 1); });
      return { rowCount: sacadas.length, rows: sacadas.map((p) => ({ id: p.id })) };
    }
    if (sql.includes("UPDATE alertas_meteo_publicaciones SET vigente_hasta = now() WHERE id = $1")) {
      const p = pubs.find((x) => x.id === String(params[0]) && x.vigente_hasta > new Date());
      if (p) p.vigente_hasta = new Date(Date.now() - 1);
      return { rowCount: p ? 1 : 0, rows: p ? [{ en_fila_de: p.en_fila_de }] : [] };
    }
    if (sql.includes("SET en_fila_de = $2, visible_desde = CASE WHEN $3 THEN now() ELSE visible_desde END WHERE en_fila_de = $1")) {
      pubs.filter((p) => String(p.en_fila_de) === String(params[0])).forEach((p) => { p.en_fila_de = params[1]; if (params[2]) p.visible_desde = new Date(); });
      return { rows: [] };
    }
    if (sql.includes("AS visible") && sql.includes("WHERE a.id = $1")) {
      const a = pubs.find((x) => x.id === String(params[0]));
      const b = a && a.en_fila_de != null ? pubs.find((x) => x.id === String(a.en_fila_de)) : null;
      return { rows: a ? [{ visible: a.en_fila_de == null || !b || !(b.vigente_hasta > new Date()) }] : [] };
    }
    if (sql.includes("SELECT id, vigente_hasta FROM alertas_meteo_publicaciones WHERE id = ANY")) {
      return { rows: pubs.filter((p) => params[0].map(String).includes(p.id)).map((p) => ({ id: p.id, vigente_hasta: p.vigente_hasta })) };
    }
    if (sql.includes("SET en_fila_de = $1 WHERE en_fila_de = ANY")) {
      pubs.filter((p) => params[1].map(String).includes(String(p.en_fila_de))).forEach((p) => { p.en_fila_de = params[0]; });
      return { rows: [] };
    }
    if (sql.includes("SELECT 1 FROM alertas_meteo_publicaciones WHERE id = $1")) {
      return { rowCount: pubs.filter((p) => p.id === String(params[0]) && p.vigente_hasta > new Date()).length };
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
  return Object.assign(require(path.join(src, "alertasMeteorologicasStore")), { _eventos: eventos });
}

test("varias vigentes a la vez; reemplazar saca la anterior; despublicar la saca antes de tiempo", async () => {
  const s = cargarConBaseFalsa();
  const hoy = await s.publicar([], [], 1, { periodo: "Hoy", vigenteHasta: en(8) });
  const manana = await s.publicar([], [], 1, { periodo: "Mañana", vigenteHasta: en(30) });
  assert.deepEqual((await s.vigentes()).map((v) => v.periodo), ["Hoy", "Mañana"]);
  const hoyCorregida = await s.publicar([], [], 1, { periodo: "Hoy (corregida)", vigenteHasta: en(8), reemplazar: [hoy.id] });
  assert.deepEqual((await s.vigentes()).map((v) => v.periodo), ["Mañana", "Hoy (corregida)"]);
  await s.despublicar(manana.id, 7);
  assert.deepEqual((await s.vigentes()).map((v) => v.id), [hoyCorregida.id]);
  await assert.rejects(s.despublicar(manana.id), { status: 404 });
  // Todo queda en el historial de cada alerta (estadísticas / histórico).
  const de = (id) => s._eventos.filter((e) => e.publicacionId === String(id)).map((e) => e.evento);
  assert.deepEqual(de(hoy.id), ["publicada", "reemplazada"]);
  assert.deepEqual(de(manana.id), ["publicada", "despublicada"]);
  assert.deepEqual(s._eventos.find((e) => e.evento === "publicada" && e.publicacionId === String(hoyCorregida.id)).detalle.reemplaza, [Number(hoy.id)]);
});

test("una alerta en fila aparece cuando la anterior vence o se despublica", async () => {
  const { errorDePublicacion } = require("../src/lib/alertasMeteorologicasStore");
  assert.equal(errorDePublicacion({ periodo: "Domingo", vigenteHasta: en(100), enFilaDe: 1 }), null);
  assert.match(errorDePublicacion({ periodo: "Domingo", vigenteHasta: en(200), enFilaDe: 1 }), /7 días/);
  assert.match(errorDePublicacion({ periodo: "Domingo", vigenteHasta: en(20), enFilaDe: 1, reemplazar: [2] }), /fila/);

  const s = cargarConBaseFalsa();
  const sabado = await s.publicar([], [], 1, { periodo: "Sábado", vigenteHasta: en(30) });
  const domingo = await s.publicar([], [], 1, { periodo: "Domingo", vigenteHasta: en(60), enFilaDe: sabado.id });
  const lunes = await s.publicar([], [], 1, { periodo: "Lunes", vigenteHasta: en(80), enFilaDe: domingo.id });
  let p = await s.pendientes();
  assert.deepEqual(p.vigentes.map((v) => v.periodo), ["Sábado"]);
  assert.deepEqual(p.enFila.map((v) => v.periodo), ["Domingo", "Lunes"]);
  // Sacar de la fila la del domingo no adelanta la del lunes: pasa a esperar al sábado.
  await s.despublicar(domingo.id);
  p = await s.pendientes();
  assert.deepEqual(p.vigentes.map((v) => v.periodo), ["Sábado"]);
  assert.deepEqual(p.enFila.map((v) => v.periodo), ["Lunes"]);
  await new Promise((r) => setTimeout(r, 10));
  const antes = Date.now();
  await s.despublicar(sabado.id);
  const [visible] = await s.vigentes();
  assert.equal(visible.id, lunes.id);
  // Aparece ahora (no cuando se publicó): /tv la deja fija sus primeros minutos desde acá.
  assert.ok(Date.parse(visible.visibleDesde) >= antes && Date.parse(visible.visibleDesde) > Date.parse(visible.publicadoEn), visible.visibleDesde);
  await assert.rejects(s.publicar([], [], 1, { periodo: "X", vigenteHasta: en(10), enFilaDe: sabado.id }), { status: 409 });
});
