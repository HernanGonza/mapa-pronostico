/**
 * El .docx de Alerta Temprana, además de las 3 tablas del día actual
 * (ver parseForecast.js), trae más adelante dos secciones como texto
 * libre (no tablas) que hasta ahora se ignoraban por completo:
 *
 *   "PRONÓSTICO EXTENDIDO" — Sábado y Domingo (los 2 días siguientes al
 *   actual), un TMIN/TMAX/CONDICIÓN por ZONA (Sur/Centro/Norte) — no por
 *   localidad como la tabla de hoy.
 *
 *   "INFORMES DE PRONÓSTICO" — un párrafo narrativo por cada uno de los
 *   3 días (hoy, sábado, domingo): nubosidad, mm de lluvia esperados,
 *   viento, calidad del aire, temperaturas extremas de la provincia.
 *
 * Este módulo lee esas dos secciones a partir de los párrafos del .docx
 * (extractDocxParagraphs) para armar el pronóstico de 3 días por zona.
 */

const ZONAS = ["SUR", "CENTRO", "NORTE"];
const DIAS = ["LUNES", "MARTES", "MIÉRCOLES", "MIERCOLES", "JUEVES", "VIERNES", "SÁBADO", "SABADO", "DOMINGO"];

const limpiarTemperatura = (s) => (s || "").replace(/[°º]/g, "").trim();

const RE_ZONA = /^ZONA\s+(SUR|CENTRO|NORTE)\s*$/i;
// "SÁBADO 12 DE SEPTIEMBRE   12 °C  21 °C PARCIALMENTE NUBLADO"
const RE_DIA_ZONA = new RegExp(
  `^(${DIAS.join("|")})\\s+(\\d{1,2})\\s+DE\\s+([A-ZÁÉÍÓÚÑ]+)\\s+([\\d.,]+)\\s*°?\\s*C?\\s+([\\d.,]+)\\s*°?\\s*C?\\s+(.+)$`,
  "i"
);
// "Viernes 11 de septiembre" — encabezado de informe (nada más en la línea)
const RE_DIA_INFORME = new RegExp(`^(${DIAS.join("|")})\\s+(\\d{1,2})\\s+DE\\s+([A-ZÁÉÍÓÚÑ]+)\\s*$`, "i");

/** Filas {zona, dia, fecha, tmin, tmax, condicion} de "PRONÓSTICO EXTENDIDO". */
function parseExtendidoPorZona(parrafos) {
  const idxInicio = parrafos.findIndex((p) => /pron[oó]stico\s+extendido/i.test(p));
  if (idxInicio < 0) return [];
  const idxFin = parrafos.findIndex((p, i) => i > idxInicio && /informes?\s+de\s+pron[oó]stico/i.test(p));
  const bloque = parrafos.slice(idxInicio + 1, idxFin >= 0 ? idxFin : undefined);

  const filas = [];
  let zonaActual = null;
  for (const parrafo of bloque) {
    const zonaMatch = RE_ZONA.exec(parrafo.trim());
    if (zonaMatch) {
      zonaActual = zonaMatch[1].toUpperCase();
      continue;
    }
    const diaMatch = RE_DIA_ZONA.exec(parrafo.trim());
    if (diaMatch && zonaActual) {
      const [, dia, dd, mes, tmin, tmax, condicion] = diaMatch;
      filas.push({
        zona: zonaActual,
        dia: dia.toUpperCase().replace("SABADO", "SÁBADO").replace("MIERCOLES", "MIÉRCOLES"),
        fecha: `${dd} de ${mes.toLowerCase()}`,
        tmin: limpiarTemperatura(tmin),
        tmax: limpiarTemperatura(tmax),
        condicion: condicion.trim(),
      });
    }
  }
  return filas;
}

/** Informes narrativos {dia, fecha, texto} de "INFORMES DE PRONÓSTICO". */
function parseInformes(parrafos) {
  const idxInicio = parrafos.findIndex((p) => /informes?\s+de\s+pron[oó]stico/i.test(p));
  if (idxInicio < 0) return [];
  const bloque = parrafos.slice(idxInicio + 1);

  const informes = [];
  let actual = null;
  for (const parrafo of bloque) {
    if (/^FUENTE\s*:/i.test(parrafo.trim())) break;
    const diaMatch = RE_DIA_INFORME.exec(parrafo.trim());
    if (diaMatch) {
      const [, dia, dd, mes] = diaMatch;
      actual = { dia: dia[0].toUpperCase() + dia.slice(1).toLowerCase(), fecha: `${dd} de ${mes.toLowerCase()}`, texto: "" };
      informes.push(actual);
      continue;
    }
    if (actual) actual.texto = actual.texto ? `${actual.texto} ${parrafo.trim()}` : parrafo.trim();
  }
  return informes.map((i) => ({ ...i, texto: i.texto.trim() }));
}

/**
 * Resumen por zona del día actual, agregado a partir de las filas ya
 * parseadas de la tabla (una por localidad) — para que "hoy" tenga la
 * misma forma {tmin,tmax,condicion} que sábado/domingo. `tablaZona` es
 * el array de filas (tableToRows) de esa zona, en el mismo orden
 * norte/centro/sur que ya usa buildForecastRows.
 */
function resumenDeZona(filas) {
  if (!filas.length) return null;
  const tmins = filas.map((f) => Number(f.TMIN)).filter(Number.isFinite);
  const tmaxs = filas.map((f) => Number(f.TMAX)).filter(Number.isFinite);
  const conteo = new Map();
  for (const f of filas) conteo.set(f.CONDICION, (conteo.get(f.CONDICION) || 0) + 1);
  const condicion = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || filas[0].CONDICION;
  return {
    tmin: tmins.length ? String(Math.min(...tmins)) : "",
    tmax: tmaxs.length ? String(Math.max(...tmaxs)) : "",
    condicion,
  };
}

/**
 * Arma el pronóstico de 3 días por zona: hoy (agregado de la tabla) +
 * sábado/domingo (de "PRONÓSTICO EXTENDIDO"), más los informes
 * narrativos. `tablas` son las 3 tablas crudas ya extraídas
 * (extractDocxTables) en el orden norte/centro/sur que usa
 * buildForecastRows; `parrafos`, de extractDocxParagraphs.
 */
function buildExtendedForecast(tablas, parrafos) {
  const { tableToRows } = require("./parseForecast");
  const [tablaNorte, tablaCentro, tablaSur] = tablas;
  const hoyPorZona = {
    NORTE: resumenDeZona(tableToRows(tablaNorte || [])),
    CENTRO: resumenDeZona(tableToRows(tablaCentro || [])),
    SUR: resumenDeZona(tableToRows(tablaSur || [])),
  };
  const filasExtendido = parseExtendidoPorZona(parrafos);
  const informes = parseInformes(parrafos);

  const zonas = ZONAS.map((zona) => {
    const dias = [];
    if (hoyPorZona[zona]) dias.push({ etiqueta: "Hoy", fecha: null, ...hoyPorZona[zona] });
    for (const fila of filasExtendido.filter((f) => f.zona === zona)) {
      dias.push({ etiqueta: fila.dia[0] + fila.dia.slice(1).toLowerCase(), fecha: fila.fecha, tmin: fila.tmin, tmax: fila.tmax, condicion: fila.condicion });
    }
    return { zona: zona[0] + zona.slice(1).toLowerCase(), dias };
  });

  return { zonas, informes };
}

function hayExtendido(extendido) {
  return !!extendido && Array.isArray(extendido.zonas) && extendido.zonas.some((z) => z.dias.length > 1);
}

module.exports = { buildExtendedForecast, parseExtendidoPorZona, parseInformes, hayExtendido };
