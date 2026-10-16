/**
 * BAM 20 km del CPTEC/INPE (modelo global, corrida de las 00 UTC, un archivo GRIB1 cada 6 h hasta las 264 h = 11 días).
 * Datos abiertos: https://dataserver.cptec.inpe.br/dataserver_modelos/bam/TQ0666L064/brutos/AAAA/MM/DD/00/
 *
 * Cada archivo pesa 1,5 GB, pero va con un `.inv` (lista de texto de sus mensajes con el byte donde empieza cada uno) y los valores están sin
 * comprimir en 16 bits: un punto se lee con 2 bytes (ver grib1.js). Por paso se piden ≈360 tramos de unos pocos bytes (6 campos × 30 puntos × 2 filas).
 *
 * Sólo da un dato cada 6 horas: lo instantáneo (temperatura, viento, humedad, CAPE) se interpola hora a hora, y la lluvia (acumulado de 6 h)
 * se reparte pareja entre esas 6 horas. La máxima y la mínima del día salen de esa curva suavizada: quedan algo subestimadas (la máxima) y
 * sobreestimada (la mínima) respecto de la real. No trae ráfagas ni nubosidad total.
 */
const { leerEncabezado, planDePunto, interpolar: interpolarPunto, BYTES_ENCABEZADO } = require("./grib1");
const srv = require("./inpeServidor");
const S = require("./serieHoraria");

const DIR = `${srv.BASE}/bam/TQ0666L064/brutos`;
const HORAS = 264, HORA = 3600e3, PASO_H = 6, CONCURRENCIA = Math.max(1, Number(process.env.BAM_CONCURRENCIA) || 6);
const RE_ARCHIVO = /^GPOSNMC(\d{10})(\d{10})P\.fct\.TQ0666L064\.(grb|inv)$/;
// Cada campo se reconoce por su nombre y su nivel en el `.inv` (el modelo usa nombres cortos propios).
const CAMPOS = {
  t2m: { nombre: "tp2m", nivel: "2 m above gnd" },     // temperatura a 2 m (K)
  td2m: { nombre: "dp2m", nivel: "2 m above gnd" },    // punto de rocío a 2 m (K)
  u10: { nombre: "u10m", nivel: "10 m above gnd" },    // viento este-oeste a 10 m (m/s)
  v10: { nombre: "v10m", nivel: "10 m above gnd" },    // viento norte-sur a 10 m (m/s)
  prec: { nombre: "prec", nivel: "sfc", acumulado: true }, // lluvia acumulada en las últimas 6 h (mm)
  cape: { nombre: "cape", nivel: "atmos col" },        // energía potencial convectiva disponible (J/kg)
};

const vigentes = { t: 0, run: null };
/** La corrida más reciente (de los últimos 5 días) ya completa: tiene el paso de las 264 h con su `.inv`. → { init (ms), dir, archivos: Map(validoMs → { grb, inv }) } */
async function corridaVigente() {
  if (vigentes.run && Date.now() - vigentes.t < 20 * 60000) return vigentes.run;
  const hoy = new Date(); hoy.setUTCHours(0, 0, 0, 0);
  for (let k = 0; k < 5; k++) {
    const init = hoy.getTime() - k * 86400000, dir = srv.carpetaDelDia(DIR, init), nombres = await srv.listar(dir);
    if (!nombres) continue;
    const archivos = new Map();
    for (const n of nombres) {
      const m = RE_ARCHIVO.exec(n);
      if (!m || srv.msDeId(m[1]) !== init) continue;
      const v = srv.msDeId(m[2]), a = archivos.get(v) || {};
      a[m[3]] = n; archivos.set(v, a);
    }
    const ultimo = archivos.get(init + HORAS * HORA);
    if (!ultimo?.grb || !ultimo?.inv) continue; // todavía se está generando
    vigentes.t = Date.now(); vigentes.run = { init, dir, archivos };
    return vigentes.run;
  }
  throw new Error("BAM: no se encontró ninguna corrida completa reciente.");
}

/** Dónde está cada campo en el archivo, según su `.inv`: { campo → { offset, horasAcum } }. */
async function leerInventario(run, validoMs) {
  const r = await srv.pedir(run.dir + run.archivos.get(validoMs).inv, {}, 60000);
  if (!r.ok) throw new Error(`BAM: HTTP ${r.status} al leer el inventario de ${new Date(validoMs).toISOString().slice(0, 13)}Z.`);
  const filas = (await r.text()).split("\n").map((l) => l.trim().split(":")).filter((f) => f.length > 8);
  const salida = {};
  for (const [campo, c] of Object.entries(CAMPOS)) {
    const f = filas.find((x) => x[3] === c.nombre && x.at(-3) === c.nivel);
    if (!f) continue;
    let horasAcum = null;
    if (c.acumulado) { const m = /^(\d+)-(\d+)hr acc$/.exec(f.at(-2)); if (!m) continue; horasAcum = +m[2] - +m[1]; }
    salida[campo] = { offset: Number(f[1]), horasAcum };
  }
  return salida;
}

/** Los campos de un paso en cada punto → { campo: Array(n puntos) de número|null, horasAcum: {prec} }. */
async function leerPaso(run, validoMs, puntos) {
  const url = run.dir + run.archivos.get(validoMs).grb, inv = await leerInventario(run, validoMs), campos = Object.keys(inv);
  const cabeceras = await srv.leerRangos(url, campos.map((c) => [inv[c].offset, inv[c].offset + BYTES_ENCABEZADO - 1]));
  const enc = cabeceras.map((b) => { if (b.length < BYTES_ENCABEZADO) throw new Error("BAM: encabezado de mensaje incompleto."); return leerEncabezado(b); });
  enc.forEach((e, k) => { if (e.ni !== 2000 || e.nj !== 1000) throw new Error(`BAM: el campo ${campos[k]} no tiene la rejilla esperada (${e.ni}×${e.nj}).`); });
  // Todos los tramos del paso (2 filas por punto y campo) en una sola lista, para pedirlos juntos.
  const planes = enc.map((e) => puntos.map((p) => planDePunto(e, p.lat, p.lng)));
  const rangos = [], donde = [];
  campos.forEach((c, k) => planes[k].forEach((plan, p) => { if (!plan) return; for (const [a, b] of plan.rangos) { rangos.push([inv[c].offset + a, inv[c].offset + b]); donde.push([k, p]); } }));
  const tramos = await srv.leerRangos(url, rangos);
  const salida = Object.fromEntries(campos.map((c) => [c, new Array(puntos.length).fill(null)]));
  const juntos = new Map(); // «k|p» → [fila norte, fila sur]
  donde.forEach(([k, p], i) => { const clave = `${k}|${p}`; if (!juntos.has(clave)) juntos.set(clave, []); juntos.get(clave).push(tramos[i]); });
  for (const [clave, par] of juntos) {
    const [k, p] = clave.split("|").map(Number), x = interpolarPunto(enc[k], planes[k][p], par);
    salida[campos[k]][p] = Number.isFinite(x) && Math.abs(x) < 1e8 ? x : null;
  }
  salida.horasAcum = inv.prec?.horasAcum ?? null;
  return salida;
}

/** Baja la corrida vigente para los `puntos` ([{ lat, lng }]) → { datos: { horas, puntos: [{ hourly }] }, corrida: ISO } con la forma de Open-Meteo. */
async function bajarBam(puntos, { alAvanzar } = {}) {
  const run = await corridaVigente(), t0 = Date.now(), pasos = [];
  for (let h = 0; h <= HORAS; h += PASO_H) if (run.archivos.get(run.init + h * HORA)?.grb) pasos.push(h);
  const lecturas = new Map();
  let hechos = 0;
  await srv.enParalelo(pasos, CONCURRENCIA, async (h) => {
    lecturas.set(h, await leerPaso(run, run.init + h * HORA, puntos));
    if (++hechos % 5 === 0) alAvanzar?.(hechos, pasos.length, (Date.now() - t0) / 1000);
  });
  const { horas, ms } = S.horasDelRango();
  const muestras = (campo, p, convertir = (x) => x) => [...lecturas].filter(([, l]) => l[campo]).map(([h, l]) => ({ ms: run.init + h * HORA, v: l[campo][p] == null ? null : convertir(l[campo][p]) }));
  const salida = puntos.map((_, p) => {
    const t = S.interpolar(muestras("t2m", p, S.aCelsius), ms), td = S.interpolar(muestras("td2m", p, S.aCelsius), ms);
    const u = S.interpolar(muestras("u10", p), ms), v = S.interpolar(muestras("v10", p), ms), cape = S.interpolar(muestras("cape", p), ms);
    const lluvia = S.repartirAcumulado([...lecturas].filter(([, l]) => l.prec && l.horasAcum).map(([h, l]) => ({ ms: run.init + h * HORA, mm: l.prec[p], horas: l.horasAcum })), ms);
    return { hourly: {
      temperature_2m: t.map((x) => S.redondear(x, 1)),
      dew_point_2m: td.map((x, i) => S.redondear(x == null || t[i] == null ? x : Math.min(x, t[i]), 1)),
      relative_humidity_2m: t.map((x, i) => S.redondear(S.humedadRelativa(x, td[i]), 0)),
      wind_speed_10m: u.map((x, i) => S.redondear(S.velocidadKmh(x, v[i]), 1)),
      wind_direction_10m: u.map((x, i) => S.redondear(S.direccionViento(x, v[i]), 0)),
      precipitation: lluvia.map((x) => S.redondear(x, 2)),
      cape: cape.map((x) => (x == null ? null : Math.max(0, Math.round(x)))),
    } };
  });
  if (!salida.some((p) => p.hourly.temperature_2m.some((x) => x != null))) throw new Error("BAM: no se pudo leer ninguna temperatura.");
  return { datos: { horas, puntos: salida }, corrida: new Date(run.init).toISOString(), duracionMs: Date.now() - t0 };
}

module.exports = { bajarBam, corridaVigente, leerPaso, leerInventario, CAMPOS, HORAS };
