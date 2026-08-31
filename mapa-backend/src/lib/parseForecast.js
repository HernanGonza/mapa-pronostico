/**
 * Convierte una tabla cruda (array de filas -> array de celdas) en filas
 * de pronóstico. Asume: columna 0 = LOCALIDAD, 1 = TMIN, 2 = TMAX,
 * 3 = CONDICIÓN (mismo orden posicional que usaba result_table.iloc en
 * el notebook). Se descarta la primera fila (encabezado).
 */
function tableToRows(table) {
  return table.slice(1).map((cells) => ({
    LOCALIDAD: (cells[0] || "").trim(),
    TMIN: (cells[1] || "").trim(),
    TMAX: (cells[2] || "").trim(),
    CONDICION: (cells[3] || "").trim(),
  }));
}

/**
 * Equivalente a `forecast = pd.concat([table_north, table_center, table_south])`.
 * Toma las 3 primeras tablas encontradas en el .docx (norte, centro, sur).
 */
function buildForecastRows(tables) {
  const [north, center, south] = tables;
  return [
    ...tableToRows(north),
    ...tableToRows(center),
    ...tableToRows(south),
  ];
}

module.exports = { buildForecastRows, tableToRows };
