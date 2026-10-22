const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("jszip");
const { generarInformeViejoDocx, generarInformeViejoRtf, bloques } = require("../src/lib/informePronosticoViejo");

const CIUDADES = [["POSADAS", 15, 26], ["LEANDRO ALEM", 12, 25], ["APÓSTOLES", 11, 24], ["SAN JAVIER", 11, 24], ["OBERÁ", 12, 23], ["JARDÍN AMÉRICA", 13, 25], ["SAN VICENTE", 11, 22], ["ARISTÓBULO DEL VALLE", 11, 23], ["MONTECARLO", 12, 25],
  ["PUERTO IGUAZÚ", 14, 25], ["BERNARDO DE IRIGOYEN", 10, 21], ["ELDORADO", 13, 25], ["SAN PEDRO", 12, 22]];
const dia = (fecha, temps, extra = {}) => ({
  fecha, temps, presion: true, hoy: false, resumen: "Jornada estable.",
  zonas: Object.fromEntries(["Sur", "Centro", "Norte"].map((z) => [z, Object.fromEntries(temps.map((t) => [t, { desde: "11", hasta: "25" }]))])),
  humedad: { desde: "34", hasta: "70" }, presionRango: { desde: "1018", hasta: "1023" }, precipitaciones: "no se esperan", vientos: "SE/E 2 - 13 km/h", alertas: "",
  ciudades: CIUDADES.map(([ciudad, tmin, tmax]) => ({ ciudad, tmin: String(tmin), tmax: String(tmax), tnoct: String(tmin + 2), condicion: "Despejado", alerta: "s/a" })), ...extra,
});
const informe = () => ({ version: 2, boton: "ls1", plantilla: "A", fecha: "2026-09-16", emision: "12:00", vigencia: { hasta: "18:00", fecha: "2026-09-16" },
  dias: [dia("2026-09-16", ["tmax", "tnoct"], { presion: false, hoy: true }), dia("2026-09-17", ["tmin", "tmax"]), dia("2026-09-18", ["tmin", "tmax"])] });

const textos = (bl) => bl.filter((x) => x.p).map((x) => x.p.map((r) => r.t).join(""));

test("el formato viejo respeta el orden y los rótulos del .docx de siempre", async () => {
  const t = textos(await bloques(informe()));
  assert.equal(t[1], "DATOS: TARDE-NOCHE MIÉRCOLES 16 DE SEPTIEMBRE DE 2026 ");
  for (const r of ["DATOS GENERALES", "NORTE", "CENTRO", "SUR", "ZONA NORTE", "ZONA CENTRO", "ZONA SUR", "PRONÓSTICO EXTENDIDO", "INFORMES DE PRONÓSTICO"]) assert.ok(t.includes(r), r);
  assert.ok(t.indexOf("ZONA NORTE") < t.indexOf("ZONA CENTRO") && t.indexOf("ZONA CENTRO") < t.indexOf("ZONA SUR"));
  assert.match(t.find((x) => x.startsWith("HUMEDAD")), /^HUMEDAD: 34 - 70 %$/);
  assert.ok(!t.some((x) => /^PRESIÓN/.test(x)), "el primer día de la plantilla A no lleva presión");
  assert.ok(t.includes("Miércoles 16 de septiembre") && t.includes("Viernes 18 de septiembre"));
  assert.ok(t.some((x) => /^Temperaturas: máxima en la provincia estimada en 26°C para Posadas y la mínima sería de 10°C en Bdo de Irigoyen\.$/.test(x)));
  assert.ok(t.some((x) => /^JUEVES 17 DE SEPTIEMBRE\s+11 °C\s+25 °C\s+DESPEJADO$/.test(x)));
});

test("sale como .docx válido y como .rtf, con las tablas de localidades de cada zona", async () => {
  const zip = await JSZip.loadAsync(await generarInformeViejoDocx(informe()));
  const xml = await zip.file("word/document.xml").async("string");
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 3);
  assert.match(xml, /BDO\. DE IRIGOYEN/);
  assert.match(xml, /L\. N\. ALEM/);
  const rtf = (await generarInformeViejoRtf(informe())).toString("ascii");
  assert.equal((rtf.match(/\\trowd/g) || []).length, 5 + 6 + 5, "cabecera + localidades de cada zona");
  assert.equal(rtf.split("{").length, rtf.split("}").length);
});

test("sólo con el formato nuevo", async () => {
  await assert.rejects(generarInformeViejoDocx({ fecha: "2026-09-16" }), (e) => e.status === 400);
});
