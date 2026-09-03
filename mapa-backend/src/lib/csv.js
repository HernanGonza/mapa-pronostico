/**
 * Parser de CSV mínimo (RFC4180 básico: comillas dobles, comas y saltos de
 * línea escapados con "" adentro de un campo entre comillas). No es un
 * parser completo — alcanza para lo que suele mandar un sistema externo
 * (sin CSVs multilínea raros) y evita sumar una dependencia para esto.
 * Devuelve un array de objetos usando la primera fila como headers, en el
 * mismo shape que espera `extraerFocos` del front (array de objetos).
 */

function parseLinea(linea) {
  const campos = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (entreComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') {
          actual += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        actual += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ",") {
      campos.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos;
}

function parseCsv(texto) {
  const lineas = texto
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== "");
  if (lineas.length < 1) return [];
  const headers = parseLinea(lineas[0]).map((h) => h.trim());
  return lineas.slice(1).map((linea) => {
    const campos = parseLinea(linea);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = campos[i] !== undefined ? campos[i].trim() : "";
    });
    return obj;
  });
}

module.exports = { parseCsv };
