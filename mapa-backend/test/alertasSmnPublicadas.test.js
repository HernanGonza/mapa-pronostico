const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

// Base simulada: guarda las filas en memoria y responde a las 3 consultas del store.
function baseFalsa() {
  const filas = [];
  const pool = {
    async query(sql, params = []) {
      if (/^\s*(CREATE|ALTER)/.test(sql)) return { rows: [] };
      if (sql.includes("INSERT INTO alertas_smn_publicadas")) {
        const r = { id: String(filas.length + 1), smn_id: params[0], publicado_por: params[1], publicado_en: new Date(), vigente_hasta: new Date(params[2]), datos: JSON.parse(params[3]) };
        filas.push(r); return { rows: [r] };
      }
      if (sql.includes("WHERE smn_id = $1")) return { rows: filas.filter((f) => f.smn_id === params[0] && f.vigente_hasta > new Date()) };
      if (sql.includes("UPDATE alertas_smn_publicadas")) {
        const f = filas.find((x) => x.id === String(params[0]) && x.vigente_hasta > new Date());
        if (f) f.vigente_hasta = new Date(Date.now() - 1);
        return { rowCount: f ? 1 : 0 };
      }
      if (sql.includes("WHERE a.vigente_hasta > now()")) return { rows: filas.filter((f) => f.vigente_hasta > new Date()) };
      throw new Error(`consulta no simulada: ${sql}`);
    },
  };
  return { filas, pool };
}
function cargarStore(pool) {
  const src = path.join(__dirname, "../src/lib");
  for (const m of ["store", "auth", "alertasSmnPublicadasStore"]) delete require.cache[require.resolve(path.join(src, m))];
  require.cache[require.resolve(path.join(src, "store"))] = { exports: { usaPostgres: () => true, init: async () => {}, getPool: () => pool } };
  require.cache[require.resolve(path.join(src, "auth"))] = { exports: { init: async () => {} } };
  return require(path.join(src, "alertasSmnPublicadasStore"));
}

const FIN = new Date(Date.now() + 3 * 3600e3).toISOString();
const ALERTAS = [{
  id: "urn:oid:2.49.0.1.32.0.2026.09.29.13.21.41.10", emitidoEn: "2026-09-29T13:21:41.000Z", url: "https://ssl.smn.gob.ar/x.xml",
  infos: [{ titulo: "Tormentas", categoria: "Amarillo", descripcion: "Área afectada por tormentas…", instrucciones: "Evitá salir.",
    inicio: new Date().toISOString(), fin: FIN, zonas: [{ nombre: "Oberá", departamentos: ["Oberá"], geometry: { type: "Polygon", coordinates: [[[-55, -27], [-54.9, -27], [-54.9, -27.1], [-55, -27]]] } }] }],
}];
const ID = `${ALERTAS[0].id}:0`;

test("publicar guarda una copia de la alerta con su color y vigente hasta su fin; no duplica", async () => {
  const { filas, pool } = baseFalsa();
  const s = cargarStore(pool);
  const pub = await s.publicar(ID, ALERTAS, 7, { Amarillo: "#FFCC35" });
  assert.equal(pub.smnId, ID);
  assert.equal(pub.vigenteHasta, FIN);
  assert.equal(pub.color, "#FFCC35");
  assert.equal(pub.titulo, "Tormentas");
  assert.deepEqual(pub.zonas[0].departamentos, ["Oberá"]);
  const otra = await s.publicar(ID, ALERTAS, 7, { Amarillo: "#FFCC35" });
  assert.equal(otra.id, pub.id); assert.equal(filas.length, 1, "publicar dos veces la misma no la duplica");
  assert.equal((await s.obtenerVigentes()).length, 1);
  await s.despublicar(pub.id);
  assert.equal((await s.obtenerVigentes()).length, 0);
  await assert.rejects(s.despublicar(pub.id), { status: 404 });
});

test("no publica una alerta que ya no está en el SMN ni una sin área", async () => {
  const s = cargarStore(baseFalsa().pool);
  await assert.rejects(s.publicar(`${ALERTAS[0].id}:5`, ALERTAS), { status: 404 });
  await assert.rejects(s.publicar("otra:0", ALERTAS), { status: 404 });
  const sinArea = [{ ...ALERTAS[0], infos: [{ ...ALERTAS[0].infos[0], zonas: [{ nombre: "X", geometry: null }] }] }];
  await assert.rejects(s.publicar(ID, sinArea), { status: 400 });
});
