/**
 * Lo OBSERVADO en las estaciones automáticas, para compararlo con lo que dicen los modelos del ensamble:
 *  - «Estaciones»: INTA (SIGA, 7 estaciones, cada 10 min) y SiNaRaMe (INA vía SNIH, 4 estaciones, cada 10 min). Dan temperatura, humedad y lluvia; el viento
 *    sólo en SiNaRaMe y la ráfaga sólo en algunas del INTA.
 *  - «SMN»: las 4 estaciones del SMN en Misiones, de sus datos abiertos horarios (temperatura, humedad y viento medio; sin lluvia ni ráfaga). El SMN los sube
 *    al día siguiente, así que lo de hoy todavía no está.
 * Todo se lleva a series HORARIAS de Misiones con la forma de Open-Meteo (`{ horas, puntos: [{ hourly }] }`), un punto por cada punto del ensamble:
 * el promedio de las estaciones que le corresponden (ver asignarEstaciones.js). Una hora sin lectura queda en null; no se rellena.
 */
const { ESTACIONES: INTA } = require("./sigaInta");
const { ESTACIONES: SINARAME, CODIGOS: CODIGOS_SNIH } = require("./sinarame");
const smn = require("./smnDatosAbiertos");
const { asignar } = require("./asignarEstaciones");
const S = require("./serieHoraria");

const INTA_URL = "https://siga.inta.gob.ar/CdnaUV0iiERRpFQE.php";
const SNIH_URL = "https://snih.hidricosargentina.gob.ar";
const TIMEOUT_MS = 30000, HORA = 3600e3, OFFSET_MS = 3 * HORA;

// Datos fuera de lo físicamente plausible = sensor roto (mismo criterio que sigaInta.js y sinarame.js).
const plausible = {
  temp: (v) => typeof v === "number" && v > -10 && v < 50,
  hum: (v) => typeof v === "number" && v >= 1 && v <= 100,
  viento: (v) => typeof v === "number" && v >= 0 && v < 200,
  lluvia: (v) => typeof v === "number" && v >= 0 && v < 200,
};
const limpio = (v, tipo) => (plausible[tipo](v) ? v : null);

async function pedirJson(url, opciones = {}) {
  const r = await fetch(url, { ...opciones, headers: { "User-Agent": "Mozilla/5.0", ...(opciones.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const texto = await r.text();
  return texto.trim() ? JSON.parse(texto) : null;
}
const ddmmaaaa = (f) => f.split("-").reverse().join("-");

/**
 * Lecturas de 10 min de una estación INTA entre dos días ("AAAA-MM-DD", inclusive), en UN pedido. OJO: la hora viene marcada «Z[UTC]» pero es HORA LOCAL
 * (verificado: la lectura más nueva coincide con la hora de Misiones): se le suma el desfase para tener el instante UTC real.
 * La lluvia (`precDiaCrono`) es la de cada intervalo, no un acumulado.
 */
async function lecturasInta(est, desde, hasta) {
  const url = `${INTA_URL}?param_type=datosestaciones&param_value=${est.id}/${ddmmaaaa(desde)}%2000:00:00/${ddmmaaaa(hasta)}%2023:59:59`;
  return ((await pedirJson(url)) || []).map((f) => ({
    ms: Date.parse(String(f.fechaHora).slice(0, 19) + "Z") + OFFSET_MS,
    temp: limpio(f.tempAbrigo150, "temp"), hum: limpio(f.humedad ?? f.HMedia, "hum"), lluvia: limpio(f.precDiaCrono, "lluvia"), rafaga: limpio(f.velVientoMax, "viento"),
  })).filter((r) => Number.isFinite(r.ms)).sort((a, b) => a.ms - b.ms);
}

/** Lecturas de 10 min de una estación SiNaRaMe desde un día hasta lo último que tiene (una variable por pedido; la fecha viene en ms UTC reales). */
async function lecturasSinarame(est, desde) {
  const variable = async (codigo) => {
    const d = await pedirJson(`${SNIH_URL}/MuestraDatos.aspx/LeerUltimosRegistros`, {
      method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ fechaDesde: desde, fechaHasta: desde, estacion: est.id, codigo: String(codigo) }),
    });
    return new Map((d?.d?.Mediciones || []).map((m) => [Number(/\d+/.exec(m.FechaHora)?.[0]), m.Mediciones?.[0]?.Valor]));
  };
  const [temp, hum, viento, lluvia] = await Promise.all(["temperatura", "humedad", "viento", "precipitacion"].map((k) => variable(CODIGOS_SNIH[k]).catch(() => new Map())));
  const tiempos = [...new Set([...temp.keys(), ...hum.keys(), ...viento.keys(), ...lluvia.keys()])].filter(Number.isFinite).sort((a, b) => a - b);
  return tiempos.map((ms) => ({ ms, temp: limpio(temp.get(ms), "temp"), hum: limpio(hum.get(ms), "hum"), viento: limpio(viento.get(ms), "viento"), lluvia: limpio(lluvia.get(ms), "lluvia") }));
}

/** Lecturas horarias de las estaciones del SMN en los días dados → Map(nombre en el archivo → lecturas). Un día que el SMN todavía no publicó se salta. */
async function lecturasSmn(dias) {
  const porEstacion = new Map();
  for (const dia of dias) {
    let d; try { d = await smn.delDia(dia); } catch { continue; }
    for (const [nombre, filas] of Object.entries(d.horario)) {
      const lista = porEstacion.get(nombre) || [];
      for (const f of filas) lista.push({ ms: Date.parse(`${dia}T${String(f.hora).padStart(2, "0")}:00:00-03:00`), temp: limpio(f.temp, "temp"), hum: limpio(f.hum, "hum"), viento: limpio(f.ff, "viento") });
      porEstacion.set(nombre, lista);
    }
  }
  for (const l of porEstacion.values()) l.sort((a, b) => a.ms - b.ms);
  return porEstacion;
}

/**
 * Lecturas (cualquier paso) → series horarias alineadas con `horasMs`. Lo instantáneo (temperatura, humedad, viento) es el promedio de las lecturas
 * a ±30 min de la hora; la ráfaga, el máximo de esas lecturas; la lluvia, la suma de las lecturas de la hora que TERMINA en t (convención de Open-Meteo),
 * y sólo existe si hubo al menos una lectura (no se inventan ceros).
 */
function horaria(lecturas, horasMs) {
  const n = horasMs.length, h0 = horasMs[0];
  const cols = { temp: Array.from({ length: n }, () => []), hum: Array.from({ length: n }, () => []), viento: Array.from({ length: n }, () => []), rafaga: Array.from({ length: n }, () => []), lluvia: Array.from({ length: n }, () => []) };
  for (const l of lecturas) {
    const i = Math.round((l.ms - h0) / HORA), j = Math.ceil((l.ms - h0) / HORA);
    if (i >= 0 && i < n) for (const k of ["temp", "hum", "viento", "rafaga"]) if (l[k] != null) cols[k][i].push(l[k]);
    if (j >= 0 && j < n && l.lluvia != null) cols.lluvia[j].push(l.lluvia);
  }
  const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { temp: cols.temp.map(media), hum: cols.hum.map(media), viento: cols.viento.map(media), rafaga: cols.rafaga.map((a) => (a.length ? Math.max(...a) : null)), lluvia: cols.lluvia.map((a) => (a.length ? a.reduce((x, y) => x + y, 0) : null)) };
}

/** Promedio (o máximo / suma) de las series horarias de varias estaciones, hora a hora, ignorando las que no tienen lectura esa hora. */
function juntar(series, campo, como = "media") {
  const n = series[0][campo].length;
  return Array.from({ length: n }, (_, i) => {
    const v = series.map((s) => s[campo][i]).filter((x) => x != null);
    if (!v.length) return null;
    return como === "max" ? Math.max(...v) : v.reduce((a, b) => a + b, 0) / v.length;
  });
}

/** Las series por estación → la forma que guarda el ensamble (un punto por punto del ensamble). */
function aPuntos(puntos, estaciones, series, horas) {
  const asignadas = asignar(puntos, estaciones);
  return {
    horas,
    puntos: puntos.map((_, k) => {
      const ss = asignadas[k].map((i) => series[i]);
      if (!ss.length) return { hourly: {} };
      const temp = juntar(ss, "temp"), hum = juntar(ss, "hum");
      return { hourly: {
        temperature_2m: temp.map((x) => S.redondear(x, 1)),
        relative_humidity_2m: hum.map((x) => S.redondear(x, 0)),
        dew_point_2m: temp.map((x, i) => S.redondear(S.puntoDeRocio(x, hum[i]), 1)),
        wind_speed_10m: juntar(ss, "viento").map((x) => S.redondear(x, 1)),
        wind_gusts_10m: juntar(ss, "rafaga", "max").map((x) => S.redondear(x, 1)),
        precipitation: juntar(ss, "lluvia").map((x) => S.redondear(x, 1)),
      }, estaciones: asignadas[k].map((i) => estaciones[i].nombre) };
    }),
  };
}

const fechaART = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: S.ART }).format(new Date(ms));

/** «Estaciones»: INTA + SiNaRaMe. Las que fallan se anotan en `avisos` (las demás siguen). */
async function bajarEstaciones(puntos, ahora = Date.now()) {
  const { horas, ms } = S.horasDelRango(ahora), desde = fechaART(ms[0]), hasta = fechaART(ahora), avisos = [];
  const lista = [...Object.values(INTA).map((e) => ({ ...e, red: "INTA" })), ...Object.values(SINARAME).map((e) => ({ ...e, red: "SiNaRaMe" }))];
  const series = await Promise.all(lista.map(async (e) => {
    try { return horaria(e.red === "INTA" ? await lecturasInta(e, desde, hasta) : await lecturasSinarame(e, desde), ms); }
    catch (err) { avisos.push(`${e.nombre}: ${err.message}`); return horaria([], ms); }
  }));
  if (!series.some((s) => s.temp.some((x) => x != null))) throw new Error(`Ninguna estación respondió${avisos.length ? ` (${avisos[0]})` : ""}.`);
  return { datos: aPuntos(puntos, lista, series, horas), avisos };
}

/** «SMN»: las estaciones del SMN, de sus datos horarios abiertos (se publican al día siguiente). */
async function bajarSmn(puntos, ahora = Date.now()) {
  const { horas, ms } = S.horasDelRango(ahora), dias = [];
  for (let t = ms[0]; t <= ahora; t += 24 * HORA) { const d = fechaART(t); if (!dias.includes(d)) dias.push(d); }
  const porNombre = await lecturasSmn(dias), nombres = Object.keys(smn.ESTACIONES);
  const lista = nombres.map((n) => ({ ...smn.ESTACIONES[n], nombre: smn.ESTACIONES[n].nombre }));
  if (![...porNombre.values()].some((l) => l.length)) throw new Error("El SMN todavía no publicó datos horarios de estos días.");
  const series = nombres.map((n) => horaria(porNombre.get(n) || [], ms));
  return { datos: aPuntos(puntos, lista, series, horas), avisos: [] };
}

module.exports = { bajarEstaciones, bajarSmn, horaria, juntar, aPuntos, lecturasInta, lecturasSinarame, lecturasSmn };
