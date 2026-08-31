const fs = require("fs");
const path = require("path");
const { normalize } = require("./normalizeText");

/**
 * Busca el ícono correspondiente a una condición climática dentro de
 * imgsDir, sin importar tildes exactas en el nombre del archivo.
 * Devuelve la ruta absoluta o null si no encuentra coincidencia.
 */
function resolveIconPath(imgsDir, condicion) {
  const target = normalize(condicion);
  const files = fs.readdirSync(imgsDir).filter((f) => f.toLowerCase().endsWith(".png"));

  for (const file of files) {
    const base = file.replace(/\.png$/i, "");
    if (normalize(base) === target) {
      return path.join(imgsDir, file);
    }
  }
  return null;
}

module.exports = { resolveIconPath };
