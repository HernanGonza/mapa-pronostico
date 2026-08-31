const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const JSZip = require("jszip");
const { loadImage } = require("canvas");

const coordinates = require("../src/config/coordinates");
const { extractDocxTables } = require("../src/lib/docxTables");
const { generateForecastMap } = require("../src/lib/generateMap");
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

test("fast-xml-parser 5 conserva la lectura de tablas DOCX", async () => {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
     <w:document xmlns:w="urn:test"><w:body><w:tbl>
       <w:tr><w:tc><w:p><w:r><w:t>LOCALIDAD</w:t></w:r></w:p></w:tc></w:tr>
       <w:tr><w:tc><w:p><w:r><w:t>POSADAS</w:t></w:r></w:p></w:tc></w:tr>
     </w:tbl></w:body></w:document>`
  );
  const tables = await extractDocxTables(await zip.generateAsync({ type: "nodebuffer" }));
  assert.deepEqual(tables, [[['LOCALIDAD'], ['POSADAS']]]);
});

test("canvas 3 genera el PNG de redes en 1280 x 1280", async () => {
  const outputPath = path.join(os.tmpdir(), `mapa-test-${process.pid}.png`);
  const forecastRows = coordinates.map(({ LOCALIDAD }) => ({
    LOCALIDAD,
    TMIN: 18,
    TMAX: 29,
    CONDICION: "despejado",
  }));
  try {
    await generateForecastMap({ forecastRows, outputPath, date: new Date("2026-08-31T12:00:00-03:00") });
    const image = await loadImage(outputPath);
    assert.equal(image.width, 1280);
    assert.equal(image.height, 1280);
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
});
