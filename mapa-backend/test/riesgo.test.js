const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { categorias, errorDeZonas, normalizarZonas } = require("../src/lib/riesgoIncendios");
const { loadDepartamentos } = require("../src/lib/departamentos");
const validas = () => loadDepartamentos().map((d, i) => ({ id: d.id, categoria: categorias[i % categorias.length].nombre }));

test("riesgo exige cobertura completa y categorías conocidas", () => {
  assert.equal(errorDeZonas(validas()), null);
  for (const invalido of [null, [], validas().slice(1), [...validas(), validas()[0]], validas().map((z, i) => i === 0 ? null : z), validas().map(z => ({ ...z, categoria: "" }))]) {
    assert.ok(errorDeZonas(invalido));
  }
  const repetidas = validas(); repetidas[1] = repetidas[0];
  assert.match(errorDeZonas(repetidas), /repetidos/);
  const desconocidas = validas(); desconocidas[0].id = "999";
  assert.match(errorDeZonas(desconocidas), /inválido/);
});
test("normaliza IDs y elimina datos extra antes de guardar", () => {
  const entradas = validas().reverse().map(z => ({ ...z, id: Number(z.id), nombre: "invento" }));
  assert.deepEqual(normalizarZonas(entradas), validas());
});
test("paleta coincide con los RGB de GeneradorDeImagen.java", () => {
  assert.deepEqual(categorias.map(c => c.color), ["#00a551", "#2d3192", "#fff100", "#f38321", "#ec1f24"]);
});
test("publicación en disco se recupera tras recargar el módulo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "riesgo-test-"));
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "";
  process.env.RIESGO_STORE_PATH = path.join(dir, "actual.json");
  const modulePath = require.resolve("../src/lib/riesgoIncendiosStore");
  delete require.cache[modulePath];
  try {
    const store = require(modulePath);
    assert.equal(await store.obtenerActual(), null);
    const publicado = await store.publicar(validas());
    delete require.cache[modulePath];
    assert.deepEqual(await require(modulePath).obtenerActual(), publicado);
    assert.equal(fs.readdirSync(dir).length, 1);
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    delete process.env.RIESGO_STORE_PATH;
    delete require.cache[modulePath];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("un error transitorio de tabla permite reintentar", async t => {
  const shared = require("../src/lib/store");
  let attempts = 0;
  const pool = { query: async () => { if (++attempts === 1) throw new Error("temporal"); return {}; } };
  t.mock.method(shared, "usaPostgres", () => true);
  t.mock.method(shared, "init", async () => {});
  t.mock.method(shared, "getPool", () => pool);
  const modulePath = require.resolve("../src/lib/riesgoIncendiosStore");
  delete require.cache[modulePath];
  const store = require(modulePath);
  await assert.rejects(store.init(), /temporal/);
  await store.init();
  assert.equal(attempts, 2);
  delete require.cache[modulePath];
});

test("geometría y catálogo tienen los mismos 17 departamentos", () => {
  const geo = JSON.parse(fs.readFileSync(require("../src/lib/departamentos").DEPARTAMENTOS_GEOJSON_PATH));
  assert.equal(geo.features.length, 17);
  assert.deepEqual(geo.features.map(f => String(f.properties.id)).sort(), loadDepartamentos().map(d => String(d.id)).sort());
  for (const f of geo.features) {
    assert.ok(["Polygon", "MultiPolygon"].includes(f.geometry.type));
    assert.equal(f.properties.nombre, loadDepartamentos().find(d => String(d.id) === String(f.properties.id)).nombre);
  }
});

test("PNG institucional conserva logos y asigna cada zona según el mapa del Java", async () => {
  const { generateRiesgoMap, fechaValida } = require("../src/lib/generateRiesgoMap");
  const { createCanvas, loadImage } = require("canvas");
  assert.equal(fechaValida("2026-02-30"), false);
  assert.equal(fechaValida("2026-09-08"), true);
  const buffer = await generateRiesgoMap({ zonas: validas(), fecha: "2026-09-08" });
  const image = await loadImage(buffer);
  assert.equal(image.width, 1000); assert.equal(image.height, 1000);
  const canvas = createCanvas(1000,1000), ctx = canvas.getContext("2d");
  ctx.drawImage(image,0,0);
  const footer = ctx.getImageData(0,912,1000,88).data;
  // Anclas interiores alejadas de los textos: comprueba el cruce de IDs,
  // especialmente Capital (4) vs ZONA_1 y Apóstoles (1) vs ZONA_3.
  const samples = [["4",210,720],["1",263,852],["9",658,190],["7",765,210]];
  for(const [id,x,y] of samples) {
    const name=validas().find(z=>z.id===id).categoria;
    const hex=categorias.find(c=>c.nombre===name).color;
    assert.deepEqual([...ctx.getImageData(x,y,1,1).data].slice(0,3),[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16)));
  }
  const template=await loadImage(path.join(__dirname,"../data/ecosotat/misiones.png"));
  ctx.drawImage(template,0,0);
  assert.deepEqual(footer,ctx.getImageData(0,912,1000,88).data);
  await assert.rejects(generateRiesgoMap({zonas:validas().slice(1),fecha:"2026-09-08"}));
});
