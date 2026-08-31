/**
 * Quita tildes/diacríticos, pasa a mayúsculas y colapsa espacios. Se usa
 * para matchear nombres que vienen de fuentes distintas (docx, dataset de
 * municipios, nombres de archivo de íconos) sin que un acento de más/de
 * menos rompa la comparación.
 */
function normalize(str) {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

module.exports = { normalize };
