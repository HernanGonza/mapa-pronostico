const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resumir, redactar, errorDeConsulta } = require("../src/lib/informesDiarios");

const MIN = 60000, t0 = Date.parse("2026-10-03T16:00:00-03:00");
// Tormenta de juguete: calor, cae la temperatura 9 °C en 20 min y llueve fuerte.
const serie = Array.from({ length: 12 }, (_, i) => ({
  t: t0 + i * 10 * MIN,
  lluvia: [0, 0, 0, 0.2, 6, 8, 4, 1, 0.5, 0, 0, 0][i],
  rafaga: [10, 12, 15, 40, 52, 30, 20, 15, 10, 8, 8, 8][i],
  temperatura: [31, 31, 30.8, 26, 22, 21.5, 21, 21, 21, 21.2, 21.5, 21.8][i],
}));

test("resume una serie de 10 minutos: lluvia, máxima en 30 min, ráfaga, temperaturas y llegada del frente", () => {
  const r = resumir(serie);
  assert.equal(r.lluviaTotal, 19.7);
  assert.deepEqual(r.lluvia30, { mm: 18, hora: "16:40" });
  assert.deepEqual(r.rafaga, { kmh: 52, hora: "16:40" });
  assert.deepEqual(r.tMax, { c: 31, hora: "16:00" });
  assert.equal(r.tMin.c, 21);
  assert.equal(r.caida.grados, 9.3); // de 30,8 °C (16:20) a 21,5 °C (16:50)
  assert.equal(r.caida.hora, "16:20");
  assert.equal(r.inicioLluvia, "16:30");
  assert.equal(resumir([]), null);
});

test("el texto sugerido nombra lo más fuerte y las estaciones sin datos", () => {
  const estaciones = [{ nombre: "Cerro Azul", resumen: resumir(serie) }, { nombre: "Montecarlo", resumen: null }];
  const smn = [{ fuente: "SAT", nivel: "Naranja" }, { fuente: "ACP" }];
  const texto = redactar({ fecha: "2026-10-03", desde: "00:00", hasta: "23:59", estaciones, smn });
  assert.match(texto, /Cerro Azul 19,7 mm/);
  assert.match(texto, /18 mm en 30 minutos desde las 16:40/);
  assert.match(texto, /52 km\/h/);
  assert.match(texto, /1 alerta \(naranja\) y 1 aviso a muy corto plazo/);
  assert.match(texto, /Sin datos disponibles: Montecarlo/);
});

test("valida el día y la franja", () => {
  assert.equal(errorDeConsulta({ fecha: "2026-10-03" }), null);
  assert.equal(errorDeConsulta({ fecha: "2026-10-03", desde: "12:00", hasta: "23:59" }), null);
  assert.match(errorDeConsulta({ fecha: "03/10/2026" }), /día/);
  assert.match(errorDeConsulta({ fecha: "2026-10-03", desde: "18:00", hasta: "12:00" }), /antes/);
  assert.match(errorDeConsulta({ fecha: "2099-01-01" }), /todavía/);
});

test("el Excel trae resumen, una hoja por estación con todos los campos crudos, avisos y notas", async () => {
  const ExcelJS = require("exceljs");
  const { armarExcel } = require("../src/lib/informesDiariosExcel");
  const datos = { fecha: "2026-10-03", desde: "00:00", hasta: "23:59", consultadoEn: new Date().toISOString(), smn: [{ fuente: "ACP", titulo: "Aviso", inicio: "2026-10-03T19:16:00.000Z", fin: "2026-10-03T21:16:00.000Z", zonas: "Oberá" }],
    estaciones: [
      { clave: "inta-cerroAzul", red: "INTA", nombre: "Cerro Azul - EEA Cerro Azul", resumen: resumir(serie), crudo: serie.map((r) => ({ t: r.t, fechaHora: "2026-10-03T16:00:00Z[UTC]", precDiaCrono: r.lluvia, bateria: 12.4, campoNuevo: "x" })) },
      { clave: "sinarame-eldorado", red: "SiNaRaMe", nombre: "Eldorado", resumen: null, crudo: [], error: "HTTP 500" },
    ] };
  const libro = new ExcelJS.Workbook(); await libro.xlsx.load(await armarExcel(datos));
  assert.deepEqual(libro.worksheets.map((h) => h.name), ["Resumen", "INTA Cerro Azul", "SiNaRaMe Eldorado", "Avisos SMN", "Fuentes y notas"]);
  const h = libro.getWorksheet("INTA Cerro Azul");
  assert.equal(h.rowCount, 13); // encabezado + 12 registros
  const titulos = h.getRow(1).values.slice(1);
  assert.ok(titulos.includes("Lluvia en el intervalo (mm)") && titulos.includes("Batería (V)") && titulos.includes("campoNuevo"), titulos.join(" | "));
  // La hora va como hora de reloj de Misiones (16:00, no 19:00 UTC).
  assert.equal(h.getRow(2).getCell(1).value.toISOString(), "2026-10-03T16:00:00.000Z");
  const resumen = libro.getWorksheet("Resumen"), colEstado = resumen.getRow(1).values.indexOf("Estado");
  assert.match(String(resumen.getRow(3).getCell(colEstado).value), /Error: HTTP 500/);
});

test("rango de fechas: de ayer 00:00 a hoy 09:00", () => {
  const { textoDelRango, diasEntre } = require("../src/lib/informesDiarios");
  assert.equal(errorDeConsulta({ fecha: "2026-10-02", fechaHasta: "2026-10-03", desde: "00:00", hasta: "09:00" }), null);
  // Cruzando la medianoche la hora de fin puede ser menor que la de inicio.
  assert.equal(errorDeConsulta({ fecha: "2026-10-02", fechaHasta: "2026-10-03", desde: "18:00", hasta: "06:00" }), null);
  assert.match(errorDeConsulta({ fecha: "2026-10-03", fechaHasta: "2026-10-02" }), /antes/);
  assert.match(errorDeConsulta({ fecha: "2026-09-01", fechaHasta: "2026-09-20" }), /7 días/);
  assert.deepEqual(diasEntre("2026-09-30", "2026-10-02"), ["2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.equal(textoDelRango({ fecha: "2026-10-02", fechaHasta: "2026-10-03", desde: "00:00", hasta: "09:00" }), "desde el viernes, 2 de octubre a las 00:00 h hasta el sábado, 3 de octubre de 2026 a las 09:00 h");
  assert.equal(textoDelRango({ fecha: "2026-10-03", desde: "00:00", hasta: "23:59" }), "del sábado, 3 de octubre de 2026");
});

test("en un rango de varios días las horas llevan el día", () => {
  const r = resumir(serie, { conDia: true });
  assert.equal(r.rafaga.hora, "03/10 16:40");
  const texto = redactar({ fecha: "2026-10-03", fechaHasta: "2026-10-04", desde: "00:00", hasta: "09:00", smn: [], estaciones: [{ nombre: "Cerro Azul", resumen: r }] });
  assert.match(texto, /52 km\/h el 03\/10 a las 16:40 h/);
  assert.match(texto, /en 30 minutos el 03\/10 desde las 16:40 h/);
});
