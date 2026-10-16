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
