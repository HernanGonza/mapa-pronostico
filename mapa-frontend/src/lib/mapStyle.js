// Algunos tiles omiten rank/ref_length/admin_level. Las comparaciones
// numéricas del estilo upstream deben excluir esos registros sin evaluar null.
export function filtrosConNumerosValidos(expression) {
  if (!Array.isArray(expression)) return expression;
  const result = expression.map(filtrosConNumerosValidos);
  if (["<", "<=", ">", ">="].includes(result[0]) && result[1]?.[0] === "get" && typeof result[2] === "number") {
    return ["case", ["==", ["typeof", result[1]], "number"], result, false];
  }
  return result;
}
export function prepararEstilo(_previous, style) {
  return { ...style, layers: style.layers.map(layer => layer.filter ? { ...layer, filter: filtrosConNumerosValidos(layer.filter) } : layer) };
}
