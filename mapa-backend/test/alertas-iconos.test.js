const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCanvas, loadImage } = require("canvas");
const { errorDeIconos, normalizarIconos, categorias } = require("../src/lib/alertasMeteorologicas");
const { loadDepartamentos } = require("../src/lib/departamentos");

test("un ícono admite un segundo color válido y lo conserva sólo si es distinto del primero", () => {
  assert.equal(errorDeIconos([{ id: "tormentas", categoria: "Amarillo", categoria2: "Naranja" }]), null);
  assert.equal(errorDeIconos([{ id: "tormentas", categoria: "Amarillo" }]), null, "sin segundo color sigue siendo válido");
  assert.equal(errorDeIconos([{ id: "tormentas", categoria: "Amarillo", categoria2: "" }]), null);
  assert.match(errorDeIconos([{ id: "tormentas", categoria: "Amarillo", categoria2: "Violeta" }]), /segundo color/);
  assert.deepEqual(normalizarIconos([
    { id: "tormentas", categoria: "Amarillo", categoria2: "Naranja" },
    { id: "granizo", categoria: "Rojo", categoria2: "Rojo" },
    { id: "inundacion", categoria: "Verde", categoria2: "" },
  ]), [
    { id: "tormentas", categoria: "Amarillo", categoria2: "Naranja" },
    { id: "granizo", categoria: "Rojo" },
    { id: "inundacion", categoria: "Verde" },
  ]);
});

test("la placa dibuja el subrayado en dos mitades cuando hay segundo color", async () => {
  const { generateAlertaMap } = require("../src/lib/generateAlertaMap");
  const zonas = loadDepartamentos().map((d) => ({ id: String(d.id), categoria: "Verde" }));
  const hex = (n) => { const h = categorias.find((c) => c.nombre === n).color; return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const [AM, NA] = [hex("Amarillo"), hex("Naranja")];
  const png = await generateAlertaMap({ zonas, periodo: "Próximas 24 horas", fondo: "tormenta", titulo: "Alerta", tamano: "feed",
    iconos: normalizarIconos([{ id: "tormentas", categoria: "Amarillo", categoria2: "Naranja" }]), tamanoPeriodo: 64 });
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height), ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  const cerca = (i, col) => [0, 1, 2].every((k) => Math.abs(data[i + k] - col[k]) <= 6);
  // Una fila con amarillo y naranja pegados: el amarillo termina donde empieza el naranja, mitades parejas.
  let hallada = null;
  for (let y = 0; y < img.height && !hallada; y++) {
    let a0 = -1, a1 = -1, n0 = -1, n1 = -1;
    for (let x = 0; x < img.width / 2; x++) {
      const i = (y * img.width + x) * 4;
      if (cerca(i, AM)) { if (a0 < 0) a0 = x; a1 = x; } else if (cerca(i, NA)) { if (n0 < 0) n0 = x; n1 = x; }
    }
    if (a1 - a0 > 60 && n1 - n0 > 60 && n0 - a1 <= 3) hallada = { a: a1 - a0 + 1, n: n1 - n0 + 1 };
  }
  assert.ok(hallada, "no se encontró el subrayado amarillo+naranja");
  assert.ok(Math.abs(hallada.a - hallada.n) <= 2, `las mitades deben ser parejas (${hallada.a} vs ${hallada.n})`);
});
