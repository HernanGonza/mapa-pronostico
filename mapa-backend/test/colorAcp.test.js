const { test } = require("node:test");
const assert = require("node:assert/strict");
const { colorDeAcp, intervalosSmn, intervalosManuales, COLORES, VIOLETA } = require("../src/lib/colorAcp");

const h = (n) => new Date(Date.UTC(2026, 9, 5, n)).toISOString();

test("el ACP toma el color de la alerta en cuya vigencia cae; sin alerta, violeta", () => {
  const alertas = [{ categoria: "Amarillo", inicio: h(0), fin: h(6) }, { categoria: "Naranja", inicio: h(6), fin: h(12) }];
  assert.deepEqual(colorDeAcp(alertas, h(3), h(4)), { nivel: "Amarillo", color: COLORES.Amarillo });
  assert.deepEqual(colorDeAcp(alertas, h(8), h(9)), { nivel: "Naranja", color: COLORES.Naranja });
  // Cruza las dos franjas: gana el nivel más alto.
  assert.equal(colorDeAcp(alertas, h(5), h(7)).nivel, "Naranja");
  // Un instante: el de la alerta en ese momento (el fin no cuenta).
  assert.equal(colorDeAcp(alertas, h(6)).nivel, "Naranja");
  assert.deepEqual(colorDeAcp(alertas, h(13), h(14)), { nivel: null, color: VIOLETA });
  assert.deepEqual(colorDeAcp([], h(1)), { nivel: null, color: VIOLETA });
});

test("de las SAT del SMN sólo cuentan las que tocan Misiones y tienen nivel", () => {
  const zona = (departamentos, nombre = "x") => ({ nombre, departamentos });
  const filas = [{ infos: [
    { categoria: "Naranja", inicio: h(0), fin: h(6), zonas: [zona(["Oberá"])] },
    { categoria: "Rojo", inicio: h(0), fin: h(6), zonas: [zona([], "Buenos Aires")] },
    { categoria: "Amarillo", inicio: h(0), fin: h(6), zonas: [zona([], "Norte de Misiones")] },
    { categoria: "Sin nivel", inicio: h(0), fin: h(6), zonas: [zona(["Iguazú"])] },
  ] }];
  assert.deepEqual(intervalosSmn(filas).map((x) => x.categoria), ["Naranja", "Amarillo"]);
});

test("alertas manuales: nivel más alto de los departamentos; la que espera en fila arranca al vencer la anterior", () => {
  const vigentes = [{ id: 1, publicadoEn: h(0), vigenteHasta: h(6), zonas: [{ categoria: "Verde" }, { categoria: "Amarillo" }] },
    { id: 2, publicadoEn: h(0), vigenteHasta: h(6), zonas: [{ categoria: "Verde" }] }];
  const enFila = [{ id: 3, enFilaDe: 1, publicadoEn: h(1), vigenteHasta: h(12), zonas: [{ categoria: "Rojo" }, { categoria: "Naranja" }] }];
  assert.deepEqual(intervalosManuales({ vigentes, enFila }), [
    { categoria: "Amarillo", inicio: h(0), fin: h(6) },
    { categoria: "Rojo", inicio: h(6), fin: h(12) },
  ]);
});

test("el nivel escrito en el titular del SMN manda sobre el cruce de horarios", () => {
  const { nivelDeTitulo } = require("../src/lib/colorAcp");
  assert.equal(nivelDeTitulo("AVISO NARANJA POR TORMENTAS FUERTES CON LLUVIAS INTENSAS"), "Naranja");
  assert.equal(nivelDeTitulo("Aviso amarillo por lluvias"), "Amarillo");
  assert.equal(nivelDeTitulo("ALERTA ROJA POR VIENTOS"), "Rojo");
  assert.equal(nivelDeTitulo("Tormentas fuertes en el sur"), null);
  assert.equal(nivelDeTitulo("Cielo rojo al atardecer"), null);
  const alertas = [{ categoria: "Amarillo", inicio: h(0), fin: h(6) }];
  assert.deepEqual(colorDeAcp(alertas, h(1), h(2), "Rojo"), { nivel: "Rojo", color: COLORES.Rojo });
  assert.equal(colorDeAcp(alertas, h(1), h(2), null).nivel, "Amarillo");
});
