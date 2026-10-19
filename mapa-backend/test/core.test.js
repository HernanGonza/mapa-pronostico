const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadImage } = require("canvas");

const coordinates = require("../src/config/coordinates");
const { generateForecastMap, MATERIALES_DIR } = require("../src/lib/generateMap");
const { errorDeFilas } = require("../src/routes/pronostico");

test("valida coherencia de temperaturas antes de publicar", () => {
  assert.match(
    errorDeFilas([{ LOCALIDAD: "Posadas", TMIN: 30, TMAX: 20, CONDICION: "despejado" }]),
    /TMIN no puede superar TMAX/
  );
  assert.equal(
    errorDeFilas([{ LOCALIDAD: "Posadas", TMIN: 20, TMAX: 30, CONDICION: "despejado" }]),
    null
  );
});

test("canvas 3 genera el PNG de redes del mismo tamaño que basemap.png", async () => {
  const outputPath = path.join(os.tmpdir(), `mapa-test-${process.pid}.png`);
  const forecastRows = coordinates.map(({ LOCALIDAD }) => ({
    LOCALIDAD,
    TMIN: 18,
    TMAX: 29,
    CONDICION: "despejado",
  }));
  try {
    const basemap = await loadImage(path.join(MATERIALES_DIR, "basemap.png"));
    await generateForecastMap({ forecastRows, outputPath, date: new Date("2026-08-31T12:00:00-03:00") });
    const image = await loadImage(outputPath);
    assert.equal(image.width, basemap.width);
    assert.equal(image.height, basemap.height);
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
});
