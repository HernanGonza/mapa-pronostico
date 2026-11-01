const test = require("node:test");
const assert = require("node:assert");
const { errorDeInformeMensual, normalizarInformeMensual, tituloDe } = require("../src/lib/informeMensual");
const { generarInformeMensualPdf } = require("../src/lib/informeMensualPdf");

const base = { version: 1, anio: 2026, mes: 10, estaciones: [{ estacion: "Posadas", tmedia: "22.4", tmin: "17,1", tmax: "", eventos: "3", precipitacion: "180.5" }], resumen: "Mes cálido.", trimestral: { imagenes: [], texto: "" }, nino: { imagenes: [], texto: "Neutral." } };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("valida el mes, las celdas y las imágenes", () => {
  assert.equal(errorDeInformeMensual(base), null);
  assert.match(errorDeInformeMensual({ ...base, mes: 13 }), /mes/);
  assert.match(errorDeInformeMensual({ ...base, estaciones: [{ estacion: "P", eventos: "2,5" }] }), /entero/);
  assert.match(errorDeInformeMensual({ ...base, estaciones: [{ estacion: "P", precipitacion: "-3" }] }), /número|negativa/);
  assert.match(errorDeInformeMensual({ ...base, estaciones: [{ estacion: "P", tmedia: "abc" }] }), /número/);
  assert.match(errorDeInformeMensual({ ...base, nino: { imagenes: ["data:text/html;base64,AAAA"] } }), /imagen/);
  assert.equal(errorDeInformeMensual({ ...base, nino: { imagenes: [PNG, PNG] } }), null);
  assert.equal(errorDeInformeMensual({ ...base, nino: { imagen: PNG } }), null); // informes guardados antes (una sola imagen)
  assert.match(errorDeInformeMensual({ ...base, nino: { imagenes: Array(7).fill(PNG) } }), /hasta 6/);
});

test("normaliza los números con coma y recorta", () => {
  const n = normalizarInformeMensual({ ...base, resumen: "  hola  " });
  assert.equal(n.estaciones[0].tmedia, "22,4");
  assert.equal(n.estaciones[0].precipitacion, "180,5");
  assert.equal(n.resumen, "hola");
  assert.equal(tituloDe(n), "BALANCE HIDROMETEOROLÓGICO DEL MES DE OCTUBRE DE 2026");
});

test("arma el PDF aunque falten cosas (con y sin imágenes)", async () => {
  const sin = await generarInformeMensualPdf(base, { claveDuenio: "x" });
  assert.equal(sin.subarray(0, 4).toString(), "%PDF");
  const con = await generarInformeMensualPdf({ ...base, trimestral: { imagenes: [PNG, PNG, PNG], texto: "Texto" }, nino: { imagenes: [PNG], texto: "Texto" } }, { claveDuenio: "x" });
  assert.ok(con.length > sin.length);
  await assert.rejects(generarInformeMensualPdf({ ...base, mes: 0 }), /mes/);
});
