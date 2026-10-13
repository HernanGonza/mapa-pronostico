/**
 * Ensamble multimodelo (en desarrollo): lo que dice cada modelo numérico de pronóstico para el
 * centroide de cada uno de los 17 departamentos, lado a lado, más la media y cuánto discrepan.
 *
 * Fuente: Open-Meteo (datos horarios agregados al rango pedido), un solo pedido con los 17 centroides y los 4 modelos globales del documento
 * «Modelos Meteorológicos Aplicados a la Provincia de Misiones» (ensamble/). El WRF-SMN (el modelo
 * regional clave para tormentas, 72 h) no está en Open-Meteo: se suma aparte, desde el bucket
 * público `smn-ar-wrf` de AWS (ver wrfSmn.js). El MONAN del CPTEC/INPE (3 km regional y 10 km global) también va aparte,
 * de sus datos abiertos (ver monan.js): es el único con ráfagas, reflectividad de radar y helicidad de ascenso.
 */
const { loadDepartamentos, loadCentroides } = require("./departamentos");
const { wrfConEspera, precargar, progreso: progresoWrf } = require("./wrfSmn");
const { monanConEspera, progreso: progresoMonan } = require("./monan");
const { loadMunicipios } = require("./municipios");
const { CIUDADES } = require("./informePronostico");

const N_DEPARTAMENTOS = 17;
/**
 * Los puntos que consulta el ensamble: el centroide de cada uno de los 17 departamentos y, a continuación, las 13
 * ciudades del informe de pronóstico. Siempre los mismos y en este orden (el WRF-SMN guarda sus lecturas por posición).
 */
function puntosDelEnsamble() {
  const centroides = loadCentroides();
  const deptos = loadDepartamentos().filter((d) => centroides.has(String(d.id)));
  if (deptos.length !== N_DEPARTAMENTOS) throw new Error(`Se esperaban ${N_DEPARTAMENTOS} departamentos con centroide y hay ${deptos.length}.`);
  const municipios = loadMunicipios();
  const ciudades = CIUDADES.map((c) => {
    const m = municipios.find((x) => x.nombre === c.municipio);
    if (!m) throw new Error(`No se encontró el municipio ${c.municipio} para la ciudad ${c.nombre}.`);
    return { id: `ciudad:${c.nombre}`, nombre: c.nombre, lat: m.lat, lng: m.lng };
  });
  return [...deptos.map((d) => ({ id: String(d.id), nombre: d.nombre, ...centroides.get(String(d.id)) })), ...ciudades];
}

// `fuente`: de dónde sale. `aporta`: variables que el modelo publica (el WRF-SMN no da ráfagas ni viento).
const MODELOS = [
  { id: "ecmwf_ifs025", nombre: "ECMWF", origen: "Centro Europeo", rol: "Referencia a 3–10 días", fuente: "open-meteo" },
  { id: "gfs_seamless", nombre: "GFS", origen: "EE. UU. (NOAA)", rol: "Tendencias de viento y temperatura", fuente: "open-meteo" },
  { id: "icon_seamless", nombre: "ICON", origen: "Alemania (DWD)", rol: "Validador de consenso", fuente: "open-meteo" },
  { id: "gem_seamless", nombre: "GEM", origen: "Canadá (ECCC)", rol: "Validador de consenso", fuente: "open-meteo" },
  { id: "wrf_smn", nombre: "WRF-SMN", origen: "Argentina (SMN) · 4 km, hasta 72 h", rol: "Tormentas y lluvia convectiva", fuente: "wrf", aporta: ["tmax", "tmin", "lluvia", "hmin", "hmax", "viento", "dirviento"] },
  { id: "monan_3km", nombre: "MONAN 3 km", origen: "Brasil (CPTEC/INPE) · regional, hasta 72 h", rol: "Tormentas y convección", fuente: "monan", producto: "03km" },
  { id: "monan_10km", nombre: "MONAN 10 km", origen: "Brasil (CPTEC/INPE) · global, hasta 11 días", rol: "Mediano plazo", fuente: "monan", producto: "10km" },
];

// `agrega`: cómo se resume el día a partir de los valores horarios (dentro del rango pedido): max, min, sum,
// mean (promedio) o dir (dirección predominante: promedio circular, ponderado por la velocidad del viento).
// `umbral`: diferencia entre el modelo más alto y el más bajo a partir de la cual se marca «discrepan»
// (en las direcciones, el ángulo máximo entre dos modelos). `grupo`: cómo se agrupan las pestañas.
const VARIABLES = [
  { grupo: "Temperatura", horaria: "temperature_2m", agrega: "max", clave: "tmax", nombre: "Temperatura máxima", unidad: "°C", decimales: 1, umbral: 4 },
  { grupo: "Temperatura", horaria: "temperature_2m", agrega: "min", clave: "tmin", nombre: "Temperatura mínima", unidad: "°C", decimales: 1, umbral: 4 },
  { grupo: "Temperatura", horaria: "apparent_temperature", agrega: "max", clave: "sensmax", nombre: "Sensación térmica máxima", unidad: "°C", decimales: 1, umbral: 5 },
  { grupo: "Temperatura", horaria: "apparent_temperature", agrega: "min", clave: "sensmin", nombre: "Sensación térmica mínima", unidad: "°C", decimales: 1, umbral: 5 },
  { grupo: "Lluvia", horaria: "precipitation", agrega: "sum", clave: "lluvia", nombre: "Lluvia acumulada", unidad: "mm", decimales: 1, umbral: 10 },
  { grupo: "Lluvia", horaria: "precipitation_probability", agrega: "max", clave: "probllu", nombre: "Probabilidad de lluvia (máx.)", unidad: "%", decimales: 0, umbral: 30 },
  { grupo: "Viento", horaria: "wind_speed_10m", agrega: "max", clave: "viento", nombre: "Viento máximo", unidad: "km/h", decimales: 0, umbral: 15 },
  { grupo: "Viento", horaria: "wind_gusts_10m", agrega: "max", clave: "rafaga", nombre: "Ráfaga máxima", unidad: "km/h", decimales: 0, umbral: 25 },
  { grupo: "Viento", horaria: "wind_direction_10m", agrega: "dir", ponderaCon: "wind_speed_10m", circular: true, clave: "dirviento", nombre: "Dirección del viento", unidad: "°", decimales: 0, umbral: 60 },
  { grupo: "Humedad y nubes", horaria: "relative_humidity_2m", agrega: "min", clave: "hmin", nombre: "Humedad mínima", unidad: "%", decimales: 0, umbral: 15 },
  { grupo: "Humedad y nubes", horaria: "relative_humidity_2m", agrega: "max", clave: "hmax", nombre: "Humedad máxima", unidad: "%", decimales: 0, umbral: 15 },
  { grupo: "Humedad y nubes", horaria: "cloud_cover", agrega: "mean", clave: "nubosidad", nombre: "Nubosidad (promedio)", unidad: "%", decimales: 0, umbral: 30 },
  { grupo: "Humedad y nubes", horaria: "dew_point_2m", agrega: "mean", clave: "rocio", nombre: "Punto de rocío (promedio)", unidad: "°C", decimales: 1, umbral: 4 },
  { grupo: "Tormentas", horaria: "cape", agrega: "max", clave: "cape", nombre: "CAPE máxima", unidad: "J/kg", decimales: 0, umbral: 500 },
  { grupo: "Tormentas", horaria: null, agrega: "max", clave: "refl", nombre: "Reflectividad de radar máxima", unidad: "dBZ", decimales: 0, umbral: 15 }, // sólo MONAN 3 km
  { grupo: "Tormentas", horaria: null, agrega: "max", clave: "uh", nombre: "Helicidad de ascenso máxima", unidad: "m²/s²", decimales: 0, umbral: 50 }, // sólo MONAN 3 km
];

// Qué serie del MONAN (ver `derivar` en monan.js) y cómo se resume alimenta cada variable del ensamble.
const SERIE_MONAN = {
  tmax: ["tc", "max"], tmin: ["tc", "min"], sensmax: ["st", "max"], sensmin: ["st", "min"], lluvia: ["lluviaAcc", "sum"], viento: ["vel", "max"],
  rafaga: ["rafaga", "max"], dirviento: ["dir", "dir"], hmin: ["hr", "min"], hmax: ["hr", "max"], nubosidad: ["nub", "mean"], rocio: ["td", "mean"],
  cape: ["cape", "max"], refl: ["refl", "max"], uh: ["uh", "max"],
};
const HORARIAS = [...new Set(VARIABLES.flatMap((v) => [v.horaria, v.ponderaCon].filter(Boolean)))];
const msDeStamp = (stamp) => Date.parse(`${stamp}:00-03:00`); // «AAAA-MM-DDTHH:MM» hora de Misiones

const TIMEOUT_MS = 40000; // Open-Meteo suele responder en 2 s, pero a veces se pone lento
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

const aRad = (g) => (g * Math.PI) / 180;
/** Promedio de ángulos en grados (0–360), con pesos opcionales: el 350° y el 10° dan 0°, no 180°. */
function mediaCircular(angulos, pesos = null) {
  let sen = 0, cos = 0;
  angulos.forEach((g, i) => { const w = pesos ? Math.max(pesos[i] ?? 0, 0.01) : 1; sen += w * Math.sin(aRad(g)); cos += w * Math.cos(aRad(g)); });
  return (Math.atan2(sen, cos) * 180 / Math.PI + 360) % 360;
}
const difAngular = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Estadística de los valores de los modelos (ignora los que no respondieron). */
function resumir(valores, variable) {
  const v = valores.filter((x) => x != null);
  if (!v.length) return { media: null, min: null, max: null, rango: null, discrepan: false, modelos: 0 };
  if (variable.circular) { // direcciones: promedio circular y el ángulo máximo entre dos modelos
    let rango = 0; for (const a of v) for (const b of v) rango = Math.max(rango, difAngular(a, b));
    return { media: redondear(mediaCircular(v) % 360, variable.decimales), min: null, max: null, rango: redondear(rango, 0), discrepan: v.length > 1 && rango >= variable.umbral, modelos: v.length };
  }
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
function agregar(horas, valores, desde, hasta, agrega, pesos = null) {
  const v = [], w = [];
  for (let i = 0; i < horas.length; i++) {
    if (horas[i] < desde || horas[i] > hasta) continue;
    if (valores?.[i] == null) return null;
    v.push(valores[i]); w.push(pesos?.[i] ?? null);
  }
  if (!v.length) return null;
  if (agrega === "sum") return v.reduce((a, b) => a + b, 0);
  if (agrega === "mean") return v.reduce((a, b) => a + b, 0) / v.length;
  if (agrega === "dir") return mediaCircular(v, w.every((x) => x != null) ? w : null);
  return agrega === "min" ? Math.min(...v) : Math.max(...v);
}

/**
 * Una serie del MONAN resumida sobre la ventana [desdeDia, hastaDia] (stamps horarios de Misiones) para el punto `p`; null si la
 * corrida no cubre toda la ventana. Los valores instantáneos se resumen con las muestras que caen dentro (cada hora en el 3 km,
 * cada 3 h en el 10 km). La lluvia es la diferencia del acumulado entre el final y la hora anterior al comienzo (en el 10 km, con
 * la muestra más cercana: hasta hora y media de diferencia).
 */
function valorMonan(mon, serie, agrega, p, desdeDia, hastaDia) {
  const col = mon.ser[serie], t0 = msDeStamp(desdeDia), t1 = msDeStamp(hastaDia), init = Date.parse(mon.corrida);
  if (!col || t0 < init || t1 > mon.validos.at(-1)) return null;
  if (agrega === "sum") {
    const tol = mon.paso > 3600e3 ? 5400e3 : 1800e3;
    const cercano = (t) => { let k = -1, d = Infinity; mon.validos.forEach((v, i) => { const e = Math.abs(v - t); if (e < d) { d = e; k = i; } }); return d <= tol ? k : -1; };
    const a = cercano(t0 - 3600e3), b = cercano(t1);
    if (a < 0 || b <= a) return null;
    const va = col[a][p], vb = col[b][p];
    return va != null && vb != null ? Math.max(0, vb - va) : null;
  }
  const ks = []; mon.validos.forEach((t, k) => { if (t >= t0 && t <= t1) ks.push(k); });
  if (!ks.length) return null;
  const v = ks.map((k) => col[k][p]);
  if (v.some((x) => x == null)) return null;
  if (agrega === "dir") { const w = ks.map((k) => mon.ser.vel[k][p]); return mediaCircular(v, w.every((x) => x != null) ? w : null); }
  if (agrega === "mean") return v.reduce((a, b) => a + b, 0) / v.length;
  return agrega === "min" ? Math.min(...v) : Math.max(...v);
}

/**
 * Lo que dice cada modelo de `modelos` (ids; sólo se consultan esos), para el centroide de cada departamento,
 * entre `desde` y `hasta` (hora de Misiones, «AAAA-MM-DDTHH:MM»). Cada día se resume sólo con las horas que caen
 * dentro del rango (el primero y el último pueden ser parciales). Se consulta en el momento: no hay caché del
 * resultado (el WRF-SMN guarda aparte lo ya leído de cada corrida, que sólo cambia cada 6 h).
 * { generado, desde, hasta, dias: [{ fecha, horas }], modelos, variables, avisos, pendientes: [ids que siguen bajando], corridas: { <modelo>: ISO },
 * wrf?: { corrida } | { pendiente, progreso },
 * departamentos (17) y ciudades (13, las del informe): [{ id, nombre, lat, lng, dias: [{ fecha, tmax: { valores: { <modelo>: n|null }, media, min, max,
 * rango, discrepan, modelos }, … }] }] }. Un modelo que no cubre todas las horas de un día queda en null ese día.
 */
async function pronosticoEnsamble({ desde, hasta, modelos: ids }) {
  const e = errorDeRango(desde, hasta);
  if (e) throw Object.assign(new Error(e), { status: 400 });
  const elegidos = MODELOS.filter((m) => (ids || []).includes(m.id));
  if (!elegidos.length || (ids || []).some((id) => !MODELOS.some((m) => m.id === id))) throw Object.assign(new Error("Elegí al menos un modelo (ids válidos)."), { status: 400 });
  const deOpenMeteo = elegidos.filter((m) => m.fuente === "open-meteo"), conWrf = elegidos.some((m) => m.fuente === "wrf"), deMonan = elegidos.filter((m) => m.fuente === "monan");

  const lista = puntosDelEnsamble(), puntosGeo = lista; // departamentos y ciudades

  // Los días del rango y cuántas horas de cada uno caen adentro.
  const horasRango = [];
  for (let dia = desde.slice(0, 10); dia <= hasta.slice(0, 10); dia = sumarDias(dia, 1)) for (let h = 0; h < 24; h++) { const t = `${dia}T${String(h).padStart(2, "0")}:00`; if (t >= desde && t <= hasta) horasRango.push(t); }
  const fechas = [...new Set(horasRango.map((t) => t.slice(0, 10)))];
  const dias = fechas.map((fecha) => ({ fecha, horas: horasRango.filter((t) => t.startsWith(fecha)).length }));
  const avisos = [];

  // Open-Meteo (ECMWF, GFS, ICON, GEM): un solo pedido con todos los puntos.
  let puntos = null, horas = [];
  let openMeteoFallo = false;
  const pedidoOpenMeteo = (async () => {
    if (!deOpenMeteo.length) return;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${puntosGeo.map((c) => c.lat.toFixed(3)).join(",")}&longitude=${puntosGeo.map((c) => c.lng.toFixed(3)).join(",")}`
      + `&hourly=${HORARIAS.join(",")}&models=${deOpenMeteo.map((m) => m.id).join(",")}`
      + `&timezone=${encodeURIComponent(ART)}&start_date=${desde.slice(0, 10)}&end_date=${hasta.slice(0, 10)}`;
    // Si Open-Meteo no responde (o tarda de más) no se cae todo: se reintenta una vez y, si sigue, se avisa y se muestran los otros modelos.
    let data = null, ultimo = null;
    for (let intento = 0; intento < 2 && !data; intento++) { try { data = await pedir(url); } catch (e) { ultimo = e; } }
    if (!data) { openMeteoFallo = true; console.error("[ensamble] Open-Meteo:", ultimo?.message); avisos.push(`Open-Meteo no respondió (${ultimo?.cause?.code || ultimo?.message}): ECMWF, GFS, ICON y GEM no figuran en esta consulta. Probá de nuevo en un rato.`); return; }
    puntos = Array.isArray(data) ? data : [data];
    if (puntos.length !== lista.length || !puntos[0]?.hourly?.time) { openMeteoFallo = true; avisos.push("Open-Meteo devolvió una respuesta inesperada: ECMWF, GFS, ICON y GEM no figuran en esta consulta."); return; }
    horas = puntos[0].hourly.time;
  })();
  // WRF-SMN: aparte, desde AWS. Si falla, los demás modelos igual se muestran y se avisa.
  const pedidoWrf = conWrf ? wrfConEspera({ desde, hasta, puntos: puntosGeo }).catch((err) => { console.error(err); avisos.push(`WRF-SMN: ${err.message}`); return null; }) : Promise.resolve(null);
  // MONAN (CPTEC/INPE): una lectura por producto (3 km y/o 10 km), también aparte y también sin trabar si tarda.
  const pedidosMonan = deMonan.map((m) => monanConEspera({ producto: m.producto, puntos: puntosGeo }).catch((err) => { console.error(err); avisos.push(`${m.nombre}: ${err.message}`); return null; }));
  const [, wrf, ...lecturasMonan] = await Promise.all([pedidoOpenMeteo, pedidoWrf, ...pedidosMonan]);
  const monPorId = Object.fromEntries(deMonan.map((m, i) => [m.id, lecturasMonan[i]]));
  const wrfPendiente = !!wrf?.pendiente; // sigue bajando: la pantalla vuelve a consultar cuando termine
  const pendientes = elegidos.filter((m) => (m.fuente === "wrf" && wrfPendiente) || (m.fuente === "monan" && monPorId[m.id]?.pendiente)).map((m) => m.id);
  // Los modelos que traen datos en esta respuesta (el que sigue bajando, o que falló, no figura todavía).
  const consultados = elegidos.filter((m) => (m.fuente === "open-meteo" && !openMeteoFallo) || (m.fuente === "wrf" && wrf && !wrf.pendiente) || (m.fuente === "monan" && monPorId[m.id] && !monPorId[m.id].pendiente));
  if (wrf?.avisos?.length) avisos.push(...wrf.avisos.map((a) => `WRF-SMN: ${a}`));

  const resultados = lista.map((d, i) => {
    const c = d, hourly = puntos?.[i]?.hourly;
    return {
      id: d.id, nombre: d.nombre, lat: redondear(c.lat, 3), lng: redondear(c.lng, 3),
      dias: fechas.map((fecha) => {
        const dia = { fecha }, desdeDia = `${fecha}T00:00` > desde ? `${fecha}T00:00` : desde, hastaDia = `${fecha}T23:00` < hasta ? `${fecha}T23:00` : hasta;
        for (const variable of VARIABLES) {
          const valores = {};
          for (const m of consultados) {
            let v = null;
            if (m.fuente === "open-meteo") { // con un solo modelo Open-Meteo no agrega el sufijo al nombre de la variable
              const col = (nombre) => hourly?.[deOpenMeteo.length === 1 ? nombre : `${nombre}_${m.id}`];
              if (variable.horaria) v = agregar(horas, col(variable.horaria), desdeDia, hastaDia, variable.agrega, variable.ponderaCon ? col(variable.ponderaCon) : null);
            } else if (m.fuente === "monan") {
              const par = SERIE_MONAN[variable.clave];
              if (par) v = valorMonan(monPorId[m.id], par[0], par[1], i, desdeDia, hastaDia);
            } else if (m.fuente === "wrf") {
              if (variable.clave === "tmax") v = wrf.diario.tmax.get(fecha)?.[i] ?? null;
              else if (variable.clave === "tmin") v = wrf.diario.tmin.get(fecha)?.[i] ?? null;
              else if (["lluvia", "hmin", "hmax", "viento", "dirviento"].includes(variable.clave)) { // las horas del día dentro del rango; si falta alguna, el modelo no las cubre
                const porHora = (nombre) => horasRango.filter((t) => t >= desdeDia && t <= hastaDia).map((t) => wrf.porHora[nombre].get(t)?.[i]);
                const completo = (hs) => hs.length > 0 && hs.every((x) => x != null);
                if (variable.clave === "lluvia") { const hs = porHora("PP"); v = completo(hs) ? hs.reduce((a, b) => a + b, 0) : null; }
                else if (variable.clave === "hmin" || variable.clave === "hmax") { const hs = porHora("HR2"); v = completo(hs) ? Math[variable.clave === "hmin" ? "min" : "max"](...hs) : null; }
                else if (variable.clave === "viento") { const hs = porHora("magViento10"); v = completo(hs) ? Math.max(...hs) * 3.6 : null; } // m/s → km/h
                else { const dirs = porHora("dirViento10"), vel = porHora("magViento10"); v = completo(dirs) && completo(vel) ? mediaCircular(dirs, vel) : null; }
              }
            }
            valores[m.id] = redondear(v, variable.decimales);
          }
          dia[variable.clave] = { valores, ...resumir(Object.values(valores), variable) };
        }
        return dia;
      }),
    };
  });

  return {
    generado: new Date().toISOString(), desde, hasta, dias, modelos: consultados, avisos, pendientes, ...(wrfPendiente ? { wrf: { pendiente: true, progreso: wrf.progreso } } : wrf ? { wrf: { corrida: wrf.corrida } } : {}),
    corridas: { ...(wrf && !wrf.pendiente ? { wrf_smn: wrf.corrida } : {}), ...Object.fromEntries(deMonan.filter((m) => monPorId[m.id] && !monPorId[m.id].pendiente).map((m) => [m.id, monPorId[m.id].corrida])) },
    variables: VARIABLES.map(({ clave, nombre, unidad, decimales, umbral, agrega, grupo, circular }) => ({ clave, nombre, unidad, decimales, umbral, agrega, grupo, circular: !!circular })),
    departamentos: resultados.slice(0, N_DEPARTAMENTOS), ciudades: resultados.slice(N_DEPARTAMENTOS),
  };
}

/** Avance de lo que se está descargando (WRF-SMN y MONAN): la pantalla lo mira sólo mientras dura una consulta. */
function progresoEnsamble() {
  const wrf = progresoWrf(), monan = progresoMonan();
  return { activo: wrf.activo || monan.activo, wrf, monan };
}

/** Deja lista en caché la corrida vigente del WRF-SMN (WRF_PRECARGA=1: ver server.js). */
function precargarWrf() {
  return precargar(puntosDelEnsamble());
}

module.exports = { pronosticoEnsamble, precargarWrf, progresoWrf, progresoEnsamble, valorMonan, errorDeRango, puntosDelEnsamble, mediaCircular, MODELOS, VARIABLES, resumir };
