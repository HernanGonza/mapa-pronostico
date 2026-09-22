const test = require("node:test");
const assert = require("node:assert/strict");
const fwi = require("../src/lib/fwi");

test("FFMC coincide con el ejemplo de referencia del manual canadiense (F0=85,r0=0,H=42,T=17,W=25 -> ~87.7)", () => {
  const ffmc = fwi.calcularFFMC(85, 0, 42, 17, 25);
  assert.ok(Math.abs(ffmc - 87.7) < 0.1, `FFMC=${ffmc}, esperado ~87.7`);
});

test("FFMC baja con más humedad y sube con menos humedad/más temperatura, a igualdad de lo demás", () => {
  const base = fwi.calcularFFMC(85, 0, 50, 20, 15);
  assert.ok(fwi.calcularFFMC(85, 0, 90, 20, 15) < base);
  assert.ok(fwi.calcularFFMC(85, 0, 20, 30, 15) > base);
});

test("DMC y DC suben sin lluvia y bajan (o suben menos) con lluvia fuerte", () => {
  const dmcSeco = fwi.calcularDMC(20, 0, 1, 25, 40);
  const dmcLluvia = fwi.calcularDMC(20, 30, 1, 25, 40);
  assert.ok(dmcSeco > 20 && dmcLluvia < dmcSeco);

  const dcSeco = fwi.calcularDC(100, 0, 1, 25);
  const dcLluvia = fwi.calcularDC(100, 30, 1, 25);
  assert.ok(dcSeco > 100 && dcLluvia < dcSeco);
});

test("calcularDia encadena los 6 códigos sin tirar excepciones con valores típicos", () => {
  const dia = fwi.calcularDia({ F0: 85, DMC0: 20, DC0: 100, r0: 0, H: 45, T: 25, W: 15, mes: 1 });
  for (const clave of ["FFMC", "DMC", "DC", "ISI", "BUI", "FWI"]) {
    assert.equal(typeof dia[clave], "number");
    assert.ok(Number.isFinite(dia[clave]), `${clave} no es finito: ${dia[clave]}`);
  }
});

test("calcularDia reproduce el ISI de la pantalla principal de ECOSOTAT", () => {
  const entrada = { F0: 85, DMC0: 20, DC0: 100, r0: 4, H: 72, T: 21, W: 12, mes: 9 };
  const dia = fwi.calcularDia(entrada);
  assert.equal(dia.ISI, fwi.calcularISI(dia.FFMC, entrada.r0, entrada.H, entrada.T, entrada.W));
  assert.notEqual(dia.ISI, fwi.calcularISI(entrada.F0, entrada.r0, entrada.H, entrada.T, entrada.W));
});

test("calcularDMC y calcularDC rechazan un mes fuera de 1-12", () => {
  assert.throws(() => fwi.calcularDMC(20, 0, 0, 20, 40));
  assert.throws(() => fwi.calcularDMC(20, 0, 13, 20, 40));
  assert.throws(() => fwi.calcularDC(100, 0, 0, 20));
});

test("clasificar respeta los corchetes/paréntesis igual que ECOSOTAT (evaluarIndiceDinamico)", () => {
  const estandar = "[-100,1];(1,3];(3,9];(9,16];(16,100]";
  assert.equal(fwi.clasificar(1, estandar), "BAJO");
  assert.equal(fwi.clasificar(1.4, estandar), "BAJO"); // redondea a 1
  assert.equal(fwi.clasificar(1.6, estandar), "MODERADO"); // redondea a 2
  assert.equal(fwi.clasificar(16, estandar), "MUY ALTO");
  assert.equal(fwi.clasificar(16.5, estandar), "EXTREMO"); // redondea a 17? no: Math.round(16.5)=17 -> EXTREMO
  assert.equal(fwi.clasificar(-50, estandar), "BAJO");
  assert.equal(fwi.clasificar(500, estandar), "EXTREMO"); // supera el techo "100" del criterio -> cae a la categoría más alta, no falla

  // Eldorado/Iguazú: límites mixtos abierto/cerrado en ambas puntas de "MUY ALTO".
  const eldorado = "[-100,1);[1,2];(2,6];(6,13);[13,100]";
  assert.equal(fwi.clasificar(1, eldorado), "MODERADO"); // BAJO es exclusivo en 1
  assert.equal(fwi.clasificar(13, eldorado), "EXTREMO"); // MUY ALTO es exclusivo en 13
  assert.equal(fwi.clasificar(12, eldorado), "MUY ALTO");
});

test("clasificar tira un error legible ante un índice inválido (por debajo del piso configurado, o NaN)", () => {
  assert.throws(() => fwi.clasificar(-5, "[0,1];(1,2]"), /no se pudo clasificar/);
  assert.throws(() => fwi.clasificar(NaN, "[0,1];(1,2]"), /no se pudo clasificar/);
});
