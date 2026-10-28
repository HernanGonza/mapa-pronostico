const test = require("node:test");
const assert = require("node:assert/strict");
const { generarInformePdf, errorDeInforme } = require("../src/lib/informePronosticoPdf");
const { partesCondicion, condicionCanonica, colorPorCondicion, unirCondiciones, CATALOGO } = require("../src/lib/condiciones");
const { resolveIconPath } = require("../src/lib/iconResolver");

const C = "Nublado + Chaparrones";
const loc = (localidad, zona) => ({ localidad, zona, tmin: "16", tmax: "22", condicion: C });
const zona = (condicion = C) => ({ tmin: "16", tmax: "23", condicion, aviso: "SIN AVISOS.", humedad: "65 - 100 %", viento: "S 5 km/h", riesgo: "BAJO" });
const dias = [{ fecha: "2026-10-16", tmin: "14", tmax: "23", condicion: "Despejado" }, { fecha: "2026-10-17", tmin: "11", tmax: "22", condicion: "Algo nublado" }];
const informe = () => ({
  fecha: "2026-10-15", emision: "09:00",
  generales: { vientos: "S 1-15 km/h", humedad: "65 - 100 %", presion: "1010 HPA", riesgo: "BAJO" }, avisoGeneral: "SIN AVISOS.",
  zonas: { Norte: zona(), Centro: zona("Tormentas aisladas"), Sur: zona("Parcialmente nublado + Lluvias") },
  localidades: [loc("PUERTO IGUAZÚ", "Norte"), loc("OBERÁ", "Centro"), loc("POSADAS", "Sur")],
  extendido: { Norte: dias, Centro: dias, Sur: dias },
  informes: [{ fecha: "2026-10-15", resumen: "Tiempo húmedo.", precipitaciones: "de 2 a 10 mm.", vientos: "del sur", temperaturas: "máxima 25 °C" }],
});

test("el PDF del informe sale cifrado, con permisos acotados y más de una condición por lugar", async () => {
  const pdf = await generarInformePdf(informe(), { claveDuenio: "clave-de-prueba" });
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.match(pdf.toString("latin1"), /\/Encrypt/);
  assert.ok(pdf.length > 20000);
});

test("el informe incompleto se rechaza con un mensaje, no con un error interno", async () => {
  assert.match(errorDeInforme({ ...informe(), fecha: "hoy" }), /fecha/i);
  assert.match(errorDeInforme({ ...informe(), zonas: { Norte: zona() } }), /zonas/i);
  await assert.rejects(generarInformePdf({}), (e) => e.status === 400);
});

test("las condiciones son una lista fija: se pueden juntar varias y las escrituras viejas se entienden", () => {
  assert.equal(CATALOGO.length, 24);
  assert.deepEqual(partesCondicion("Nublado + Chaparrones").map((c) => c.id), ["nublado", "chaparrones"]);
  assert.equal(condicionCanonica("NUBLADO,CHAPARRONES AISLADOS"), "Nublado + Chaparrones");
  assert.equal(condicionCanonica("lluvias y tormentas aisladas"), "Lluvias + Tormentas aisladas");
  assert.equal(condicionCanonica("Lluvias y nevadas"), "Lluvias y nevadas"); // una sola, aunque el nombre lleve «y»
  assert.equal(condicionCanonica("algo que no existe"), null);
  assert.equal(unirCondiciones(["despejado", "ventoso"]), "Despejado + Ventoso");
  // manda la más severa para el color y el ícono
  assert.equal(colorPorCondicion("Despejado + Tormentas"), colorPorCondicion("Tormentas"));
  assert.match(resolveIconPath("", "Nublado + Chaparrones"), /74\.png$/);
});

// --- informes con plantilla (formato 2: 3 días, 5 botones / 3 plantillas) ---
const rango = (desde, hasta = "") => ({ desde, hasta });
const diaV2 = (fecha, temps, presion) => ({
  fecha, temps, presion, hoy: false, resumen: "Un sistema de alta presión mantiene el buen tiempo.",
  zonas: Object.fromEntries(["Sur", "Centro", "Norte"].map((z) => [z, Object.fromEntries(temps.map((t) => [t, rango("12", "15")]))])),
  humedad: rango("40", "80"), presionRango: rango("1014", "1017"), precipitaciones: "Sin probabilidades", vientos: "3 a 15 km/h, del sector sur", alertas: "",
  ciudades: ["POSADAS", "OBERÁ"].map((ciudad) => ({ ciudad, ...Object.fromEntries(temps.map((t) => [t, "14"])), condicion: "Algo nublado", alerta: "s/a" })),
});
const informeV2 = (temps1 = ["tmax", "tnoct"]) => ({
  version: 2, boton: "ls1", plantilla: "A", fecha: "2026-10-19", emision: "12:00", vigencia: { hasta: "18:00", fecha: "2026-10-19" },
  dias: [{ ...diaV2("2026-10-19", temps1, false), hoy: true }, diaV2("2026-10-20", ["tmin", "tmax"], true), diaV2("2026-10-21", ["tmin", "tmax"], true)],
});

test("el informe con plantilla sale en PDF, con una página por día y las temperaturas que le tocan a cada plantilla", async () => {
  for (const temps of [["tmax", "tnoct"], ["tnoct"]]) {
    const pdf = await generarInformePdf(informeV2(temps), { claveDuenio: "clave-de-prueba" });
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.match(pdf.toString("latin1"), /\/Encrypt/);
    assert.match(pdf.toString("latin1"), /\/Count 3/);
  }
});

test("el informe con plantilla mal formado se rechaza con un mensaje", () => {
  assert.equal(errorDeInforme(informeV2()), null);
  assert.match(errorDeInforme({ ...informeV2(), dias: [] }), /tres días/);
  assert.match(errorDeInforme({ ...informeV2(), vigencia: null }), /vigencia/i);
  const raro = informeV2(); raro.dias[0].temps = ["calor"];
  assert.match(errorDeInforme(raro), /temperaturas/i);
  const sinZona = informeV2(); delete sinZona.dias[1].zonas.Sur;
  assert.match(errorDeInforme(sinZona), /zonas/i);
});

test("el informe con plantilla también sale en .docx, con los textos editables y sin cifrado", async () => {
  const JSZip = require("jszip");
  const { generarInformeDocx } = require("../src/lib/informePronosticoDocx");
  const zip = await JSZip.loadAsync(await generarInformeDocx(informeV2()));
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /Un sistema de alta presión mantiene el buen tiempo\./);
  assert.match(xml, /Lunes 19 de octubre de 2026/);
  assert.match(xml, /TEMPERATURAS NOCTURNAS/);
  assert.match(xml, /RANGO DE TEMPERATURAS/);
  assert.match(xml, /14° C/); // el rango sale de las temperaturas de las ciudades
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 12); // por día: zonas, datos, ciudades y rangos
  await assert.rejects(() => generarInformeDocx({ ...informeV2(), dias: [] }), /tres días/);
});

test("el informe con plantilla también sale en .rtf, con acentos escapados y las mismas tablas", async () => {
  const { generarInformeRtf } = require("../src/lib/informePronosticoRtf");
  const rtf = (await generarInformeRtf(informeV2())).toString("ascii");
  assert.match(rtf, /^\{\\rtf1/);
  assert.ok(!/[^\x00-\x7f]/.test(rtf), "sólo ASCII");
  assert.match(rtf, /PREVISI\\u211\?N DEL TIEMPO|PREVISI\\u-?\d+\?N DEL TIEMPO/);
  assert.equal((rtf.match(/\\row/g) || []).length, 14 + 15 + 15); // por día: zonas (cabecera + temps + condición), datos (5, o 6 con presión), ciudades (cabecera + 2) y rangos (cabecera + 1)
  assert.equal((rtf.match(/\{/g) || []).length - (rtf.match(/\\\{/g) || []).length, (rtf.match(/\}/g) || []).length - (rtf.match(/\\\}/g) || []).length);
  await assert.rejects(() => generarInformeRtf({ ...informeV2(), dias: [] }), /tres días/);
});

test("el .docx y el .rtf llevan la marca de agua en el encabezado", async () => {
  const JSZip = require("jszip");
  const { generarInformeDocx } = require("../src/lib/informePronosticoDocx");
  const { generarInformeRtf } = require("../src/lib/informePronosticoRtf");
  const zip = await JSZip.loadAsync(await generarInformeDocx(informeV2()));
  assert.match(await zip.file("word/header1.xml").async("string"), /string="MINISTERIO DE ECOLOGÍA · ALERTA TEMPRANA"/);
  assert.match(await zip.file("word/document.xml").async("string"), /<w:headerReference w:type="default" r:id="rId2"\/>/);
  assert.match(await zip.file("word/_rels/document.xml.rels").async("string"), /header1\.xml/);
  assert.match(await zip.file("[Content_Types].xml").async("string"), /header1\.xml/);
  const rtf = (await generarInformeRtf(informeV2())).toString("ascii");
  assert.match(rtf, /\\header[\s\S]*gtextUNICODE[\s\S]*ALERTA TEMPRANA/);
});
