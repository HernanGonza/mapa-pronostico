const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generatePlacaAlerta, errorDePlacaAlerta, normalizarPlacaAlerta, lineaVigencia, RECOMENDACIONES_PREDETERMINADAS } = require("../src/lib/generatePlacasAlerta");
const { errorDeCambioVigencia } = require("../src/lib/alertasMeteorologicasStore");

const vigencia = { tipo: "vigencia", nivel: "Naranja", datos: { zonas: [{ nombre: "Zona norte", fecha: "2026-10-03", desde: "18:00", hasta: "24:00" }], descripcion: "Tormentas fuertes.", nota: "Siguen vigentes las recomendaciones." } };
const recomendaciones = { tipo: "recomendaciones", nivel: "Rojo", datos: { fenomeno: "tormenta", items: RECOMENDACIONES_PREDETERMINADAS } };
const aviso = { tipo: "aviso", nivel: "Amarillo", datos: { fenomeno: "tormenta", vigencia: "próximas 3 horas", zona: "Zona sur", descripcion: "Ingresarán tormentas.", nota: "" } };

test("la vigencia de una zona sale con el día de la semana", () => {
  assert.equal(lineaVigencia({ fecha: "2026-10-03", desde: "12:00", hasta: "24:00" }), "Vigencia: sábado 03/10/2026 de 12:00 a 24:00 horas");
  assert.equal(lineaVigencia({ fecha: "2026-10-05", desde: "6:00", hasta: "9:30" }), "Vigencia: lunes 05/10/2026 de 06:00 a 09:30 horas");
});

test("valida lo que manda el panel", () => {
  for (const p of [vigencia, recomendaciones, aviso]) assert.equal(errorDePlacaAlerta(p), null, p.tipo);
  assert.match(errorDePlacaAlerta({ ...vigencia, nivel: "Verde" }), /nivel/);
  assert.match(errorDePlacaAlerta({ ...vigencia, tipo: "otra" }), /Tipo/);
  assert.match(errorDePlacaAlerta({ ...vigencia, datos: { ...vigencia.datos, zonas: [{ nombre: "X", fecha: "2026-10-03", desde: "25:00", hasta: "24:00" }] } }), /horario/);
  assert.match(errorDePlacaAlerta({ ...recomendaciones, datos: { fenomeno: "tormenta", items: [{ texto: "Algo", icono: "inventado" }] } }), /ícono/);
  assert.match(errorDePlacaAlerta({ ...recomendaciones, datos: { fenomeno: "tormenta", items: [{ texto: "Algo", imagen: "data:text/html;base64,AAAA" }] } }), /ícono subido/);
  assert.equal(errorDePlacaAlerta({ ...recomendaciones, datos: { fenomeno: "tormenta", items: [{ texto: "Algo", imagen: "data:image/png;base64,AAAA" }] } }), null);
  assert.match(errorDePlacaAlerta({ ...aviso, datos: { ...aviso.datos, zona: "" } }), /zona/);
});

test("normalizar deja sólo los campos que se usan", () => {
  const n = normalizarPlacaAlerta({ ...aviso, datos: { ...aviso.datos, zona: "  Zona sur  ", extra: 1 } });
  assert.deepEqual(Object.keys(n.datos).sort(), ["descripcion", "fenomeno", "nota", "vigencia", "zona"]);
  assert.equal(n.datos.zona, "Zona sur");
});

test("genera feed e historias de los tres tipos", async () => {
  for (const p of [vigencia, recomendaciones, aviso]) for (const t of ["feed", "historias"]) {
    const png = await generatePlacaAlerta(p, t);
    assert.ok(png.length > 100000, `${p.tipo} ${t}`);
  }
});

test("con todo al máximo permitido, la placa entra igual (con letra más chica)", async () => {
  const z = (n) => "palabra ".repeat(n).trim();
  const zona = { nombre: z(7), fecha: "2026-10-03", desde: "12:00", hasta: "24:00" };
  const maxima = { tipo: "vigencia", nivel: "Rojo", datos: { zonas: [zona, zona, zona, zona], descripcion: z(87), nota: z(27) } };
  assert.equal(errorDePlacaAlerta(maxima), null);
  assert.ok((await generatePlacaAlerta(maxima, "feed")).length > 100000);
  const recs = { tipo: "recomendaciones", nivel: "Rojo", datos: { fenomeno: z(4), items: Array.from({ length: 7 }, () => ({ texto: z(17), icono: "alerta" })) } };
  assert.equal(errorDePlacaAlerta(recs), null);
  assert.ok((await generatePlacaAlerta(recs, "feed")).length > 100000);
});

test("la vigencia nueva tiene que ser futura y de hasta 7 días", () => {
  const en = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  assert.equal(errorDeCambioVigencia(en(5)), null);
  assert.match(errorDeCambioVigencia(en(-1)), /futura/);
  assert.match(errorDeCambioVigencia(en(24 * 8)), /7 días/);
  assert.match(errorDeCambioVigencia("mañana"), /Elegí/);
});

test("actualización de nivel: valida el nivel anterior y genera feed e historias", async () => {
  const { lineaVigenciaNivel } = require("../src/lib/generatePlacasAlerta");
  const nivel = { tipo: "nivel", nivel: "Naranja", datos: { fenomeno: "tormenta", nivelAnterior: "Amarillo", zona: "Zona norte de Misiones", vigencia: { fecha: "2026-10-04", desde: "00:00", hasta: "06:00" }, descripcion: "Tormentas fuertes." } };
  assert.equal(errorDePlacaAlerta(nivel), null);
  assert.equal(errorDePlacaAlerta({ ...nivel, datos: { ...nivel.datos, nivelAnterior: "Verde" } }), null);
  assert.match(errorDePlacaAlerta({ ...nivel, datos: { ...nivel.datos, nivelAnterior: "Naranja" } }), /distinto/);
  assert.match(errorDePlacaAlerta({ ...nivel, datos: { ...nivel.datos, nivelAnterior: "Violeta" } }), /venía/);
  assert.match(errorDePlacaAlerta({ ...nivel, datos: { ...nivel.datos, vigencia: { fecha: "2026-10-04", desde: "0", hasta: "06:00" } } }), /horario/);
  assert.equal(lineaVigenciaNivel({ fecha: "2026-10-04", desde: "0:00", hasta: "6:00" }), "Vigencia: 04/10/2026 desde las 00:00 a 06:00 horas.");
  for (const t of ["feed", "historias"]) assert.ok((await generatePlacaAlerta(nivel, t)).length > 100000);
});
