/**
 * Datos abiertos del SMN (https://www.smn.gob.ar/descarga-de-datos) para las estaciones de
 * Misiones y alrededores. Son dos conjuntos:
 *  - «Datos meteorológicos horarios»: TEMP, HUM, PNM, DD, FF de cada hora (hora oficial argentina).
 *    Archivo `observaciones/datohorarioAAAAMMDD.txt`; hay historia desde 2018.
 *  - «Observaciones diarias de temperaturas extremas»: TMAX y TMIN oficiales del día.
 *    Archivo `observaciones/obsAAAAMMDD.txt`; el SMN guarda sólo alrededor de un año.
 * Los dos son texto de ancho fijo en latin1, con columnas vacías cuando no hay dato (y los del zip
 * tienen un espacio adelante que los del histórico no: las columnas se cuentan desde la fecha). El SMN los
 * publica al día siguiente. `descarga_opendata.php` no pasa por el desafío de Cloudflare de
 * www.smn.gob.ar (no hay que saltear nada). No traen lluvia.
 */
const URL_DESCARGA = "https://ssl.smn.gob.ar/dpd/descarga_opendata.php";
const TIMEOUT_MS = 25000;

// Nombre tal cual en los archivos del SMN → datos de la estación.
const ESTACIONES = {
  "POSADAS AERO": { clave: "posadas", nombre: "Posadas Aero", lat: -27.39, lng: -55.97 },
  "OBERA": { clave: "obera", nombre: "Oberá", lat: -27.48, lng: -55.13 },
  "IGUAZU AERO": { clave: "iguazu", nombre: "Iguazú Aero", lat: -25.73, lng: -54.47 },
  "BERNARDO DE IRIGOYEN AERO": { clave: "irigoyen", nombre: "Bernardo de Irigoyen Aero", lat: -26.25, lng: -53.65 },
  "ITUZAINGO": { clave: "ituzaingo", nombre: "Ituzaingó (Corrientes)", lat: -27.59, lng: -56.69 },
};

const compacta = (fecha) => fecha.replaceAll("-", ""); // "2026-10-03" → "20261003"
const num = (s) => (s === "" ? null : Number(s.replace(",", ".")));
// Columnas contadas desde el primer dígito de la fecha (posiciones del ancho fijo del SMN).
const col = (linea, a, b) => { const i = linea.search(/\d/); return linea.slice(i + a, b == null ? undefined : i + b).trim(); };

async function bajar(archivo) {
  const r = await fetch(`${URL_DESCARGA}?file=${encodeURIComponent(archivo).replace("%2F", "/")}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const texto = new TextDecoder("latin1").decode(await r.arrayBuffer());
  if (/El archivo no existe/i.test(texto.slice(0, 300))) return null;
  return texto;
}

const filas = (texto) => texto.split(/\r?\n/).filter((l) => /^\s*\d{8}\b/.test(l));

/** Archivo horario → [{ fecha:"AAAA-MM-DD", hora, temp, hum, pnm, dd, ff, estacion }]. */
function parsearHorario(texto) {
  return filas(texto).map((l) => {
    const f = col(l, 0, 8);
    return {
      fecha: `${f.slice(4)}-${f.slice(2, 4)}-${f.slice(0, 2)}`, hora: num(col(l, 8, 14)),
      temp: num(col(l, 14, 20)), hum: num(col(l, 20, 25)), pnm: num(col(l, 25, 33)), dd: num(col(l, 33, 38)), ff: num(col(l, 38, 43)),
      estacion: col(l, 43),
    };
  }).filter((r) => r.hora != null && r.estacion);
}

/** Archivo de extremas → [{ fecha, tmax, tmin, estacion }]. */
function parsearExtremas(texto) {
  return filas(texto).map((l) => {
    const f = col(l, 0, 8);
    return { fecha: `${f.slice(4)}-${f.slice(2, 4)}-${f.slice(0, 2)}`, tmax: num(col(l, 8, 14)), tmin: num(col(l, 14, 20)), estacion: col(l, 20) };
  }).filter((r) => r.estacion);
}

/**
 * Las dos cosas de un día para las estaciones de ESTACIONES: { horario: {NOMBRE: [filas]},
 * extremas: {NOMBRE: fila}, faltan: [...] } (faltan = archivos que el SMN todavía no publicó o ya borró).
 */
async function delDia(fecha) {
  const [horario, extremas] = await Promise.all([
    bajar(`observaciones/datohorario${compacta(fecha)}.txt`),
    bajar(`observaciones/obs${compacta(fecha)}.txt`),
  ]);
  const porEstacion = (lista) => lista.reduce((m, r) => (ESTACIONES[r.estacion] ? ((m[r.estacion] ||= []).push(r), m) : m), {});
  const h = horario ? porEstacion(parsearHorario(horario).filter((r) => r.fecha === fecha)) : {};
  const x = extremas ? Object.fromEntries(Object.entries(porEstacion(parsearExtremas(extremas).filter((r) => r.fecha === fecha))).map(([k, v]) => [k, v[0]])) : {};
  return { horario: h, extremas: x, faltan: [!horario && "horario", !extremas && "extremas"].filter(Boolean) };
}

module.exports = { ESTACIONES, delDia, parsearHorario, parsearExtremas, URL_DESCARGA };
