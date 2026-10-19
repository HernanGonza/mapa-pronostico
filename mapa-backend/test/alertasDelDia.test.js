const test = require("node:test");
const assert = require("node:assert/strict");
const { delDia, ahoraPorDepartamento } = require("../src/lib/alertasDelDia");
const { conAlertas, departamentoDe } = require("../src/lib/alertasMunicipios");

const departamentos = require("../data/departamentos.json");
const zonas = (nivelPorId) => departamentos.map((d) => ({ id: String(d.id), categoria: nivelPorId[d.id] || "Verde" }));
// Publicada el 08/10 a las 06:00 (hora de Misiones): Amarillo hasta las 15:00 y Naranja hasta las 21:00 en el depto 6.
const pub = (extra = {}) => ({ id: 7, publicadoEn: "2026-10-08T09:00:00.000Z", vigenteHasta: "2026-10-09T03:00:00.000Z", enFilaDe: null,
  zonasBase: zonas({ 6: "Amarillo", 1: "Amarillo" }), iconosBase: [{ id: "tormentas", categoria: "Amarillo" }],
  tramos: { 6: [{ categoria: "Amarillo", hasta: "2026-10-08T18:00:00.000Z" }, { categoria: "Naranja", hasta: "2026-10-09T00:00:00.000Z" }] }, ...extra });

test("las alertas de un día: nivel más alto, nombre con el color y cuándo rige", () => {
  const [a] = delDia("2026-10-08", [pub()], null, departamentos);
  assert.equal(a.nivel, "Naranja");
  assert.equal(a.nombre, "Alerta naranja por tormentas");
  assert.equal(a.color, "#F9881F");
  assert.deepEqual(a.departamentos.sort(), [departamentos.find((d) => d.id == 1).nombre, departamentos.find((d) => d.id == 6).nombre].sort());
  assert.match(a.texto, /durante todo el día|desde las|hasta las|de las/);
});

test("el informe de la noche, que trae los datos de mañana, ve la alerta de mañana (y no la de hoy si ya terminó)", () => {
  const hoy = delDia("2026-10-08", [pub()], null, departamentos);
  const manana = delDia("2026-10-09", [pub()], null, departamentos); // sólo hasta las 00:00 del 09 (03:00Z)
  assert.equal(hoy.length, 1);
  assert.equal(manana.length, 0);
  const sigue = delDia("2026-10-09", [pub({ vigenteHasta: "2026-10-09T15:00:00.000Z", tramos: {} })], null, departamentos);
  assert.equal(sigue.length, 1);
  assert.match(sigue[0].texto, /hasta las 12:00/);
});

test("una alerta que todavía no se publicó se ofrece desde la base del SMN; sin alertas, la lista queda vacía", () => {
  const smn = { inicio: "2026-10-08T15:00:00.000Z", base: { zonas: zonas({ 3: "Naranja" }), tramos: {}, vigenteHasta: "2026-10-09T03:00:00.000Z", iconos: [{ id: "vientos-fuertes", categoria: "Naranja" }], periodo: "x" } };
  const [a] = delDia("2026-10-08", [], smn, departamentos);
  assert.equal(a.origen, "smn");
  assert.equal(a.nombre, "Alerta naranja por vientos fuertes");
  assert.deepEqual(delDia("2026-10-20", [pub()], smn, departamentos), []);
});

test("las 13 ciudades del informe tienen su departamento", () => {
  const { ciudadesDepartamento, CIUDADES } = require("../src/lib/alertasMunicipios");
  const c = ciudadesDepartamento();
  assert.equal(Object.keys(c).length, CIUDADES.length);
  assert.equal(c["POSADAS"], "Capital");
  assert.equal(c["JARDÍN AMÉRICA"], "San Ignacio");
  assert.equal(c["BERNARDO DE IRIGOYEN"], "General Manuel Belgrano");
});

test("cada municipio sabe si su departamento tiene alerta ahora", () => {
  const vigente = { id: 1, zonas: zonas({ 4: "Rojo" }), iconos: [{ id: "granizo", categoria: "Rojo" }], vigenteHasta: "2026-10-09T03:00:00.000Z" };
  assert.equal(ahoraPorDepartamento([vigente]).get("4").nivel, "Rojo");
  const municipios = require("../data/municipios.json");
  const r = conAlertas(municipios, [vigente]);
  const dep = departamentoDe();
  const con = r.filter((m) => m.alerta), sin = r.filter((m) => !m.alerta);
  assert.ok(con.length > 0 && sin.length > 0);
  assert.ok(con.every((m) => dep.get(m.id) === "4"));
  assert.equal(con[0].alerta.nombre, "Alerta roja por granizo");
  assert.ok(conAlertas(municipios, []).every((m) => m.alerta === null));
});
