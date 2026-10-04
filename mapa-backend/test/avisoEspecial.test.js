const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCanvas, loadImage } = require("canvas");
const { generarAvisoEspecialAmbos, errorDeAvisoEspecial, lineaEmision, contener, MAX_TEXTO } = require("../src/lib/generateAvisoEspecial");

/** Captura de prueba: un PNG de w×h con manchas de colores (como un radar). */
function captura(w, h) {
  const c = createCanvas(w, h), ctx = c.getContext("2d");
  ctx.fillStyle = "#14203c"; ctx.fillRect(0, 0, w, h);
  ["#0c0", "#fe0", "#f80", "#d00"].forEach((color, i) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(((i + 1) * w) / 5, h / 2, Math.min(w, h) / 4, 0, 2 * Math.PI); ctx.fill(); });
  return c.toBuffer("image/png");
}
const NORMAL = "AVISO IMPORTANTE. ZONA DE TORMENTAS CON GRANIZO avanzando desde Paraguay en dirección a Misiones.\nDurante la tarde y noche de hoy estar atentos ante alertas a corto plazo que puedan ser emitidas por el SMN.";
const EMITIDO = "2026-09-29T18:45";

async function medidas(png) { const img = await loadImage(png); return [img.width, img.height]; }

test("línea de emisión con el formato de la placa", () => {
  assert.equal(lineaEmision("2026-09-03T07:05"), "Aviso emitido el 03/09/2026 a las 07:05hs.");
});

test("validación de texto y fecha", () => {
  assert.equal(errorDeAvisoEspecial({ texto: NORMAL, emitidoEn: EMITIDO }), null);
  assert.match(errorDeAvisoEspecial({ texto: "   ", emitidoEn: EMITIDO }), /Escribí el aviso/);
  assert.match(errorDeAvisoEspecial({ texto: "x".repeat(MAX_TEXTO + 1), emitidoEn: EMITIDO }), /Escribí el aviso/);
  for (const f of ["", "2026-09-29", "2026-13-01T10:00", "2026-09-29T25:00", "29/09/2026 18:45", null]) {
    assert.match(errorDeAvisoEspecial({ texto: NORMAL, emitidoEn: f }), /fecha y hora/, String(f));
  }
});

test("contain-fit: no recorta y respeta la caja en cada eje", () => {
  assert.deepEqual(contener(3000, 500, 1700, 950), { w: 1700, h: 283 }); // panorámica: manda el ancho
  assert.deepEqual(contener(400, 1400, 1700, 950), { w: 271, h: 950 }); // vertical: manda el alto
  assert.deepEqual(contener(320, 240, 1700, 950), { w: 1267, h: 950 }); // chica: se agranda
});

test("genera feed 2250×2813 e historias 2250×4000 con texto corto, largo e imágenes extremas", { timeout: 120000 }, async () => {
  const casos = [
    ["corto", "Tormentas en Paraguay hacia Misiones.", captura(1280, 720)],
    ["largo (tope)", (NORMAL + " ").repeat(3).slice(0, MAX_TEXTO), captura(1280, 720)],
    ["panorámica", NORMAL, captura(3000, 500)],
    ["vertical", NORMAL, captura(400, 1400)],
  ];
  for (const [nombre, texto, imagen] of casos) {
    const { feedPng, historiasPng } = await generarAvisoEspecialAmbos({ texto, emitidoEn: EMITIDO, imagen });
    assert.deepEqual(await medidas(feedPng), [2250, 2813], nombre);
    assert.deepEqual(await medidas(historiasPng), [2250, 4000], nombre);
  }
});

test("imagen inválida o un texto imposible de acomodar dan error 400", { timeout: 60000 }, async () => {
  await assert.rejects(generarAvisoEspecialAmbos({ texto: NORMAL, emitidoEn: EMITIDO, imagen: Buffer.from("no es una imagen") }), { status: 400 });
  await assert.rejects(generarAvisoEspecialAmbos({ texto: NORMAL, emitidoEn: EMITIDO, imagen: captura(20, 20) }), { status: 400 });
  const renglones = Array.from({ length: 90 }, (_, i) => `r${i}`).join("\n"); // < MAX_TEXTO pero 90 renglones
  await assert.rejects(generarAvisoEspecialAmbos({ texto: renglones, emitidoEn: EMITIDO, imagen: captura(800, 600) }), { status: 400, message: /demasiado largo/ });
});

test("título de dos líneas y nivel: se validan y la placa sale con cualquiera de los niveles", { timeout: 60000 }, async () => {
  assert.equal(errorDeAvisoEspecial({ texto: NORMAL, emitidoEn: EMITIDO, titulo: "Aviso especial", subtitulo: "Por tormentas", nivel: "Naranja" }), null);
  assert.equal(errorDeAvisoEspecial({ texto: NORMAL, emitidoEn: EMITIDO, titulo: "Aviso", subtitulo: "", nivel: null }), null);
  assert.match(errorDeAvisoEspecial({ texto: NORMAL, emitidoEn: EMITIDO, titulo: " " }), /título/);
  assert.match(errorDeAvisoEspecial({ texto: NORMAL, emitidoEn: EMITIDO, subtitulo: "x".repeat(41) }), /segunda línea/);
  assert.match(errorDeAvisoEspecial({ texto: NORMAL, emitidoEn: EMITIDO, nivel: "Violeta" }), /Nivel/);
  for (const nivel of [null, "Amarillo", "Rojo"]) {
    const { feedPng } = await generarAvisoEspecialAmbos({ texto: NORMAL, emitidoEn: EMITIDO, titulo: "Aviso especial", subtitulo: nivel ? "Por tormentas" : "", nivel, imagen: captura(1280, 720) });
    assert.deepEqual(await medidas(feedPng), [2250, 2813], String(nivel));
  }
});
