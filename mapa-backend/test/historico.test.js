const { test } = require("node:test");
const assert = require("node:assert/strict");
const { tipoValido, severidadValida, TIPOS_EVENTO } = require("../src/lib/catalogoEventos");
const { errorDeEvento } = require("../src/lib/eventosClimaticosStore");
const { detectarColumnas, normalizarFecha, normalizarNumero } = require("../src/lib/importadorClimatico");

const EVENTO_VALIDO = {
  tipo: "tornado", tipoOtro: null, titulo: "Tornado en Oberá", descripcion: "Voló techos en el barrio X.",
  severidad: "severo", fechaInicio: "2026-09-10", fechaFin: "2026-09-10", departamento: "Oberá", lat: -27.5, lng: -55.1,
};

test("catálogo de tipos de evento: 7 tipos fijos, 'otro' incluido", () => {
  assert.equal(TIPOS_EVENTO.length, 7);
  assert.ok(tipoValido("tornado"));
  assert.ok(tipoValido("otro"));
  assert.ok(!tipoValido("huracan"));
  assert.ok(severidadValida(null));
  assert.ok(severidadValida("leve"));
  assert.ok(!severidadValida("catastrofico"));
});

test("errorDeEvento acepta un evento válido y rechaza cada campo roto", () => {
  assert.equal(errorDeEvento(EVENTO_VALIDO), null);
  assert.ok(errorDeEvento({ ...EVENTO_VALIDO, tipo: "huracan" }));
  assert.ok(errorDeEvento({ ...EVENTO_VALIDO, tipo: "otro", tipoOtro: "" }));
  assert.equal(errorDeEvento({ ...EVENTO_VALIDO, tipo: "otro", tipoOtro: "vendaval" }), null);
  assert.ok(errorDeEvento({ ...EVENTO_VALIDO, titulo: "" }));
  assert.ok(errorDeEvento({ ...EVENTO_VALIDO, descripcion: "" }));
  assert.ok(errorDeEvento({ ...EVENTO_VALIDO, severidad: "catastrofico" }));
  assert.ok(errorDeEvento({ ...EVENTO_VALIDO, fechaInicio: "no es una fecha" }));
  assert.ok(errorDeEvento({ ...EVENTO_VALIDO, fechaFin: "2026-09-01" })); // antes que fechaInicio
  assert.ok(errorDeEvento({ ...EVENTO_VALIDO, departamento: "Marte" }));
  assert.ok(errorDeEvento({ ...EVENTO_VALIDO, lat: 10 })); // fuera de Misiones
  assert.ok(errorDeEvento({ ...EVENTO_VALIDO, lng: 10 }));
  assert.ok(errorDeEvento({ ...EVENTO_VALIDO, imagenes: Array.from({ length: 9 }, () => ({ dataUrl: "x" })) }));
  assert.ok(errorDeEvento({ ...EVENTO_VALIDO, imagenes: [{ dataUrl: "no-es-una-imagen-base64" }] }));
  const pngMinimo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  assert.equal(errorDeEvento({ ...EVENTO_VALIDO, imagenes: [{ dataUrl: pngMinimo, pieDeFoto: "daño en el techo" }] }), null);
});

test("importador: detecta columnas de un CSV y normaliza fecha/número", () => {
  const csv = "fecha,estacion,tmin,tmax\n2026-01-01,Posadas,18,30\n01/02/2026,Oberá,17.5,29,3\n";
  const { columnas, filas } = detectarColumnas(csv);
  assert.deepEqual(columnas, ["fecha", "estacion", "tmin", "tmax"]);
  assert.equal(filas, 2);

  assert.equal(normalizarFecha("2026-01-01"), "2026-01-01");
  assert.equal(normalizarFecha("1/2/2026"), "2026-02-01");
  assert.equal(normalizarFecha("no es una fecha"), null);
  assert.equal(normalizarFecha(""), null);

  assert.equal(normalizarNumero("18"), 18);
  assert.equal(normalizarNumero("17,5"), 17.5);
  assert.equal(normalizarNumero(""), null);
  assert.equal(normalizarNumero("no es un número"), undefined);
});
