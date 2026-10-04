const { ESTACIONES: INTA } = require("./sigaInta");
const { ESTACIONES: SINARAME, CODIGOS: CODIGOS_SNIH } = require("./sinarame");
const smnAbiertos = require("./smnDatosAbiertos");

/**
 * Informes diarios (en desarrollo, sólo superadmin): qué pasó un día en Misiones según las
 * estaciones OFICIALES con datos cada 10 minutos — sin modelos (a pedido: nada de Open-Meteo):
 *  - INTA, Red Agrometeorológica (SIGA): 7 estaciones. `param_type=datosestaciones` devuelve
 *    registros cada 10 min. OJO: la hora viene marcada "Z[UTC]" pero es HORA LOCAL (verificado
 *    04/10/2026: la mínima cae 04:20 y los datos de hoy llegan con horas de demora). La lluvia
 *    (`precDiaCrono`) es la de cada intervalo, no un acumulado.
 *  - SiNaRaMe (INA, vía SNIH): 4 estaciones, cada 10 min, con fecha en milisegundos UTC reales.
 *  - SMN, datos abiertos (smnDatosAbiertos.js): datos horarios (temperatura, humedad, presión y
 *    viento medio; sin lluvia) y las temperaturas extremas oficiales del día. Se publican al día siguiente.
 *  - Lo que emitió el SMN ese día (alertas SAT y ACP), del historial que guarda el sistema.
 *  - Lo que publicamos nosotros (alertas manuales y avisos a muy corto plazo).
 * Todo se resume por estación (lluvia total, máxima en 30 min, ráfaga, temperatura y la caída
 * brusca de temperatura que marca la llegada de la tormenta) y se arma un texto sugerido.
 */
const INTA_URL = "https://siga.inta.gob.ar/CdnaUV0iiERRpFQE.php";
const SNIH_URL = "https://snih.hidricosargentina.gob.ar";
const TIMEOUT_MS = 25000;
const MIN = 60 * 1000;
const OFFSET_MS = 3 * 60 * MIN; // Misiones: UTC−3, sin horario de verano

// Datos fuera de lo físicamente plausible = sensor roto (como en sigaInta.js / sinarame.js).
const plausible = {
  temperatura: (v) => typeof v === "number" && v > -10 && v < 50,
  humedad: (v) => typeof v === "number" && v >= 1 && v <= 100,
  viento: (v) => typeof v === "number" && v >= 0 && v < 200,
  lluvia: (v) => typeof v === "number" && v >= 0 && v < 200,
};
const limpio = (v, tipo) => (plausible[tipo](v) ? v : null);

async function pedirJson(url, opciones = {}) {
  const r = await fetch(url, { ...opciones, headers: { "User-Agent": "Mozilla/5.0", ...(opciones.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const texto = await r.text();
  if (!texto.trim()) return null;
  return JSON.parse(texto);
}

const ddmmaaaa = (fecha) => fecha.split("-").reverse().join("-");
/** "AAAA-MM-DD" + "HH:MM" (hora de Misiones) → ms UTC. */
const instante = (fecha, hora) => Date.parse(`${fecha}T${hora}:00-03:00`);

/**
 * Registros de 10 min de una estación INTA, en [desde, hasta] (ms UTC): `serie` (limpia, para el
 * informe) y `crudo` (cada registro tal cual lo manda el INTA, todos sus campos, para el Excel).
 */
async function serieInta(est, fecha, desde, hasta) {
  const url = `${INTA_URL}?param_type=datosestaciones&param_value=${est.id}/${ddmmaaaa(fecha)}%2000:00:00/${ddmmaaaa(fecha)}%2023:59:59`;
  const filas = ((await pedirJson(url)) || [])
    // "2026-10-03T17:20:00Z[UTC]" es hora local: se le suma el desfase para tener UTC real.
    .map((f) => ({ f, t: Date.parse(String(f.fechaHora).slice(0, 19) + "Z") + OFFSET_MS }))
    .filter(({ t }) => Number.isFinite(t) && t >= desde && t <= hasta);
  return {
    serie: filas.map(({ f, t }) => ({ t, lluvia: limpio(f.precDiaCrono, "lluvia") ?? 0, rafaga: limpio(f.velVientoMax, "viento"), temperatura: limpio(f.tempAbrigo150, "temperatura"), humedad: limpio(f.humedad ?? f.HMedia, "humedad") })),
    crudo: filas.map(({ f, t }) => ({ t, ...f })),
  };
}

/** Registros de 10 min de una estación SiNaRaMe (una variable por pedido), en [desde, hasta]. */
async function serieSinarame(est, fecha, desde, hasta) {
  const variable = async (codigo) => {
    const d = await pedirJson(`${SNIH_URL}/MuestraDatos.aspx/LeerUltimosRegistros`, {
      method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ fechaDesde: fecha, fechaHasta: fecha, estacion: est.id, codigo: String(codigo) }),
    });
    return new Map((d?.d?.Mediciones || []).map((m) => [Number(/\d+/.exec(m.FechaHora)?.[0]), m.Mediciones?.[0]?.Valor]));
  };
  const [temp, hum, viento, lluvia] = await Promise.all(["temperatura", "humedad", "viento", "precipitacion"].map((k) => variable(CODIGOS_SNIH[k]).catch(() => new Map())));
  const tiempos = [...new Set([...temp.keys(), ...hum.keys(), ...viento.keys(), ...lluvia.keys()])].filter((t) => t >= desde && t <= hasta).sort((a, b) => a - b);
  return {
    serie: tiempos.map((t) => ({ t, lluvia: limpio(lluvia.get(t), "lluvia") ?? 0, rafaga: limpio(viento.get(t), "viento"), temperatura: limpio(temp.get(t), "temperatura"), humedad: limpio(hum.get(t), "humedad") })),
    // Tal cual lo manda SNIH (incluidos los -999 / -9999 de "sin dato").
    crudo: tiempos.map((t) => ({ t, temperatura: temp.get(t) ?? null, humedad: hum.get(t) ?? null, viento: viento.get(t) ?? null, precipitacion: lluvia.get(t) ?? null })),
  };
}

// Un solo pedido al SMN por día aunque lo pidan las 5 estaciones (se guarda 10 minutos).
const diasSmn = new Map();
function diaSmn(fecha) {
  if (!diasSmn.has(fecha)) {
    const p = smnAbiertos.delDia(fecha);
    diasSmn.set(fecha, p);
    p.then(() => setTimeout(() => diasSmn.delete(fecha), 10 * MIN).unref?.(), () => diasSmn.delete(fecha));
  }
  return diasSmn.get(fecha);
}

/** Datos horarios de una estación del SMN (no trae lluvia ni ráfaga: FF es el viento medio). */
async function serieSmn(est, fecha, desde, hasta) {
  const dia = await diaSmn(fecha);
  if (dia.faltan.includes("horario")) throw new Error("el SMN todavía no publicó los datos horarios de ese día (los sube al día siguiente)");
  const filas = (dia.horario[est.nombreSmn] || [])
    .map((f) => ({ f, t: instante(fecha, `${String(f.hora).padStart(2, "0")}:00`) }))
    .filter(({ t }) => t >= desde && t <= hasta).sort((a, b) => a.t - b.t);
  const ex = dia.extremas[est.nombreSmn];
  return {
    serie: filas.map(({ f, t }) => ({ t, lluvia: 0, rafaga: null, viento: limpio(f.ff, "viento"), temperatura: limpio(f.temp, "temperatura"), humedad: limpio(f.hum, "humedad") })),
    crudo: filas.map(({ f, t }) => ({ t, hora: f.hora, temp: f.temp, hum: f.hum, pnm: f.pnm, dd: f.dd, ff: f.ff })),
    extremas: ex ? { tmax: ex.tmax, tmin: ex.tmin } : null,
    sinLluvia: true,
  };
}

/** "16:20" (hora de Misiones); con `conDia`, "03/10 16:20" (informes de más de un día). */
const horaDe = (t, conDia = false) => { const l = new Date(t - OFFSET_MS).toISOString(); return conDia ? `${l.slice(8, 10)}/${l.slice(5, 7)} ${l.slice(11, 16)}` : l.slice(11, 16); };

/**
 * Resumen de una serie (de 10 min, o horaria en el SMN). `sinLluvia`: la red no mide lluvia (no es
 * que no llovió). `ventanaCaida`: minutos para buscar la caída brusca de temperatura (con datos
 * horarios no hay 30 min, se mira de una hora a la siguiente).
 */
function resumir(serie, { sinLluvia = false, ventanaCaida = 30, conDia = false } = {}) {
  const hora = (t) => horaDe(t, conDia);
  if (!serie.length) return null;
  const lluviaTotal = serie.reduce((s, r) => s + r.lluvia, 0);
  // Máxima lluvia en 30 min: ventana móvil de 3 registros consecutivos (≤ 35 min entre puntas).
  let max30 = { mm: 0, t: null };
  for (let i = 0; i < serie.length; i++) {
    let mm = 0;
    for (let j = i; j < serie.length && serie[j].t - serie[i].t < 30 * MIN; j++) mm += serie[j].lluvia;
    if (mm > max30.mm) max30 = { mm, t: serie[i].t };
  }
  const conRafaga = serie.filter((r) => r.rafaga != null);
  const rafaga = conRafaga.length ? conRafaga.reduce((a, b) => (b.rafaga > a.rafaga ? b : a)) : null;
  const conTemp = serie.filter((r) => r.temperatura != null);
  const tMax = conTemp.length ? conTemp.reduce((a, b) => (b.temperatura > a.temperatura ? b : a)) : null;
  const tMin = conTemp.length ? conTemp.reduce((a, b) => (b.temperatura < a.temperatura ? b : a)) : null;
  // Caída brusca de temperatura (la llegada del frente de tormenta): lo más que bajó en 30 min.
  let caida = { grados: 0, t: null };
  for (let i = 0; i < conTemp.length; i++) for (let j = i + 1; j < conTemp.length && conTemp[j].t - conTemp[i].t <= ventanaCaida * MIN; j++) {
    const g = conTemp[i].temperatura - conTemp[j].temperatura;
    if (g > caida.grados) caida = { grados: g, t: conTemp[i].t };
  }
  const primeraLluvia = sinLluvia ? null : serie.find((r) => r.lluvia >= 0.2);
  const conViento = serie.filter((r) => r.viento != null);
  const viento = conViento.length ? conViento.reduce((a, b) => (b.viento > a.viento ? b : a)) : null;
  return {
    registros: serie.length, desde: serie[0].t, hasta: serie.at(-1).t,
    lluviaTotal: sinLluvia ? null : Math.round(lluviaTotal * 10) / 10,
    lluvia30: sinLluvia ? null : { mm: Math.round(max30.mm * 10) / 10, hora: max30.t ? hora(max30.t) : null },
    viento: viento ? { kmh: viento.viento, hora: hora(viento.t) } : null,
    rafaga: rafaga ? { kmh: rafaga.rafaga, hora: hora(rafaga.t) } : null,
    tMax: tMax ? { c: tMax.temperatura, hora: hora(tMax.t) } : null,
    tMin: tMin ? { c: tMin.temperatura, hora: hora(tMin.t) } : null,
    caida: caida.t ? { grados: Math.round(caida.grados * 10) / 10, hora: hora(caida.t), t: caida.t, minutos: ventanaCaida } : null,
    inicioLluvia: primeraLluvia ? hora(primeraLluvia.t) : null,
    sinViento: !conRafaga.length && !conViento.length, sinTemperatura: !conTemp.length, sinLluvia,
  };
}

const ESTACIONES = [
  ...Object.entries(INTA).map(([clave, e]) => ({ clave: `inta-${clave}`, red: "INTA", ...e, serie: serieInta })),
  ...Object.entries(SINARAME).map(([clave, e]) => ({ clave: `sinarame-${clave}`, red: "SiNaRaMe", ...e, serie: serieSinarame })),
  ...Object.entries(smnAbiertos.ESTACIONES).map(([nombreSmn, e]) => ({ ...e, clave: `smn-${e.clave}`, red: "SMN", nombreSmn, horaria: true, serie: serieSmn })),
];

/** Lo que emitió el SMN que estuvo vigente en la ventana (del historial guardado). */
async function avisosSmn(desde, hasta) {
  const store = require("./store");
  if (!store.usaPostgres()) return [];
  await store.init();
  const { rows } = await store.getPool().query(
    `SELECT fuente, datos FROM smn_historial WHERE recibido_en BETWEEN $1::timestamptz - interval '3 days' AND $2::timestamptz + interval '1 day' ORDER BY recibido_en`,
    [new Date(desde), new Date(hasta)]
  ).catch(() => ({ rows: [] }));
  const vistos = new Map();
  for (const { fuente, datos } of rows) for (const r of datos || []) for (const i of r.infos || []) {
    const ini = Date.parse(i.inicio), fin = Date.parse(i.fin);
    if (!(ini <= hasta && fin >= desde)) continue;
    const zonas = (i.zonas || []).map((z) => z.nombre).filter(Boolean).join(" · ");
    const clave = `${fuente}|${i.titulo}|${i.inicio}|${i.fin}|${zonas}`;
    if (!vistos.has(clave)) vistos.set(clave, { fuente, titulo: i.titulo, nivel: i.categoria === "ACP" ? null : i.categoria, inicio: i.inicio, fin: i.fin, zonas, emitidoEn: r.emitidoEn });
  }
  return [...vistos.values()].sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/** Lo que publicamos nosotros que estuvo vigente en la ventana. */
async function publicacionesPropias(desde, hasta) {
  const store = require("./store");
  if (!store.usaPostgres()) return { alertas: [], avisos: [] };
  await store.init();
  const p = store.getPool();
  const orden = { Verde: 0, Amarillo: 1, Naranja: 2, Rojo: 3 };
  const alertas = await p.query(
    `SELECT a.id, a.periodo, a.publicado_en, a.vigente_hasta, array_agg(d.categoria) AS categorias
       FROM alertas_meteo_publicaciones a LEFT JOIN alertas_meteo_publicacion_departamentos d ON d.publicacion_id = a.id
      WHERE a.publicado_en <= $2 AND a.vigente_hasta >= $1 GROUP BY a.id ORDER BY a.publicado_en`, [new Date(desde), new Date(hasta)]
  ).then((r) => r.rows.map((x) => ({ id: Number(x.id), periodo: x.periodo, publicadoEn: x.publicado_en.toISOString(), vigenteHasta: x.vigente_hasta?.toISOString() ?? null,
    nivel: (x.categorias || []).reduce((a, b) => ((orden[b] || 0) > (orden[a] || 0) ? b : a), "Verde") }))).catch(() => []);
  const avisos = await p.query(
    `SELECT id, texto, publicado_en, vigente_hasta, nivel_placa FROM avisos_corto_plazo WHERE publicado_en IS NOT NULL AND publicado_en <= $2 AND COALESCE(vigente_hasta, publicado_en) >= $1 ORDER BY publicado_en`, [new Date(desde), new Date(hasta)]
  ).then((r) => r.rows.map((x) => ({ id: Number(x.id), texto: x.texto, publicadoEn: x.publicado_en.toISOString(), vigenteHasta: x.vigente_hasta?.toISOString() ?? null, nivel: x.nivel_placa }))).catch(() => []);
  return { alertas, avisos };
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/, RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DIAS = 7; // cada día es un pedido por estación al INTA, al SNIH y al SMN
const fechaValida = (f) => RE_FECHA.test(f || "") && !Number.isNaN(Date.parse(`${f}T00:00:00-03:00`));
/** Días "AAAA-MM-DD" de `fecha` a `fechaHasta`, inclusive. */
function diasEntre(fecha, fechaHasta) {
  const dias = [];
  for (let t = Date.parse(`${fecha}T12:00:00Z`); t <= Date.parse(`${fechaHasta}T12:00:00Z`); t += 864e5) dias.push(new Date(t).toISOString().slice(0, 10));
  return dias;
}
/**
 * Rango del informe: desde `fecha` a las `desde` hasta `fechaHasta` (si no viene, el mismo día) a
 * las `hasta`, hora de Misiones. Ej.: ayer 00:00 → hoy 09:00.
 */
function errorDeConsulta({ fecha, fechaHasta = fecha, desde = "00:00", hasta = "23:59" } = {}) {
  if (!fechaValida(fecha)) return "Elegí el día de inicio.";
  if (!fechaValida(fechaHasta)) return "Elegí el día de fin.";
  if (!RE_HORA.test(desde) || !RE_HORA.test(hasta)) return "Revisá las horas.";
  if (instante(fechaHasta, hasta) <= instante(fecha, desde)) return "El inicio tiene que ser antes que el fin.";
  if (diasEntre(fecha, fechaHasta).length > MAX_DIAS) return `El rango puede ser de hasta ${MAX_DIAS} días.`;
  if (instante(fecha, desde) > Date.now()) return "Ese momento todavía no pasó.";
  return null;
}

/** Junta en una sola serie lo de cada día del rango (las fuentes se piden de a un día). */
async function serieDelRango(e, dias, t0, t1) {
  const partes = await Promise.all(dias.map((d) => e.serie(e, d, t0, t1).then((r) => ({ ...r, fecha: d }), (err) => ({ error: err, fecha: d }))));
  const ok = partes.filter((p) => !p.error);
  // Si fallan todos los días, falla la estación; si falla alguno (p. ej. el SMN de hoy, que todavía
  // no está), sigue con lo que hay y lo anota.
  if (!ok.length) throw partes[0].error;
  const porT = (a, b) => a.t - b.t;
  return {
    serie: ok.flatMap((p) => p.serie).sort(porT), crudo: ok.flatMap((p) => p.crudo).sort(porT), sinLluvia: ok.some((p) => p.sinLluvia),
    extremasPorDia: ok.some((p) => p.extremas !== undefined) ? dias.map((d) => ({ fecha: d, ...(ok.find((p) => p.fecha === d)?.extremas || { tmax: null, tmin: null }) })) : undefined,
    faltan: partes.filter((p) => p.error).map((p) => `${p.fecha.split("-").reverse().slice(0, 2).join("/")}: ${p.error.message}`),
  };
}

/** Junta todo para el rango (hora de Misiones). Las estaciones que fallan quedan con `error`. */
async function recolectar({ fecha, fechaHasta = fecha, desde = "00:00", hasta = "23:59" }) {
  const t0 = instante(fecha, desde), t1 = instante(fechaHasta, hasta) + 59 * 1000;
  const dias = diasEntre(fecha, fechaHasta), conDia = dias.length > 1;
  const estaciones = await Promise.all(ESTACIONES.map(async (e) => {
    const base = { clave: e.clave, red: e.red, nombre: e.nombre, lat: e.lat, lng: e.lng, ...(e.horaria && { horaria: true }) };
    try {
      const { serie, crudo, extremasPorDia, sinLluvia, faltan } = await serieDelRango(e, dias, t0, t1);
      // Extremas oficiales: la máxima y la mínima de los días del rango que el SMN ya publicó.
      const conEx = (extremasPorDia || []).filter((x) => x.tmax != null || x.tmin != null);
      const extremo = (k, f) => { const v = conEx.map((x) => x[k]).filter((n) => n != null); return v.length ? f(...v) : null; };
      const extremas = extremasPorDia ? (conEx.length ? { tmax: extremo("tmax", Math.max), tmin: extremo("tmin", Math.min) } : null) : undefined;
      return {
        ...base, resumen: resumir(serie, { sinLluvia, ventanaCaida: e.horaria ? 60 : 30, conDia }), ...(extremas !== undefined && { extremas, extremasPorDia }),
        ...(faltan.length && { avisoDatos: faltan.join(" · ") }),
        serie: serie.map((r) => ({ t: r.t, lluvia: sinLluvia ? null : r.lluvia, rafaga: r.rafaga, ...(r.viento !== undefined && { viento: r.viento }), temperatura: r.temperatura })), crudo,
      };
    } catch (err) { return { ...base, resumen: null, serie: [], crudo: [], error: err.message }; }
  }));
  const [smn, propias] = await Promise.all([avisosSmn(t0, t1), publicacionesPropias(t0, t1)]);
  return { fecha, fechaHasta, desde, hasta, consultadoEn: new Date().toISOString(), estaciones, smn, propias, resumenSugerido: redactar({ fecha, fechaHasta, desde, hasta, estaciones, smn }) };
}

const coma = (n) => String(n).replace(".", ",");
const fechaLarga = (fecha) => new Date(`${fecha}T12:00:00-03:00`).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "numeric", month: "long", year: "numeric" });

const fechaCorta = (fecha) => new Date(`${fecha}T12:00:00-03:00`).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "numeric", month: "long" });
/** "el sábado 3 de octubre de 2026, de 12:00 a 18:00 h" o "desde el viernes 2 de octubre a las 00:00 h hasta el sábado 3 de octubre de 2026 a las 09:00 h". */
function textoDelRango({ fecha, fechaHasta = fecha, desde, hasta }) {
  if (fechaHasta === fecha) return `del ${fechaLarga(fecha)}${desde !== "00:00" || hasta !== "23:59" ? `, de ${desde} a ${hasta} h` : ""}`;
  const mismoAnio = fecha.slice(0, 4) === fechaHasta.slice(0, 4);
  return `desde el ${mismoAnio ? fechaCorta(fecha) : fechaLarga(fecha)} a las ${desde} h hasta el ${fechaLarga(fechaHasta)} a las ${hasta} h`;
}
// "16:20" → "a las 16:20 h"; "03/10 16:20" → "el 03/10 a las 16:20 h".
const aLas = (h, desde = false) => { const [d, hh] = h.includes(" ") ? h.split(" ") : [null, h]; return `${d ? `el ${d} ` : ""}${desde ? "desde" : "a"} las ${hh} h`; };

/** Texto sugerido del informe (después se edita en la pantalla). */
function redactar({ fecha, fechaHasta = fecha, desde, hasta, estaciones, smn }) {
  const con = estaciones.filter((e) => e.resumen);
  const sinDatos = estaciones.filter((e) => !e.resumen).map((e) => e.nombre);
  const partes = [`Informe ${textoDelRango({ fecha, fechaHasta, desde, hasta })}, según las estaciones automáticas del INTA, de la red SiNaRaMe (INA) y del SMN.`];
  const conLluvia = con.filter((e) => !e.resumen.sinLluvia);
  const lluvias = conLluvia.filter((e) => e.resumen.lluviaTotal > 0).sort((a, b) => b.resumen.lluviaTotal - a.resumen.lluviaTotal);
  if (lluvias.length) {
    partes.push(`Llovió en ${lluvias.length} de ${conLluvia.length} estaciones con datos de lluvia. Los mayores registros: ${lluvias.slice(0, 3).map((e) => `${e.nombre} ${coma(e.resumen.lluviaTotal)} mm`).join(", ")}.`);
    const intensa = [...lluvias].sort((a, b) => b.resumen.lluvia30.mm - a.resumen.lluvia30.mm)[0];
    if (intensa?.resumen.lluvia30.mm >= 5) partes.push(`La lluvia más intensa fue en ${intensa.nombre}: ${coma(intensa.resumen.lluvia30.mm)} mm en 30 minutos ${aLas(intensa.resumen.lluvia30.hora, true)}.`);
  } else if (conLluvia.length) partes.push("No se registraron lluvias en las estaciones con datos de lluvia.");
  const frentes = con.filter((e) => e.resumen.caida && e.resumen.caida.grados >= 4).sort((a, b) => (a.resumen.caida.t ?? 0) - (b.resumen.caida.t ?? 0) || a.resumen.caida.hora.localeCompare(b.resumen.caida.hora));
  if (frentes.length) partes.push(`La llegada de la tormenta se marcó con caídas bruscas de temperatura: ${frentes.map((e) => `${e.nombre} ${aLas(e.resumen.caida.hora)} (−${coma(e.resumen.caida.grados)} °C en ${e.resumen.caida.minutos === 60 ? "una hora" : "30 min"})`).join("; ")}.`);
  const rafaga = con.filter((e) => e.resumen.rafaga).sort((a, b) => b.resumen.rafaga.kmh - a.resumen.rafaga.kmh)[0];
  if (rafaga) partes.push(`La ráfaga más fuerte se registró en ${rafaga.nombre}: ${coma(rafaga.resumen.rafaga.kmh)} km/h ${aLas(rafaga.resumen.rafaga.hora)}.`);
  const tMax = con.filter((e) => e.resumen.tMax).sort((a, b) => b.resumen.tMax.c - a.resumen.tMax.c)[0];
  const tMin = con.filter((e) => e.resumen.tMin).sort((a, b) => a.resumen.tMin.c - b.resumen.tMin.c)[0];
  if (tMax && tMin) partes.push(`Temperaturas: máxima de ${coma(tMax.resumen.tMax.c)} °C en ${tMax.nombre} y mínima de ${coma(tMin.resumen.tMin.c)} °C en ${tMin.nombre}.`);
  const oficiales = estaciones.filter((e) => e.extremas && (e.extremas.tmax != null || e.extremas.tmin != null));
  const maxMin = (x) => [x.tmax != null && `máx. ${coma(x.tmax)} °C`, x.tmin != null && `mín. ${coma(x.tmin)} °C`].filter(Boolean).join(" / ");
  if (oficiales.length && fechaHasta === fecha) partes.push(`Temperaturas extremas oficiales del SMN: ${oficiales.map((e) => `${e.nombre} ${maxMin(e.extremas)}`).join("; ")}.`);
  else if (oficiales.length) {
    // Varios días: las extremas son por día (el SMN no publica las de hoy hasta mañana).
    const porDia = diasEntre(fecha, fechaHasta).map((d) => {
      const del = oficiales.map((e) => ({ e, x: e.extremasPorDia?.find((x) => x.fecha === d) })).filter(({ x }) => x && (x.tmax != null || x.tmin != null));
      return del.length ? `${d.split("-").reverse().slice(0, 2).join("/")}: ${del.map(({ e, x }) => `${e.nombre} ${maxMin(x)}`).join("; ")}` : null;
    }).filter(Boolean);
    partes.push(`Temperaturas extremas oficiales del SMN — ${porDia.join(". ")}.`);
  }
  const sat = smn.filter((a) => a.fuente === "SAT"), acp = smn.filter((a) => a.fuente === "ACP");
  if (sat.length || acp.length) partes.push(`El SMN emitió ${[sat.length && `${sat.length} ${sat.length === 1 ? "alerta" : "alertas"} (${[...new Set(sat.map((a) => a.nivel).filter(Boolean))].join(", ").toLowerCase()})`, acp.length && `${acp.length} ${acp.length === 1 ? "aviso" : "avisos"} a muy corto plazo`].filter(Boolean).join(" y ")} para la provincia.`);
  if (sinDatos.length) partes.push(`Sin datos disponibles: ${sinDatos.join(", ")}.`);
  return partes.join("\n\n");
}

module.exports = { recolectar, errorDeConsulta, resumir, redactar, textoDelRango, diasEntre, ESTACIONES };
