/**
 * Quita tildes/diacríticos, mayúsculas, espacios colapsados. Mismo
 * criterio que src/lib/normalizeText.js del backend, para que las
 * comparaciones de nombres/condiciones sean consistentes en los dos lados.
 */
export function normalize(str) {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}
