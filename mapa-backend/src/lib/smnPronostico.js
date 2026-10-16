/**
 * Pronóstico del SMN (datos abiertos, «Pronóstico a 5 días»: https://ssl.smn.gob.ar/dpd/zipopendata.php?dato=pron5d). Es un zip con un texto de ancho fijo
 * donde cada estación del SMN tiene una salida cada 3 horas, hora de Misiones, hasta unos 5 días: temperatura (°C), viento (dirección ° | km/h) y lluvia (mm).
 * El propio archivo avisa que es la salida de un modelo numérico y «puede diferir del pronóstico emitido por el SMN» (el que escribe el pronosticador).
 * En Misiones trae 4 estaciones: Posadas, Oberá, Iguazú y Bernardo de Irigoyen.
 *
 * Se lleva a series horarias con la forma de Open-Meteo, un punto por punto del ensamble (ver asignarEstaciones.js: sólo los departamentos que contienen
 * una de esas estaciones y las ciudades a menos de 25 km tienen dato; el resto queda en blanco):
 *  - temperatura: interpolada hora a hora entre las salidas de 3 h;
 *  - viento: se interpolan las componentes (no la velocidad ni la dirección) y de ahí salen la velocidad y la dirección;
 *  - lluvia: se supone el acumulado de las 3 h que TERMINAN en la hora indicada y se reparte parejo (el archivo no lo aclara).
 */
const zlib = require("zlib");
const { asignar } = require("./asignarEstaciones");
const S = require("./serieHoraria");

const URL = "https://ssl.smn.gob.ar/dpd/zipopendata.php?dato=pron5d";
const HORA = 3600e3;
const MESES = { ENE: 0, FEB: 1, MAR: 2, ABR: 3, MAY: 4, JUN: 5, JUL: 6, AGO: 7, SEP: 8, OCT: 9, NOV: 10, DIC: 11 };
// Estaciones de Misiones tal cual figuran en el archivo.
const ESTACIONES = {
  POSADAS_AERO: { nombre: "Posadas Aero", lat: -27.39, lng: -55.97 },
  OBERA_AERO: { nombre: "Oberá", lat: -27.48, lng: -55.13 },
  IGUAZU_AERO: { nombre: "Iguazú Aero", lat: -25.73, lng: -54.47 },
  BERNARDO_DE_IRIGOYEN_AERO: { nombre: "Bernardo de Irigoyen Aero", lat: -26.25, lng: -53.65 },
};

/** Primer archivo de un zip (el SMN manda uno solo), sin dependencias: lee el encabezado local y descomprime con zlib. */
function descomprimirZip(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("El SMN no mandó un zip.");
  const metodo = buf.readUInt16LE(8), largoComp = buf.readUInt32LE(18), nombre = buf.readUInt16LE(26), extra = buf.readUInt16LE(28), ini = 30 + nombre + extra;
  let comprimido = buf.subarray(ini, largoComp ? ini + largoComp : undefined);
  if (!largoComp) { // tamaño en el descriptor posterior: se descomprime hasta donde el flujo termina
    return zlib.inflateRawSync(buf.subarray(ini), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  }
  if (metodo === 0) return comprimido;
  if (metodo !== 8) throw new Error(`Zip: método de compresión ${metodo} no soportado.`);
  return zlib.inflateRawSync(comprimido);
}

/** El texto del archivo → { NOMBRE: [{ ms, temp, dir, viento, lluvia }] } de las estaciones de ESTACIONES (ms = instante UTC real de la hora de Misiones). */
function parsear(texto) {
  const lineas = texto.split(/\r?\n/), salida = {};
  let actual = null;
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i], t = l.trim();
    if (/^[A-Z0-9_]+$/.test(t) && /^\s*=+/.test(lineas[i + 1] || "")) { actual = ESTACIONES[t] ? t : null; if (actual) salida[actual] = []; continue; }
    if (!actual) continue;
    const m = /^\s*(\d{2})\/([A-Z]{3})\/(\d{4})\s+(\d{1,2})Hs\.\s+(-?[\d.]+)\s+(\d+)\s*\|\s*(\d+)\s+(-?[\d.]+)/.exec(l);
    if (!m || MESES[m[2]] == null) continue;
    salida[actual].push({ ms: Date.UTC(+m[3], MESES[m[2]], +m[1], +m[4] + 3), temp: +m[5], dir: +m[6], viento: +m[7], lluvia: Math.max(0, +m[8]) });
  }
  return salida;
}

/** Baja el pronóstico y lo lleva a la forma que guarda el ensamble. → { datos, corrida: ISO (fecha del archivo, 00 h de Misiones), avisos } */
async function bajarPronosticoSmn(puntos, ahora = Date.now()) {
  const r = await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error(`SMN: HTTP ${r.status} al bajar el pronóstico.`);
  const texto = descomprimirZip(Buffer.from(await r.arrayBuffer())).toString("utf8");
  const porEstacion = parsear(texto), nombres = Object.keys(ESTACIONES).filter((n) => porEstacion[n]?.length);
  if (!nombres.length) throw new Error("El archivo del SMN no trae ninguna de las estaciones de Misiones.");
  const { horas, ms } = S.horasDelRango(ahora), lista = nombres.map((n) => ESTACIONES[n]);
  const series = nombres.map((n) => {
    const f = porEstacion[n], comp = (g) => (x) => (x.viento == null ? null : g(x));
    const u = S.interpolar(f.map((x) => ({ ms: x.ms, v: -x.viento / 3.6 * Math.sin(x.dir * Math.PI / 180) })), ms, 4);
    const v = S.interpolar(f.map((x) => ({ ms: x.ms, v: -x.viento / 3.6 * Math.cos(x.dir * Math.PI / 180) })), ms, 4);
    return {
      temperature_2m: S.interpolar(f.map((x) => ({ ms: x.ms, v: x.temp })), ms, 4).map((x) => S.redondear(x, 1)),
      wind_speed_10m: u.map((x, i) => S.redondear(S.velocidadKmh(x, v[i]), 1)),
      wind_direction_10m: u.map((x, i) => S.redondear(S.direccionViento(x, v[i]), 0)),
      precipitation: S.repartirAcumulado(f.map((x) => ({ ms: x.ms, mm: x.lluvia, horas: 3 })), ms).map((x) => S.redondear(x, 2)),
    };
  });
  const asignadas = asignar(puntos, lista);
  const datos = { horas, puntos: puntos.map((_, k) => (asignadas[k].length ? { hourly: series[asignadas[k][0]], estaciones: asignadas[k].map((i) => lista[i].nombre) } : { hourly: {} })) };
  const primera = Math.min(...nombres.map((n) => porEstacion[n][0].ms));
  return { datos, corrida: new Date(primera).toISOString(), avisos: [] };
}

module.exports = { bajarPronosticoSmn, parsear, descomprimirZip, ESTACIONES };
