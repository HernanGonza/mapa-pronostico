const { parseCsv } = require("./csv");
const registros = require("./registrosClimaticosStore");

/**
 * Importador flexible de datos climáticos históricos: como las planillas
 * que ya existen no son homogéneas (distintas fuentes, distintos
 * nombres de columna), el operador mapea a mano qué columna de SU
 * archivo corresponde a cada campo esperado — acá solo se valida y se
 * normaliza antes de guardar. `mapeo` = { fecha, estacion, tmin, tmax,
 * precipitacion? } con el nombre de columna tal cual viene en el CSV.
 */

const MAX_FILAS = 20000;

function normalizarFecha(valor) {
  if (!valor) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  if (iso) return valor.trim();
  const conBarras = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(valor.trim());
  if (conBarras) {
    const [, d, m, y] = conBarras;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

function normalizarNumero(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(String(valor).replace(",", "."));
  return Number.isFinite(n) ? n : undefined; // undefined = valor presente pero inválido
}

/** Devuelve las columnas detectadas en el CSV, para que el frontend arme
 * el formulario de mapeo (sin adivinar nombres de campo a ciegas). */
function detectarColumnas(texto) {
  const filas = parseCsv(texto);
  return { columnas: filas.length ? Object.keys(filas[0]) : [], filas: filas.length };
}

/** Aplica el mapeo, valida cada fila y delega el guardado en
 * `registrosClimaticosStore.upsertUno`. Devuelve un resumen para mostrar
 * en el panel (no interrumpe la importación por filas sueltas con error). */
async function importar(texto, mapeo) {
  const { fecha: colFecha, estacion: colEstacion, tmin: colTmin, tmax: colTmax, precipitacion: colPrecipitacion } = mapeo || {};
  if (!colFecha || !colEstacion) {
    throw Object.assign(new Error("Falta indicar qué columna es la fecha y cuál la estación."), { status: 400 });
  }
  const filas = parseCsv(texto);
  if (!filas.length) throw Object.assign(new Error("El archivo no tiene filas."), { status: 400 });
  if (filas.length > MAX_FILAS) throw Object.assign(new Error(`El archivo supera el máximo de ${MAX_FILAS} filas.`), { status: 400 });

  let importadas = 0;
  const errores = [];
  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];
    const estacion = (fila[colEstacion] || "").trim();
    const fecha = normalizarFecha(fila[colFecha]);
    const tmin = colTmin ? normalizarNumero(fila[colTmin]) : null;
    const tmax = colTmax ? normalizarNumero(fila[colTmax]) : null;
    const precipitacion = colPrecipitacion ? normalizarNumero(fila[colPrecipitacion]) : null;
    if (!estacion) { errores.push({ fila: i + 2, motivo: "Falta la estación." }); continue; }
    if (!fecha) { errores.push({ fila: i + 2, motivo: `Fecha inválida: "${fila[colFecha]}"` }); continue; }
    if (tmin === undefined || tmax === undefined || precipitacion === undefined) {
      errores.push({ fila: i + 2, motivo: "Valor numérico inválido." });
      continue;
    }
    try {
      await registros.upsertUno({ estacion, fecha, tmin, tmax, precipitacion, fuente: "import_csv" });
      importadas++;
    } catch (e) {
      errores.push({ fila: i + 2, motivo: e.message });
    }
  }
  return { totalFilas: filas.length, importadas, errores: errores.slice(0, 50), erroresTotales: errores.length };
}

module.exports = { detectarColumnas, importar, normalizarFecha, normalizarNumero };
