/**
 * Eta 8 km del CPTEC/INPE (modelo regional de Sudamérica, corrida de las 00 UTC, un archivo GRIB2 por hora hasta las 264 h = 11 días).
 * Datos abiertos: https://dataserver.cptec.inpe.br/dataserver_modelos/eta/ams_08km/brutos/AAAA/MM/DD/00/
 *
 * Cada archivo pesa 80–90 MB, pero no se baja entero: junto a cada `.grib2` hay un `.grib2.idx` (índice de GrADS, enteros de 32 bits
 * little-endian) con el lugar de cada uno de sus 258 mensajes, y el servidor atiende pedidos de varios tramos de bytes. Por hora se piden sólo
 * los campos que usa el ensamble (T a 2 m, humedad a 2 m, viento a 10 m y lluvia: ≈2,4 MB), se desempaquetan con grib2.js y se leen en los 30 puntos.
 *
 * Para no bajar GB, la temperatura, la humedad y el viento se piden cada hora hasta las 72 h y cada 3 h después (se interpolan); la lluvia
 * (acumulado de 1 h) se pide TODAS las horas, porque no se puede interpolar. Total ≈ 360 MB por corrida, una vez por día.
 * No trae CAPE, ráfagas ni nubosidad total (sólo por capas): esas variables quedan sin dato.
 */
const { leerMensaje, identificar, valorEn } = require("./grib2");
const srv = require("./inpeServidor");
const S = require("./serieHoraria");

const DIR = `${srv.BASE}/eta/ams_08km/brutos`;
const HORAS = 264, HORA = 3600e3, CONCURRENCIA = Math.max(1, Number(process.env.ETA_CONCURRENCIA) || 4);
const RE_ARCHIVO = /^Eta_ams_08km_(\d{10})_(\d{10})\.grib2(\.idx)?$/;
// Qué campo es cada uno: disciplina 0, categoría/número de la tabla de GRIB2, tipo y valor del nivel (103 = metros sobre el suelo, 1 = superficie).
const CAMPOS = {
  t2m: { cat: 0, num: 0, tipo: 103, valor: 2 },
  hr2m: { cat: 1, num: 1, tipo: 103, valor: 2 },
  u10: { cat: 2, num: 2, tipo: 103, valor: 10 },
  v10: { cat: 2, num: 3, tipo: 103, valor: 10 },
  apcp: { cat: 1, num: 8, tipo: 1, proceso: 1, rango: 1 }, // lluvia total acumulada en la última hora
};
const esElCampo = (id, c) => id.categoria === c.cat && id.numero === c.num && id.nivelTipo === c.tipo && (c.valor == null || id.nivelValor === c.valor)
  && (c.proceso == null || (id.proceso === c.proceso && id.largoRangoHoras === c.rango));

const vigentes = { t: 0, run: null };
/** La corrida más reciente (de los últimos 5 días) ya completa: tiene el paso de las 264 h y su índice. → { init (ms), dir, archivos: Map(validoMs → nombre) } */
async function corridaVigente() {
  if (vigentes.run && Date.now() - vigentes.t < 20 * 60000) return vigentes.run;
  const hoy = new Date(); hoy.setUTCHours(0, 0, 0, 0);
  for (let k = 0; k < 5; k++) {
    const init = hoy.getTime() - k * 86400000, dir = srv.carpetaDelDia(DIR, init), nombres = await srv.listar(dir);
    if (!nombres) continue;
    const archivos = new Map(), conIndice = new Set();
    for (const n of nombres) {
      const m = RE_ARCHIVO.exec(n);
      if (!m || srv.msDeId(m[1]) !== init) continue;
      if (m[3]) conIndice.add(srv.msDeId(m[2])); else archivos.set(srv.msDeId(m[2]), n);
    }
    const ultimo = init + HORAS * HORA;
    if (!archivos.has(ultimo) || !conIndice.has(ultimo)) continue; // todavía se está generando (el índice se escribe al terminar cada archivo)
    vigentes.t = Date.now(); vigentes.run = { init, dir, archivos };
    return vigentes.run;
  }
  throw new Error("Eta 8 km: no se encontró ninguna corrida completa reciente.");
}

/** Lugar (byte) de cada mensaje de un archivo, según su `.grib2.idx`. */
async function leerIndice(url) {
  const r = await srv.pedir(`${url}.idx`, {}, 30000);
  if (!r.ok) throw new Error(`Eta 8 km: HTTP ${r.status} al leer el índice ${url.split("/").pop()}.idx.`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length % 4 || b.length < 24) throw new Error("Eta 8 km: el índice del archivo no tiene el formato esperado.");
  const v = new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); // little-endian en esta máquina (x86/ARM)
  const n = v[2];
  if (6 + 2 * n !== v.length) throw new Error("Eta 8 km: el índice del archivo no tiene el formato esperado.");
  return Array.from({ length: n }, (_, k) => v[6 + 2 * k]);
}

/** Largo en bytes de cada mensaje: hasta el comienzo del siguiente (el último, hasta el final del archivo). */
async function largosDe(url, offsets, necesarios) {
  const orden = [...offsets].sort((a, b) => a - b), sig = new Map(orden.map((o, i) => [o, orden[i + 1]]));
  let tamano = null;
  const largos = [];
  for (const o of necesarios) {
    let fin = sig.get(o);
    if (fin == null) { tamano ??= await srv.tamanoDe(url); fin = tamano; }
    largos.push(fin - o);
  }
  return largos;
}

const disenos = new Map(); // «init|cantidad de mensajes|campos» → promesa del diseño { campo → posición en el índice }
/**
 * Encuentra cuál es cada campo leyendo el encabezado de todos los mensajes de un archivo (≈7 pedidos de tramos). Los archivos de pronóstico tienen
 * todos el mismo diseño (258 mensajes); el de la hora 0 (el análisis) tiene otro, así que cada cantidad de mensajes se descubre una vez por corrida.
 */
function diseno(run, url, offsets, requeridos) {
  const clave = `${run.init}|${offsets.length}|${requeridos.join(",")}`; // cada combinación de campos pedidos se descubre aparte: el análisis (hora 0) no trae la lluvia
  if (!disenos.has(clave)) {
    disenos.set(clave, (async () => {
      const cabeceras = await srv.leerRangos(url, offsets.map((o) => [o, o + 219]));
      const d = {};
      cabeceras.forEach((b, k) => {
        let id; try { id = identificar(b); } catch { return; }
        for (const [campo, c] of Object.entries(CAMPOS)) if (d[campo] == null && esElCampo(id, c)) d[campo] = k;
      });
      const faltan = requeridos.filter((c) => d[c] == null);
      if (faltan.length) throw new Error(`Eta 8 km: no se encontraron los campos ${faltan.join(", ")} en ${url.split("/").pop()}.`);
      return d;
    })().catch((e) => { disenos.delete(clave); throw e; }));
  }
  return disenos.get(clave);
}

/** Los campos pedidos de un paso, interpolados en los `puntos` → { campo: Array(n puntos) de número|null }. */
async function leerPaso(run, validoMs, campos, puntos) {
  const url = run.dir + run.archivos.get(validoMs), offsets = await leerIndice(url);
  const d = await diseno(run, url, offsets, campos);
  const nombres = campos.filter((c) => d[c] != null), posiciones = nombres.map((c) => offsets[d[c]]);
  const largos = await largosDe(url, offsets, posiciones);
  const buffers = await srv.leerRangos(url, posiciones.map((o, i) => [o, o + largos[i] - 1]));
  const salida = {};
  nombres.forEach((c, i) => {
    if (buffers[i].length !== largos[i]) throw new Error(`Eta 8 km: llegó un mensaje de ${buffers[i].length} bytes y se esperaban ${largos[i]}.`);
    const m = leerMensaje(buffers[i]);
    if (!esElCampo(m, CAMPOS[c]) || m.ni !== 875 || m.nj !== 931) { disenos.clear(); throw new Error(`Eta 8 km: el archivo de ${new Date(validoMs).toISOString().slice(0, 13)}Z no tiene el diseño esperado (se va a redescubrir).`); }
    salida[c] = puntos.map((p) => { const x = valorEn(m, p.lat, p.lng); return x == null || !Number.isFinite(x) || Math.abs(x) > 1e8 ? null : x; });
  });
  return salida;
}

/** Los pasos que se leen y qué campos se piden en cada uno (ver la nota de arriba). */
function planDePasos() {
  const plan = [];
  for (let h = 0; h <= HORAS; h++) {
    const campos = [];
    if (h <= 72 || h % 3 === 0) campos.push("t2m", "hr2m", "u10", "v10");
    if (h >= 1) campos.push("apcp");
    if (campos.length) plan.push({ h, campos });
  }
  return plan;
}

/** Baja la corrida vigente para los `puntos` ([{ lat, lng }]) → { datos: { horas, puntos: [{ hourly }] }, corrida: ISO } con la forma de Open-Meteo. */
async function bajarEta(puntos, { alAvanzar } = {}) {
  const run = await corridaVigente(), plan = planDePasos(), t0 = Date.now();
  const lecturas = new Map(); // h → { campo → [valor por punto] }
  let hechos = 0;
  await srv.enParalelo(plan, CONCURRENCIA, async ({ h, campos }) => {
    lecturas.set(h, await leerPaso(run, run.init + h * HORA, campos, puntos));
    if (++hechos % 25 === 0) alAvanzar?.(hechos, plan.length, (Date.now() - t0) / 1000);
  });
  const { horas, ms } = S.horasDelRango();
  const muestras = (campo, p, convertir = (x) => x) => [...lecturas].filter(([, l]) => l[campo]).map(([h, l]) => ({ ms: run.init + h * HORA, v: l[campo][p] == null ? null : convertir(l[campo][p]) }));
  const salida = puntos.map((_, p) => {
    const t = S.interpolar(muestras("t2m", p, S.aCelsius), ms), hr = S.interpolar(muestras("hr2m", p), ms).map((x) => (x == null ? null : Math.min(100, Math.max(0, x))));
    const u = S.interpolar(muestras("u10", p), ms), v = S.interpolar(muestras("v10", p), ms);
    const lluvia = S.repartirAcumulado([...lecturas].filter(([, l]) => l.apcp).map(([h, l]) => ({ ms: run.init + h * HORA, mm: l.apcp[p], horas: 1 })), ms);
    return { hourly: {
      temperature_2m: t.map((x) => S.redondear(x, 1)),
      relative_humidity_2m: hr.map((x) => S.redondear(x, 0)),
      dew_point_2m: t.map((x, i) => S.redondear(S.puntoDeRocio(x, hr[i]), 1)),
      wind_speed_10m: u.map((x, i) => S.redondear(S.velocidadKmh(x, v[i]), 1)),
      wind_direction_10m: u.map((x, i) => S.redondear(S.direccionViento(x, v[i]), 0)),
      precipitation: lluvia.map((x) => S.redondear(x, 2)),
    } };
  });
  if (!salida.some((p) => p.hourly.temperature_2m.some((x) => x != null))) throw new Error("Eta 8 km: no se pudo leer ninguna temperatura.");
  return { datos: { horas, puntos: salida }, corrida: new Date(run.init).toISOString(), duracionMs: Date.now() - t0 };
}

module.exports = { bajarEta, corridaVigente, planDePasos, leerPaso, CAMPOS, HORAS };
