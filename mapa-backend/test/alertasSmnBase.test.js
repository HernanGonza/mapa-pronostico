const test = require("node:test");
const assert = require("node:assert/strict");
const { candidata, esLaMisma, cambios, origenDe, iconosDeTexto } = require("../src/lib/alertasSmnBase");

const departamentos = require("../data/departamentos.json");
const idDe = (nombre) => String(departamentos.find((d) => d.nombre === nombre).id);
const AHORA = Date.parse("2026-10-08T11:00:00Z");

// Un mensaje CAP del SMN: una zona (con polígono) de la provincia, para un tramo horario.
const info = (categoria, inicio, fin, deps, extra = {}) => ({
  titulo: "Tormentas", evento: "Tormentas", categoria, inicio, fin, descripcion: "El área será afectada por tormentas.", instrucciones: "Evitá salir.",
  zonas: [{ nombre: "Área", departamentos: deps, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] } }], ...extra });
const alerta = (id, ...infos) => ({ id, emitidoEn: "2026-10-08T08:55:53.000Z", infos });
const NORTE = ["Eldorado", "Iguazú", "San Pedro"], SUR = ["Capital", "Candelaria"];

test("el SMN parte la provincia en zonas con el mismo horario: es una sola alerta para toda la provincia", () => {
  const c = candidata([
    alerta("a", info("Amarillo", "2026-10-08T09:00:00.000Z", "2026-10-08T14:59:59.000Z", NORTE)),
    alerta("b", info("Amarillo", "2026-10-08T09:00:00.000Z", "2026-10-08T14:59:59.000Z", SUR)),
  ], departamentos, { ahora: AHORA });
  assert.equal(c.base.zonas.filter((z) => z.categoria === "Amarillo").length, 5);
  assert.equal(c.base.zonas.filter((z) => z.categoria === "Verde").length, 12);
  assert.equal(c.base.vigenteHasta, "2026-10-08T15:00:00.000Z"); // el «…:59:59» se lee como la hora redonda
  assert.deepEqual(c.base.tramos, {}); // todos terminan a la vez: vale entera hasta que se baja sola
  assert.deepEqual(c.fenomenos, ["Tormentas"]);
});

test("los horarios de cada tramo arman la vigencia de cada departamento: sube a naranja y vuelve a amarillo", () => {
  const c = candidata([
    alerta("a", info("Amarillo", "2026-10-08T09:00:00.000Z", "2026-10-08T14:59:59.000Z", NORTE)),
    alerta("b", info("Naranja", "2026-10-08T15:00:00.000Z", "2026-10-08T20:59:59.000Z", NORTE)),
    alerta("c", info("Amarillo", "2026-10-08T21:00:00.000Z", "2026-10-09T02:59:59.000Z", NORTE)),
    alerta("d", info("Amarillo", "2026-10-08T09:00:00.000Z", "2026-10-09T02:59:59.000Z", SUR)),
  ], departamentos, { ahora: AHORA });
  const t = c.base.tramos[idDe("Iguazú")];
  assert.deepEqual(t.map((x) => [x.categoria, x.hasta]), [["Amarillo", "2026-10-08T15:00:00.000Z"], ["Naranja", "2026-10-08T21:00:00.000Z"], ["Amarillo", "2026-10-09T03:00:00.000Z"]]);
  assert.equal(c.base.zonas.find((z) => z.id === idDe("Iguazú")).categoria, "Amarillo");
  assert.equal(c.base.tramos[idDe("Capital")], undefined); // el sur tiene un solo tramo hasta el final
  assert.equal(c.base.vigenteHasta, "2026-10-09T03:00:00.000Z");
  assert.equal(c.categoria, "Naranja");
});

test("lo que empieza más tarde deja el departamento en verde hasta su hora; lo que ya pasó no cuenta", () => {
  const c = candidata([
    alerta("a", info("Amarillo", "2026-10-08T03:00:00.000Z", "2026-10-08T05:59:59.000Z", SUR)), // ya terminó antes de AHORA
    alerta("b", info("Naranja", "2026-10-08T15:00:00.000Z", "2026-10-08T20:59:59.000Z", NORTE)),
  ], departamentos, { ahora: AHORA });
  assert.deepEqual(c.base.tramos[idDe("Eldorado")].map((x) => [x.categoria, x.hasta]), [["Verde", "2026-10-08T15:00:00.000Z"], ["Naranja", "2026-10-08T21:00:00.000Z"]]);
  assert.equal(c.base.zonas.find((z) => z.id === idDe("Eldorado")).categoria, "Naranja");
  assert.equal(c.base.zonas.find((z) => z.id === idDe("Capital")).categoria, "Verde");
});

test("el SMN extiende el rango de horas: llega como alerta nueva pero se reconoce como la misma", () => {
  const antes = candidata([alerta("a", info("Amarillo", "2026-10-08T09:00:00.000Z", "2026-10-08T14:59:59.000Z", NORTE))], departamentos, { ahora: AHORA });
  const despues = candidata([alerta("z", info("Amarillo", "2026-10-08T09:00:00.000Z", "2026-10-08T20:59:59.000Z", [...NORTE, "Capital"]))], departamentos, { ahora: AHORA });
  assert.equal(esLaMisma(origenDe(antes), despues), true);
  assert.deepEqual(cambios(origenDe(antes), despues), ["vigencia", "zonas"]);
  // otro fenómeno, o un período que no se toca, es otra alerta
  const viento = candidata([alerta("v", info("Amarillo", "2026-10-08T09:00:00.000Z", "2026-10-08T14:59:59.000Z", NORTE, { evento: "Vientos", titulo: "Vientos" }))], departamentos, { ahora: AHORA });
  assert.equal(esLaMisma(origenDe(antes), viento), false);
  const mañana = candidata([alerta("m", info("Amarillo", "2026-10-09T09:00:00.000Z", "2026-10-09T14:59:59.000Z", NORTE))], departamentos, { ahora: AHORA });
  assert.equal(esLaMisma(origenDe(antes), mañana), false);
});

test("el SMN trae un solo evento, pero el texto cuenta todos los fenómenos: se leen del texto", () => {
  const descripcion = "El área será afectada por tormentas de variada intensidad, algunas localmente fuertes. Las mismas podrían estar acompañadas por abundantes precipitaciones en cortos periodos, ocasional granizo, actividad eléctrica frecuente y ráfagas intensas. Se esperan valores de precipitación acumulada entre 30 y 50 mm.";
  assert.deepEqual(iconosDeTexto({ evento: "Tormentas", descripcion }), ["tormentas", "granizo", "vientos-fuertes", "lluvias-intensas"]);
  assert.deepEqual(iconosDeTexto({ evento: "Tormentas", descripcion: "Tormentas aisladas." }), ["tormentas"]);
  assert.deepEqual(iconosDeTexto({ evento: "Vientos", descripcion: "Vientos intensos del sector sur." }), ["vientos-fuertes"]);
  assert.deepEqual(iconosDeTexto({ evento: "Tormentas severas", descripcion: "tormentas severas con granizo" }), ["tormentas-severas", "granizo"]);
  assert.deepEqual(iconosDeTexto({ evento: "Temperaturas extremas", descripcion: "Calor extremo." }), []);
  const c = candidata([alerta("a", info("Naranja", "2026-10-08T09:00:00.000Z", "2026-10-08T14:59:59.000Z", NORTE, { descripcion }))], departamentos, { ahora: AHORA });
  assert.deepEqual(c.base.iconos.map((i) => i.id), ["tormentas", "granizo", "vientos-fuertes", "lluvias-intensas"]);
  assert.ok(c.base.iconos.every((i) => i.categoria === "Naranja"));
  assert.deepEqual(c.avisos, []);
});

test("un fenómeno que no tiene ícono en el mapa se avisa (y no se inventa)", () => {
  const c = candidata([alerta("a", info("Amarillo", "2026-10-08T09:00:00.000Z", "2026-10-08T14:59:59.000Z", NORTE, { evento: "Temperaturas extremas", titulo: "Temperaturas extremas", descripcion: "Calor extremo." }))], departamentos, { ahora: AHORA });
  assert.deepEqual(c.base.iconos, []);
  assert.match(c.avisos[0], /Temperaturas extremas.*no tiene ícono/);
  const ok = candidata([alerta("b", info("Amarillo", "2026-10-08T09:00:00.000Z", "2026-10-08T14:59:59.000Z", NORTE))], departamentos, { ahora: AHORA });
  assert.deepEqual(ok.avisos, []);
});

test("los departamentos que nombra el SMN existen todos en el mapa (nombres corregidos)", () => {
  const geo = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "data", "departamentos.geojson"), "utf8"));
  const { sinTildes } = require("../src/lib/alertasSmnAuto");
  const catalogo = new Set(departamentos.map((d) => sinTildes(d.nombre)));
  for (const f of geo.features) assert.ok(catalogo.has(sinTildes(f.properties.nombre)), f.properties.nombre);
});
