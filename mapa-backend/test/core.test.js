const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const JSZip = require("jszip");
const { loadImage } = require("canvas");

const coordinates = require("../src/config/coordinates");
const { extractDocxTables } = require("../src/lib/docxTables");
const { generateForecastMap, MATERIALES_DIR } = require("../src/lib/generateMap");
const { errorDeFilas } = require("../src/routes/pronostico");
const { buildExtendedForecast, hayExtendido } = require("../src/lib/parseForecastExtendido");

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

test("lee 'PRONÓSTICO EXTENDIDO' e 'INFORMES DE PRONÓSTICO' como texto libre (no tablas)", () => {
  // Reproduce el formato real que manda Alerta Temprana (verificado a mano
  // contra un .docx real): cada línea es un párrafo propio.
  const parrafos = [
    "PRONÓSTICO EXTENDIDO",
    "ZONA SUR",
    "SÁBADO 12 DE SEPTIEMBRE   12 °C  21 °C PARCIALMENTE NUBLADO",
    "DOMINGO 13 DE SEPTIEMBRE 11 °C  19 °C ALGO NUBLADO",
    "ZONA CENTRO",
    "SÁBADO 12 DE SEPTIEMBRE   13 °C  24 °C ALGO NUBLADO",
    "DOMINGO 13 DE SEPTIEMBRE 10 °C  22 °C PARCIALMENTE NUBLADO",
    "ZONA NORTE",
    "SÁBADO 12 DE SEPTIEMBRE   14 °C  25 °C ALGO NUBLADO",
    "DOMINGO 13 DE SEPTIEMBRE 11 °C  20 °C LLUVIAS LEVES",
    "INFORMES DE PRONÓSTICO",
    "Viernes 11 de septiembre",
    "Cielo cubierto a nublado.",
    "Precipitaciones: se esperan entre 5 y hasta 70 mm.",
    "Sábado 12 de septiembre",
    "Cielo ligeramente nublado.",
    "Domingo 13 de septiembre",
    "Cielo parcialmente nublado.",
    "FUENTE: Dirección General de Alerta Temprana.",
  ];
  const tablas = [
    [["LOCALIDAD", "MIN", "MAX", "CONDICIÓN"], ["PUERTO IGUAZÚ", "19°", "26°", "LLUVIAS Y TORMENTAS"]],
    [["LOCALIDAD", "MIN", "MAX", "CONDICIÓN"], ["MONTECARLO", "18°", "22°", "LLUVIAS Y TORMENTAS"]],
    [["LOCALIDAD", "MIN", "MAX", "CONDICIÓN"], ["POSADAS", "17°", "21°", "NUBLADO"]],
  ];
  const extendido = buildExtendedForecast(tablas, parrafos);
  assert.equal(hayExtendido(extendido), true);
  assert.equal(extendido.zonas.length, 3);
  const sur = extendido.zonas.find((z) => z.zona === "Sur");
  assert.deepEqual(
    sur.dias.map((d) => d.etiqueta),
    ["Hoy", "Sábado", "Domingo"]
  );
  assert.equal(sur.dias[0].tmin, "17"); // agregado de la 3ª tabla (norte/centro/sur), única fila cargada en el fixture
  assert.equal(sur.dias[1].tmax, "21");
  assert.equal(sur.dias[2].condicion, "ALGO NUBLADO");
  assert.equal(extendido.informes.length, 3);
  assert.equal(extendido.informes[0].dia, "Viernes");
  assert.match(extendido.informes[0].texto, /Cielo cubierto a nublado\. Precipitaciones/);

  assert.equal(hayExtendido(null), false);
  assert.equal(hayExtendido(buildExtendedForecast(tablas, [])), false);
});
