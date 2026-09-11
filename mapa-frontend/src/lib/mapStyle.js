export const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

// Preferir español; si el tile no trae traducción, conservar el nombre local.
const NOMBRE_ES = ["coalesce",
  ["get", "name:es"], ["get", "name_es"], ["get", "name"], ["get", "name:latin"], "",
];
const NOMBRE_LOCALIZADO = ["case",
  ["any", ...["name", "name_en", "name:en", "name:latin", "name:es", "name_es"].map(key =>
    ["match", ["get", key],
      ["Falkland Islands", "Falkland Islands (Malvinas)", "Islas Malvinas (Falkland Islands)", "Islas Malvinas"], true, false]),
  ],
  "Islas Malvinas",
  NOMBRE_ES,
];

function usaNombre(expression) {
  return Array.isArray(expression) && (
    (expression[0] === "get" && /^name(?::|_|$)/.test(expression[1])) ||
    expression.some(usaNombre)
  );
}

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
  return { ...style, layers: style.layers.map(layer => ({
    ...layer,
    ...(layer.filter ? { filter: filtrosConNumerosValidos(layer.filter) } : {}),
    ...(usaNombre(layer.layout?.["text-field"]) ? {
      layout: { ...layer.layout, "text-field": NOMBRE_LOCALIZADO },
    } : {}),
  })) };
}
