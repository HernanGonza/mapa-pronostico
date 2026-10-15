/** Diferencias entre lo editado y lo último publicado, por localidad. */
export function calcularCambios(editadas, publicadas) {
  if (!publicadas) return null;
  const prev = new Map(publicadas.map((r) => [r.LOCALIDAD, r]));
  const cambios = [];
  for (const row of editadas) {
    const antes = prev.get(row.LOCALIDAD);
    if (!antes) {
      cambios.push({ localidad: row.LOCALIDAD, campo: "nueva", de: "—", a: "fila nueva" });
      continue;
    }
    for (const campo of ["TMIN", "TMAX", "CONDICION", "ZONA"]) {
      if (String(antes[campo] ?? "").trim() !== String(row[campo] ?? "").trim()) {
        cambios.push({
          localidad: row.LOCALIDAD,
          campo,
          de: String(antes[campo] ?? "—"),
          a: String(row[campo] ?? "—"),
        });
      }
    }
  }
  const actuales = new Set(editadas.map(row => row.LOCALIDAD));
  for (const row of publicadas) {
    if (!actuales.has(row.LOCALIDAD)) {
      cambios.push({ localidad: row.LOCALIDAD, campo: "localidad", de: "incluida", a: "quitada del pronóstico" });
    }
  }
  return cambios;
}
