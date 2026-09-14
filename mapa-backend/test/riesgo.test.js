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

test("PNG institucional conserva el resto de la plantilla y asigna cada zona según el mapa del Java", async () => {
  const { generateRiesgoMap, fechaValida, ZONAS, cargarPlantilla, CAJA_FECHA } = require("../src/lib/generateRiesgoMap");
  const { createCanvas, loadImage } = require("canvas");
  assert.equal(fechaValida("2026-02-30"), false);
  assert.equal(fechaValida("2026-09-08"), true);
  const buffer = await generateRiesgoMap({ zonas: validas(), fecha: "2026-09-08" });
  const image = await loadImage(buffer);
  const { image: template, masks, labels } = await cargarPlantilla();
  // Dimensiones y máscaras vienen de la plantilla real (`data/ecosotat/misiones.png`),
  // no de valores fijos: así el test no rompe si el archivo cambia de tamaño.
  assert.equal(image.width, template.width); assert.equal(image.height, template.height);
  const canvas = createCanvas(template.width, template.height), ctx = canvas.getContext("2d");
  ctx.drawImage(image,0,0);
  // Un píxel dentro de cada una de las 17 máscaras (no un punto fijo elegido a
  // ojo) debe llevar el color de la categoría asignada a ese departamento.
  for(const [gray,id] of ZONAS) {
    const name=validas().find(z=>z.id===id).categoria;
    const hex=categorias.find(c=>c.nombre===name).color;
    const idx=masks.get(gray)[0];
    const x=idx%template.width, y=Math.floor(idx/template.width);
    assert.deepEqual([...ctx.getImageData(x,y,1,1).data].slice(0,3),[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16)));
  }
  // El resto de la plantilla (logos, título, escala, fondo) no debe tocarse:
  // cualquier píxel fuera de las máscaras/rótulos de zona y de la franja de
  // la fecha tiene que quedar igual al original.
  const modificados = new Set();
  for(const [gray] of ZONAS) { for(const i of masks.get(gray)) modificados.add(i); for(const i of labels.get(gray)) modificados.add(i); }
  for(let y=CAJA_FECHA.y;y<CAJA_FECHA.y+CAJA_FECHA.h;y++) for(let x=CAJA_FECHA.x;x<CAJA_FECHA.x+CAJA_FECHA.w;x++) modificados.add(y*template.width+x);
  const generado=ctx.getImageData(0,0,template.width,template.height).data;
  const plantillaCanvas=createCanvas(template.width,template.height);
  const plantillaCtx=plantillaCanvas.getContext("2d"); plantillaCtx.drawImage(template,0,0);
  const original=plantillaCtx.getImageData(0,0,template.width,template.height).data;
  const total=template.width*template.height;
  for(let i=0;i<total;i+=97) {
    if(modificados.has(i)) continue;
    const j=i*4;
    assert.deepEqual([generado[j],generado[j+1],generado[j+2],generado[j+3]],[original[j],original[j+1],original[j+2],original[j+3]]);
  }
  await assert.rejects(generateRiesgoMap({zonas:validas().slice(1),fecha:"2026-09-08"}));
});
