/**
 * Lector del informe «PREVISIÓN DEL TIEMPO PARA LA PROVINCIA DE MISIONES» (formato final de la DGAT, ver
 * informePronostico.js), para cargarlo en el mapa de pronóstico igual que el .docx de siempre. Traduce lo que el mapa
 * ya consume:
 *   - `filas`: una por cada una de las 13 ciudades de la tabla «PRINCIPALES CIUDADES» (son las mismas 13 localidades
 *     del mapa): { LOCALIDAD, TMIN, TMAX, CONDICION, ZONA }.
 *   - `extendido`: el pronóstico de 3 días por zona — «Hoy» sale de la tabla de zonas y los días siguientes de
 *     «PREVISIÓN EXTENDIDA» — más los textos de los dos días (`informes`).
 * El resto del informe (humedad, viento, sensación térmica y alertas) todavía no tiene lugar en el mapa.
 */
const { normalize } = require("./normalizeText");
const { condicionCanonica } = require("./condiciones");

const ZONA_DE_CIUDAD = {
  "PUERTO IGUAZU": "Norte", "BDO. DE IRIGOYEN": "Norte", "ELDORADO": "Norte", "SAN PEDRO": "Norte", "MONTECARLO": "Norte",
  "JARDIN AMERICA": "Centro", "SAN VICENTE": "Centro", "A. DEL VALLE": "Centro", "OBERA": "Centro",
  "POSADAS": "Sur", "L. N. ALEM": "Sur", "APOSTOLES": "Sur", "SAN JAVIER": "Sur",
};
const ZONAS = ["Sur", "Centro", "Norte"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const RE_ENCABEZADO_DIA = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s*$/i;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const limpio = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
/** «12º C» → «12». Vacío si no hay número. */
const numero = (s) => { const m = /-?\d+(?:[.,]\d+)?/.exec(String(s ?? "")); return m ? String(Math.round(Number(m[0].replace(",", ".")))) : ""; };
const condicion = (s) => { const t = limpio(s); return condicionCanonica(t) || t; };

/** ¿Es el informe nuevo? Lo delata la tabla «PRINCIPALES CIUDADES» (el .docx de siempre trae sólo tablas de localidades). */
const esInformeNuevo = (tablas) => tablas.some((t) => /PRINCIPALES\s+CIUDADES/i.test(t?.[0]?.[0] || ""));
const tablaQue = (tablas, re) => tablas.find((t) => re.test(t?.[0]?.[0] || ""));

function fechaDMA(dma) { // «15/10/2026» → { iso, etiqueta: "Jueves", fecha: "15 de octubre" }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(limpio(dma));
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])], f = new Date(Date.UTC(a, mes - 1, d, 12));
  return { iso: `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`, etiqueta: cap(DIAS_SEMANA[f.getUTCDay()]), fecha: `${d} de ${MESES[mes - 1]}` };
}

/** Resumen de una zona a partir de las filas de sus ciudades (si la tabla de zonas viene vacía). */
function resumenDeCiudades(filas) {
  const t = filas.map((f) => Number(f.TMIN)).filter(Number.isFinite), x = filas.map((f) => Number(f.TMAX)).filter(Number.isFinite);
  const cuenta = new Map(); for (const f of filas) if (f.CONDICION) cuenta.set(f.CONDICION, (cuenta.get(f.CONDICION) || 0) + 1);
  return { tmin: t.length ? String(Math.min(...t)) : "", tmax: x.length ? String(Math.max(...x)) : "", condicion: [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "" };
}

/**
 * @param tablas   extractDocxTables(): tabla → fila → celda (texto)
 * @param parrafos extractDocxParagraphs(): todos los párrafos, incluidos los de las celdas
 * @returns { filas, extendido: { zonas, informes }, fechaSugerida, emision }
 */
function parseInformeNuevo(tablas, parrafos) {
  // Ciudades → filas del mapa
  const tCiudades = tablaQue(tablas, /PRINCIPALES\s+CIUDADES/i) || [];
  const filas = tCiudades.slice(2).map((r) => ({ nombre: limpio(r[0]).toUpperCase(), r })).filter((x) => x.nombre).map(({ nombre, r }) => ({
    LOCALIDAD: nombre, TMIN: numero(r[1]), TMAX: numero(r[2]), CONDICION: condicion(r[3]), ZONA: ZONA_DE_CIUDAD[normalize(nombre)] || null,
  }));

  // «Hoy» de cada zona (tabla de zonas: ZONA | mín | máx | sens. | humedad | vientos | estado | alerta)
  const hoy = {};
  for (const r of (tablaQue(tablas, /POR\s+ZONAS/i) || []).slice(2)) {
    const z = ZONAS.find((n) => normalize(n) === normalize(limpio(r[0])));
    if (z) hoy[z] = { tmin: numero(r[1]), tmax: numero(r[2]), condicion: condicion(r[6]) };
  }

  // Extendido: una sola tabla con un bloque «ZONA X» por zona y una fila por día (fecha | mín | máx | estado | alerta)
  const extendidoPorZona = Object.fromEntries(ZONAS.map((z) => [z, []]));
  const tExt = tablas.find((t) => /^ZONA\s+(SUR|CENTRO|NORTE)\b/i.test(t?.[0]?.[0] || "")) || [];
  let zonaActual = null;
  for (const r of tExt) {
    const z = /^ZONA\s+(SUR|CENTRO|NORTE)\b/i.exec(limpio(r[0]));
    if (z) { zonaActual = ZONAS.find((n) => normalize(n) === normalize(z[1])); continue; }
    const f = fechaDMA(r[0]);
    if (f && zonaActual) extendidoPorZona[zonaActual].push({ etiqueta: f.etiqueta, fecha: f.fecha, tmin: numero(r[1]), tmax: numero(r[2]), condicion: condicion(r[3]) });
  }

  const zonas = ZONAS.map((zona) => {
    const propia = filas.filter((f) => f.ZONA === zona);
    const h = hoy[zona] && (hoy[zona].tmin || hoy[zona].tmax) ? hoy[zona] : resumenDeCiudades(propia);
    return { zona, dias: [{ etiqueta: "Hoy", fecha: null, ...h }, ...extendidoPorZona[zona]] };
  });

  // Textos de los dos días: «Martes 13 de Octubre» + lo que sigue, hasta la primera tabla
  const informes = [];
  const fin = parrafos.findIndex((p) => /^PREVISI[ÓO]N\s+PARA\s+LA\s+PROVINCIA/i.test(limpio(p)));
  let actual = null;
  for (const p of fin >= 0 ? parrafos.slice(0, fin) : parrafos) {
    const t = limpio(p), m = RE_ENCABEZADO_DIA.exec(t);
    if (m) { actual = { dia: cap(m[1].toLowerCase()), fecha: `${Number(m[2])} de ${m[3].toLowerCase()}`, texto: "" }; informes.push(actual); continue; }
    if (actual && t) actual.texto = actual.texto ? `${actual.texto} ${t}` : t;
  }

  // Fecha sugerida: el primer día con texto (el año sale de la emisión)
  const emision = /EMISI[ÓO]N\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(parrafos.map(limpio).find((p) => /^EMISI[ÓO]N/i.test(p)) || "")?.[1] || null;
  const anio = emision ? emision.split("/")[2] : String(new Date().getFullYear());
  const primero = informes[0] && /^(\d{1,2}) de (\S+)$/.exec(informes[0].fecha), mes = primero ? MESES.indexOf(primero[2]) : -1;
  const fechaSugerida = mes >= 0 ? `${anio}-${String(mes + 1).padStart(2, "0")}-${String(primero[1]).padStart(2, "0")}` : null;

  return { filas, extendido: { zonas, informes }, fechaSugerida, emision: emision ? fechaDMA(emision)?.iso : null };
}

module.exports = { esInformeNuevo, parseInformeNuevo, ZONA_DE_CIUDAD };
