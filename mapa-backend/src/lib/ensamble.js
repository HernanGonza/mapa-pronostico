/**
 * Ensamble multimodelo (en desarrollo): lo que dice cada modelo numérico de pronóstico para el
 * centroide de cada uno de los 17 departamentos, lado a lado, más la media y cuánto discrepan.
 *
 * Fuente: Open-Meteo (datos horarios agregados al rango pedido), un solo pedido con los 17 centroides y los 4 modelos globales del documento
 * «Modelos Meteorológicos Aplicados a la Provincia de Misiones» (ensamble/). El WRF-SMN (el modelo
 * regional clave para tormentas, 72 h) no está en Open-Meteo: se suma aparte, desde el bucket
 * público `smn-ar-wrf` de AWS (ver wrfSmn.js).
 */
const { loadDepartamentos, loadCentroides } = require("./departamentos");
const { wrfConEspera, precargar, progreso: progresoWrf } = require("./wrfSmn");

// `fuente`: de dónde sale. `aporta`: variables que el modelo publica (el WRF-SMN no da ráfagas ni viento).
const MODELOS = [
  { id: "ecmwf_ifs025", nombre: "ECMWF", origen: "Centro Europeo", rol: "Referencia a 3–10 días", fuente: "open-meteo" },
  { id: "gfs_seamless", nombre: "GFS", origen: "EE. UU. (NOAA)", rol: "Tendencias de viento y temperatura", fuente: "open-meteo" },
  { id: "icon_seamless", nombre: "ICON", origen: "Alemania (DWD)", rol: "Validador de consenso", fuente: "open-meteo" },
  { id: "gem_seamless", nombre: "GEM", origen: "Canadá (ECCC)", rol: "Validador de consenso", fuente: "open-meteo" },
  { id: "wrf_smn", nombre: "WRF-SMN", origen: "Argentina (SMN) · 4 km, hasta 72 h", rol: "Tormentas y lluvia convectiva", fuente: "wrf", aporta: ["tmax", "tmin", "lluvia"] },
];

// `agrega`: cómo se resume el día a partir de los valores horarios (dentro del rango pedido).
// `umbral`: diferencia entre el modelo más alto y el más bajo a partir de la cual se marca «discrepan».
const VARIABLES = [
  { horaria: "temperature_2m", agrega: "max", clave: "tmax", nombre: "Temperatura máxima", unidad: "°C", decimales: 1, umbral: 4 },
  { horaria: "temperature_2m", agrega: "min", clave: "tmin", nombre: "Temperatura mínima", unidad: "°C", decimales: 1, umbral: 4 },
  { horaria: "precipitation", agrega: "sum", clave: "lluvia", nombre: "Lluvia acumulada", unidad: "mm", decimales: 1, umbral: 10 },
  { horaria: "wind_gusts_10m", agrega: "max", clave: "rafaga", nombre: "Ráfaga máxima", unidad: "km/h", decimales: 0, umbral: 25 },
  { horaria: "wind_speed_10m", agrega: "max", clave: "viento", nombre: "Viento máximo", unidad: "km/h", decimales: 0, umbral: 15 },
];
const HORARIAS = [...new Set(VARIABLES.map((v) => v.horaria))];

const TIMEOUT_MS = 20000;
const DIAS_ATRAS = 7, DIAS_ADELANTE = 9, DIAS_MAX = 10; // lo que cubren los modelos (ECMWF llega a 10 días).
const RE_FECHAHORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const redondear = (n, d) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

async function pedir(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error(`Open-Meteo: HTTP ${r.status}.`);
    return await r.json();
  } catch (e) {
    throw e.name === "AbortError" ? new Error("Open-Meteo: tiempo de espera agotado.") : e;
  } finally {
    clearTimeout(timer);
  }
}

/** Estadística de los valores de los modelos (ignora los que no respondieron). */
function resumir(valores, variable) {
  const v = valores.filter((x) => x != null);
  if (!v.length) return { media: null, min: null, max: null, rango: null, discrepan: false, modelos: 0 };
  const min = Math.min(...v), max = Math.max(...v);
  const media = v.reduce((a, b) => a + b, 0) / v.length;
  // Lluvia: además de la diferencia en mm, es discrepancia que unos digan «seco» y otros «llueve».
  const seco = (x) => x < 1;
  const desacuerdoLluvia = variable.clave === "lluvia" && v.some(seco) && v.some((x) => !seco(x)) && max - min >= 3;
  return {
    media: redondear(media, variable.decimales), min: redondear(min, variable.decimales), max: redondear(max, variable.decimales),
    rango: redondear(max - min, variable.decimales),
    discrepan: v.length > 1 && (max - min >= variable.umbral || desacuerdoLluvia),
    modelos: v.length,
  };
}

const ART = "America/Argentina/Buenos_Aires";
const diaART = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: ART }).format(new Date(ms));
const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Valida el rango «AAAA-MM-DDTHH:MM» (hora de Misiones). Devuelve el texto del error, o null. */
function errorDeRango(desde, hasta) {
  if (!RE_FECHAHORA.test(desde || "") || !RE_FECHAHORA.test(hasta || "")) return "El rango tiene que ser AAAA-MM-DDTHH:MM.";
  if (Number.isNaN(Date.parse(`${desde}:00Z`)) || Number.isNaN(Date.parse(`${hasta}:00Z`))) return "Fecha u hora inválida.";
  if (hasta <= desde) return "El fin tiene que ser posterior al inicio.";
  const hoy = diaART(Date.now());
  if (desde.slice(0, 10) < sumarDias(hoy, -DIAS_ATRAS)) return `El inicio puede ser, como mucho, ${DIAS_ATRAS} días atrás.`;
  if (hasta.slice(0, 10) > sumarDias(hoy, DIAS_ADELANTE)) return `El fin puede ser, como mucho, ${DIAS_ADELANTE} días adelante (hasta donde llegan los modelos).`;
  if ((Date.parse(`${hasta}:00Z`) - Date.parse(`${desde}:00Z`)) / 86400000 > DIAS_MAX) return `El rango puede tener, como mucho, ${DIAS_MAX} días.`;
  return null;
}

/** Resume los valores horarios de un modelo dentro de [desde, hasta]: null si falta alguna hora (el modelo no llega). */
function agregar(horas, valores, desde, hasta, agrega) {
  const v = [];
  for (let i = 0; i < horas.length; i++) {
    if (horas[i] < desde || horas[i] > hasta) continue;
    if (valores?.[i] == null) return null;
    v.push(valores[i]);
  }
  if (!v.length) return null;
  return agrega === "sum" ? v.reduce((a, b) => a + b, 0) : agrega === "min" ? Math.min(...v) : Math.max(...v);
}

/**
 * Lo que dice cada modelo de `modelos` (ids; sólo se consultan esos), para el centroide de cada departamento,
 * entre `desde` y `hasta` (hora de Misiones, «AAAA-MM-DDTHH:MM»). Cada día se resume sólo con las horas que caen
 * dentro del rango (el primero y el último pueden ser parciales). Se consulta en el momento: no hay caché del
 * resultado (el WRF-SMN guarda aparte lo ya leído de cada corrida, que sólo cambia cada 6 h).
 * { generado, desde, hasta, dias: [{ fecha, horas }], modelos, variables, avisos, wrf?: { corrida } | { pendiente, progreso },
 * departamentos: [{ id, nombre, lat, lng, dias: [{ fecha, tmax: { valores: { <modelo>: n|null }, media, min, max,
 * rango, discrepan, modelos }, … }] }] }. Un modelo que no cubre todas las horas de un día queda en null ese día.
 */
async function pronosticoEnsamble({ desde, hasta, modelos: ids }) {
  const e = errorDeRango(desde, hasta);
  if (e) throw Object.assign(new Error(e), { status: 400 });
  const elegidos = MODELOS.filter((m) => (ids || []).includes(m.id));
  if (!elegidos.length || (ids || []).some((id) => !MODELOS.some((m) => m.id === id))) throw Object.assign(new Error("Elegí al menos un modelo (ids válidos)."), { status: 400 });
  const deOpenMeteo = elegidos.filter((m) => m.fuente === "open-meteo"), conWrf = elegidos.some((m) => m.fuente === "wrf");

  const centroides = loadCentroides();
  const lista = loadDepartamentos().filter((d) => centroides.has(String(d.id)));
  if (lista.length !== 17) throw new Error(`Se esperaban 17 departamentos con centroide y hay ${lista.length}.`);
  const puntosGeo = lista.map((d) => centroides.get(String(d.id)));

  // Los días del rango y cuántas horas de cada uno caen adentro.
  const horasRango = [];
  for (let dia = desde.slice(0, 10); dia <= hasta.slice(0, 10); dia = sumarDias(dia, 1)) for (let h = 0; h < 24; h++) { const t = `${dia}T${String(h).padStart(2, "0")}:00`; if (t >= desde && t <= hasta) horasRango.push(t); }
  const fechas = [...new Set(horasRango.map((t) => t.slice(0, 10)))];
  const dias = fechas.map((fecha) => ({ fecha, horas: horasRango.filter((t) => t.startsWith(fecha)).length }));
  const avisos = [];

  // Open-Meteo (ECMWF, GFS, ICON, GEM): un solo pedido con los 17 puntos.
  let puntos = null, horas = [];
  const pedidoOpenMeteo = (async () => {
    if (!deOpenMeteo.length) return;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${puntosGeo.map((c) => c.lat.toFixed(3)).join(",")}&longitude=${puntosGeo.map((c) => c.lng.toFixed(3)).join(",")}`
      + `&hourly=${HORARIAS.join(",")}&models=${deOpenMeteo.map((m) => m.id).join(",")}`
      + `&timezone=${encodeURIComponent(ART)}&start_date=${desde.slice(0, 10)}&end_date=${hasta.slice(0, 10)}`;
    const data = await pedir(url);
    puntos = Array.isArray(data) ? data : [data];
    if (puntos.length !== lista.length || !puntos[0]?.hourly?.time) throw new Error("Open-Meteo: respuesta inesperada.");
    horas = puntos[0].hourly.time;
  })();
  // WRF-SMN: aparte, desde AWS. Si falla, los demás modelos igual se muestran y se avisa.
  const pedidoWrf = conWrf ? wrfConEspera({ desde, hasta, puntos: puntosGeo }).catch((err) => { console.error(err); avisos.push(`WRF-SMN: ${err.message}`); return null; }) : Promise.resolve(null);
  const [, wrf] = await Promise.all([pedidoOpenMeteo, pedidoWrf]);
  const wrfPendiente = !!wrf?.pendiente; // sigue bajando: la pantalla vuelve a consultar cuando termine
  // Los modelos que traen datos en esta respuesta (el WRF-SMN que sigue bajando, o que falló, no figura todavía).
  const consultados = elegidos.filter((m) => m.fuente !== "wrf" || (wrf && !wrf.pendiente));
  if (wrf?.avisos?.length) avisos.push(...wrf.avisos.map((a) => `WRF-SMN: ${a}`));

  const departamentos = lista.map((d, i) => {
    const c = centroides.get(String(d.id)), hourly = puntos?.[i]?.hourly;
    return {
      id: String(d.id), nombre: d.nombre, lat: redondear(c.lat, 3), lng: redondear(c.lng, 3),
      dias: fechas.map((fecha) => {
        const dia = { fecha }, desdeDia = `${fecha}T00:00` > desde ? `${fecha}T00:00` : desde, hastaDia = `${fecha}T23:00` < hasta ? `${fecha}T23:00` : hasta;
        for (const variable of VARIABLES) {
          const valores = {};
          for (const m of consultados) {
            let v = null;
            if (m.fuente === "open-meteo") v = agregar(horas, hourly?.[deOpenMeteo.length === 1 ? variable.horaria : `${variable.horaria}_${m.id}`], desdeDia, hastaDia, variable.agrega); // con un solo modelo Open-Meteo no agrega el sufijo
            else if (wrf && variable.clave === "lluvia") { // suma de las horas del día dentro del rango; si falta alguna, el modelo no la cubre
              const hs = horasRango.filter((t) => t >= desdeDia && t <= hastaDia).map((t) => wrf.lluviaPorHora.get(t)?.[i]);
              v = hs.length && hs.every((x) => x != null) ? hs.reduce((a, b) => a + b, 0) : null;
            } else if (wrf && (variable.clave === "tmax" || variable.clave === "tmin")) v = wrf.diario[variable.clave].get(fecha)?.[i] ?? null;
            valores[m.id] = redondear(v, variable.decimales);
          }
          dia[variable.clave] = { valores, ...resumir(Object.values(valores), variable) };
        }
        return dia;
      }),
    };
  });

  return {
    generado: new Date().toISOString(), desde, hasta, dias, modelos: consultados, avisos, ...(wrfPendiente ? { wrf: { pendiente: true, progreso: wrf.progreso } } : wrf ? { wrf: { corrida: wrf.corrida } } : {}),
    variables: VARIABLES.map(({ clave, nombre, unidad, decimales, umbral, agrega }) => ({ clave, nombre, unidad, decimales, umbral, agrega })),
    departamentos,
  };
}

/** Deja lista en caché la corrida vigente del WRF-SMN (WRF_PRECARGA=1: ver server.js). */
function precargarWrf() {
  const c = loadCentroides();
  return precargar(loadDepartamentos().filter((d) => c.has(String(d.id))).map((d) => c.get(String(d.id))));
}

module.exports = { pronosticoEnsamble, precargarWrf, progresoWrf, errorDeRango, MODELOS, VARIABLES, resumir };
