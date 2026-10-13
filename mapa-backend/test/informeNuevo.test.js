const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { generarDocx, CIUDADES, ZONAS } = require("../src/lib/informePronostico");
const { extractDocxTables, extractDocxParagraphs } = require("../src/lib/docxTables");
const { esInformeNuevo, parseInformeNuevo } = require("../src/lib/parseInformeNuevo");

const ciudad = (a, b, e) => ({ tmin: a, tmax: b, estado: e, alerta: "s/a" });
const borrador = () => ({
  emision: { fecha: "2026-10-14", hora: 9 },
  dias: [{ fecha: "2026-10-14", texto: "Cielo parcialmente nublado y chaparrones aislados por la tarde.", recomendaciones: "HOY BERMUDAS" }, { fecha: "2026-10-15", texto: "Ingreso de aire frío." }],
  provincia: { tmin: { valor: "12", lugar: "San Pedro" }, tmax: { valor: "25", lugar: "Eldorado" }, humedad: "MÍN. PROMEDIO 60%", precipitaciones: "2 a 10 mm", vientos: "3 a 15 km/h" },
  zonas: Object.fromEntries(ZONAS.map((z, i) => [z, { tmin: String(12 + i), tmax: String(18 + i), sens: "", humedad: "", vientos: "", estado: "Chaparrones aislados", alerta: "s/a" }])),
  ciudades: CIUDADES.map((_, i) => ciudad(String(10 + (i % 4)), String(20 + (i % 5)), i % 2 ? "Tormentas aisladas" : "Parcialmente nublado")),
  extendido: Object.fromEntries(ZONAS.map((z) => [z, [{ fecha: "2026-10-16", tmin: "15", tmax: "23", estado: "Chaparrones y tormentas", alerta: "" }, { fecha: "2026-10-17", tmin: "12", tmax: "20", estado: "Despejado", alerta: "" }]])),
});
const leer = async (b) => { const buf = await generarDocx(b); return parseInformeNuevo(await extractDocxTables(buf), await extractDocxParagraphs(buf)); };

test("el informe generado se lee de vuelta: las 13 ciudades del mapa, con zona y condición canónica", async () => {
  const r = await leer(borrador());
  assert.equal(r.filas.length, 13);
  assert.deepEqual(r.filas.map((f) => f.LOCALIDAD), CIUDADES.map((c) => c.nombre));
  assert.deepEqual(r.filas.slice(0, 2).map((f) => [f.TMIN, f.TMAX, f.CONDICION, f.ZONA]), [["10", "20", "parcialmente nublado", "Sur"], ["11", "21", "tormentas aisladas", "Sur"]]);
  assert.equal(r.filas.find((f) => f.LOCALIDAD === "PUERTO IGUAZÚ").ZONA, "Norte");
  assert.equal(r.filas.find((f) => f.LOCALIDAD === "OBERÁ").ZONA, "Centro");
  assert.ok(r.filas.every((f) => /^-?\d+$/.test(f.TMIN) && /^-?\d+$/.test(f.TMAX)), "las temperaturas salen como números enteros, sin «º C»");
});

test("el extendido tiene «Hoy» (de la tabla de zonas) y los dos días siguientes, con el nombre del día", async () => {
  const { extendido } = await leer(borrador());
  assert.deepEqual(extendido.zonas.map((z) => z.zona), ["Sur", "Centro", "Norte"]);
  const sur = extendido.zonas[0].dias;
  assert.deepEqual(sur.map((d) => d.etiqueta), ["Hoy", "Viernes", "Sábado"]);
  assert.deepEqual([sur[0].tmin, sur[0].tmax, sur[0].condicion], ["12", "18", "chaparrones aislados"]);
  assert.deepEqual([sur[1].fecha, sur[1].tmin, sur[1].tmax, sur[1].condicion], ["16 de octubre", "15", "23", "chaparrones y tormentas"]);
});

test("los textos de los dos días y la fecha sugerida salen del informe", async () => {
  const r = await leer(borrador());
  assert.equal(r.fechaSugerida, "2026-10-14");
  assert.deepEqual(r.extendido.informes.map((i) => [i.dia, i.fecha]), [["Miércoles", "14 de octubre"], ["Jueves", "15 de octubre"]]);
  assert.match(r.extendido.informes[0].texto, /chaparrones aislados por la tarde/);
  assert.match(r.extendido.informes[1].texto, /aire frío/);
});

test("una ciudad sin estado del tiempo queda con la condición vacía (el operador la completa al cargar)", async () => {
  const b = borrador(); b.ciudades[3].estado = "";
  assert.equal((await leer(b)).filas[3].CONDICION, "");
});

test("el .docx de siempre (3 tablas de localidades) no se confunde con el informe nuevo", async () => {
  const viejo = path.join(__dirname, "..", "..", "2026.09.11-1-pronomet.docx");
  if (!fs.existsSync(viejo)) return; // el archivo de muestra no está en este checkout
  assert.equal(esInformeNuevo(await extractDocxTables(fs.readFileSync(viejo))), false);
});
