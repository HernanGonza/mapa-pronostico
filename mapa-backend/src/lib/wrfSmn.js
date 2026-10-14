/**
 * WRF-SMN: el modelo regional del Servicio Meteorológico Nacional (WRF 4.0, 4 km, hasta
 * 72 h, 4 corridas por día: 00/06/12/18 UTC), leído del bucket público `smn-ar-wrf` de AWS Open Data
 * (https://registry.opendata.aws/smn-ar-wrf-dataset/, licencia CC BY 2.5 Argentina). Documentación:
 * https://odp-aws-smn.github.io/documentation_wrf_det
 *
 * Cada archivo NetCDF4 cubre todo el dominio (≈37 MB por hora), pero sólo hacen falta 17 puntos y una o dos
 * variables, y cada variable es un único bloque comprimido (≈2 MB). Por eso no se baja el archivo: se lo abre
 * con h5wasm sobre una copia «rala» en memoria y, cada vez que HDF5 pide un trozo que todavía no se trajo,
 * se lo pide a S3 con Range y se reintenta (`leerRala`). Lo extraído se guarda en caché por corrida.
 *
 * Qué aporta (el PDF de modelos de Misiones lo marca como el clave para tormentas):
 *   - lluvia: PP horaria (01H), la misma ventana de «hora anterior» que usa Open-Meteo.
 *   - tmax / tmin: las del producto diario 24H, calibradas con observaciones — Tmin 00–12 UTC y Tmax 12–24 UTC
 *     (o sea, 21–09 h y 09–21 h de Misiones) de cada día.
 *   - humedad (hmin/hmax): HR2 horaria (01H), mínima y máxima del día.
 *   - viento y dirección: magViento10 (m/s → km/h) y dirViento10 horarios (01H).
 *   No publica ráfagas, nubosidad, sensación térmica ni punto de rocío: en esas variables el WRF queda sin dato.
 *
 * Lo lento es la red (≈1,5 s de latencia por vuelta y ≈0,3 MB/s por conexión), por eso se baja en paralelo,
 * se juntan vueltas pidiendo un margen alrededor de cada trozo y no se repite nada ya bajado. Con
 * WRF_PRECARGA=1 el servidor deja lista cada corrida en segundo plano (ver `precargar`).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "https://smn-ar-wrf.s3.us-west-2.amazonaws.com/DATA/WRF/DET";
const HORAS_MAX = 72;
// De cada archivo horario: PP (lluvia de la hora anterior, mm), HR2 (humedad relativa a 2 m, %), magViento10 (viento a
// 10 m, m/s) y dirViento10 (dirección, °). Cada una es un bloque de ≈2–4 MB: en total ≈12 MB por hora de pronóstico
// (≈0,9 GB por corrida de 72 h). Por eso se baja en segundo plano, una vez por corrida (ver `precargar`).
const VARIABLES_HORARIAS = ["PP", "HR2", "magViento10", "dirViento10"];
// T2 (temperatura a 2 m, °C) sólo se baja cuando se pide un intervalo menor al día: para el día alcanzan las Tmax/Tmin calibradas.
const VARIABLE_TEMPERATURA = "T2";
const claveDe = (frec, variable, plazo) => `${frec}|${variable}|${plazo}`;
// Cada archivo abierto ocupa ≈37 MB de memoria mientras se lee: más conexiones bajan más rápido pero pesan más.
const CONCURRENCIA = Math.max(1, Number(process.env.WRF_CONCURRENCIA) || 6);
const TIMEOUT_MS = 60000;
const MARGEN = 64 * 1024; // alrededor de cada trozo chico de metadatos se pide de más: ahorra vueltas.
const DIR_CACHE = path.join(os.tmpdir(), "wrf-smn-cache");
const GRILLA_JSON = path.join(__dirname, "..", "..", "data", "wrf-smn-grilla.json");

const pad = (n, l = 2) => String(n).padStart(l, "0");
const urlArchivo = (init, frec, plazo) => {
  const y = init.getUTCFullYear(), m = pad(init.getUTCMonth() + 1), d = pad(init.getUTCDate()), h = pad(init.getUTCHours());
  return `${BASE}/${y}/${m}/${d}/${h}/WRFDETAR_${frec}_${y}${m}${d}_${h}_${pad(plazo, 3)}.nc`;
};
const idCorrida = (init) => init.toISOString().slice(0, 13).replace(/[-T]/g, "");
const stampAMs = (stamp) => Date.parse(`${stamp}:00-03:00`); // «AAAA-MM-DDTHH:MM» hora de Misiones.
const sumarDia = (dia) => new Date(Date.parse(`${dia}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

async function pedir(url, opciones = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...opciones, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
const existe = async (url) => { try { return (await pedir(url, { method: "HEAD" })).ok; } catch { return false; } };

let h5 = null;
async function cargarH5() {
  if (!h5) {
    const m = await import("h5wasm"), modulo = await m.default.ready;
    h5 = { File: m.default.File, FS: modulo.FS };
    // Mientras se arma la copia rala HDF5 «falla» a propósito en cada vuelta y escribe el diagnóstico por la
    // salida de error: se lo filtra para no llenar el log (todo lo demás pasa igual).
    const escribir = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...resto) => (/HDF5-DIAG|^\s+#\d{3}: |^\s+(major|minor): /.test(String(chunk)) ? true : escribir(chunk, ...resto));
  }
  return h5;
}

/** Une los intervalos [a, b) que se tocan o se pisan. */
function unir(intervalos) {
  const orden = intervalos.slice().sort((x, y) => x[0] - y[0]), salida = [];
  for (const [a, b] of orden) { const u = salida.at(-1); if (u && a <= u[1]) u[1] = Math.max(u[1], b); else salida.push([a, b]); }
  return salida;
}

/**
 * Abre el NetCDF remoto y ejecuta `fn(file)` (síncrono) trayendo de S3 sólo los trozos que HDF5 va pidiendo.
 * Devuelve lo que devuelva `fn`. Si el archivo no está publicado, lanza un error con `noEsta`.
 */
async function leerRala(url, fn) {
  const lib = await cargarH5(), FS = lib.FS;
  const nombre = url.split("/").pop();
  // El primer trozo trae los metadatos y, en Content-Range, el tamaño total (así no hace falta un HEAD).
  const r0 = await pedir(url, { headers: { Range: `bytes=0-${MARGEN - 1}` } });
  if (r0.status === 404 || r0.status === 403) throw Object.assign(new Error(`WRF-SMN: ${nombre} no está publicado.`), { noEsta: true });
  if (!r0.ok) throw new Error(`WRF-SMN: HTTP ${r0.status} al leer ${nombre}.`);
  const size = Number(/\/(\d+)$/.exec(r0.headers.get("content-range") || "")?.[1] || r0.headers.get("content-length"));
  const primero = new Uint8Array(await r0.arrayBuffer());

  // Una sola copia en memoria: se crea el archivo del tamaño real (todo ceros) y se van escribiendo los trozos.
  const ruta = `/wrf-${process.hrtime.bigint()}.nc`;
  FS.writeFile(ruta, new Uint8Array(0)); FS.truncate(ruta, size);
  const flujo = FS.open(ruta, "r+");
  let llenos = [];
  const escribir = (a, datos) => { FS.write(flujo, datos, 0, datos.length, a); llenos = unir([...llenos, [a, a + datos.length]]); };
  const cubierto = (a, b) => llenos.some(([x, y]) => a >= x && b <= y);
  escribir(0, primero.subarray(0, Math.min(primero.length, size)));

  let pedidos = [];
  const node = FS.lookupPath(ruta).node, orig = node.stream_ops.read;
  node.stream_ops.read = (stream, buf, off, len, pos) => { pedidos.push([pos, Math.min(pos + len, size)]); return orig(stream, buf, off, len, pos); };
  try {
    for (let vuelta = 0; vuelta < 30; vuelta++) {
      pedidos = [];
      let resultado, error;
      try { const f = new lib.File(ruta, "r"); try { resultado = fn(f); } finally { f.close(); } } catch (e) { error = e; }
      const faltan = unir(pedidos.filter(([a, b]) => b > a && !cubierto(a, b)));
      if (!error && !faltan.length) return resultado;
      if (!faltan.length) throw error;
      // Los trozos chicos (metadatos) se piden con margen; el bloque grande de datos, justo.
      const aPedir = unir(faltan.map(([a, b]) => (b - a < 256 * 1024 ? [Math.max(0, a - MARGEN), Math.min(size, b + MARGEN)] : [a, b])));
      await Promise.all(aPedir.map(async ([a, b]) => {
        const r = await pedir(url, { headers: { Range: `bytes=${a}-${b - 1}` } });
        if (!r.ok) throw new Error(`WRF-SMN: HTTP ${r.status} al leer ${nombre}.`);
        escribir(a, new Uint8Array(await r.arrayBuffer()));
      }));
    }
    throw new Error(`WRF-SMN: no se pudo leer ${nombre} (demasiadas vueltas).`);
  } finally { try { FS.close(flujo); FS.unlink(ruta); } catch { /* ya no estaba */ } }
}

/**
 * Valor de cada variable de `variables` en cada celda `celdas` ([fila, columna]) — la primera (y única) capa de
 * tiempo —, leídas en una sola apertura del archivo (las vueltas de red de los metadatos se comparten).
 * Devuelve { variable: [valor por celda] }.
 */
const leerVarias = (url, variables, celdas, ncols = 999) => leerRala(url, (f) => Object.fromEntries(variables.map((variable) => {
  // Hay archivos que no traen la variable a propósito: el diario del día 0 de las corridas de 06/12 UTC no tiene
  // Tmin (su ventana, 00–12 UTC, ya pasó) y el del día 3 no tiene Tmax. No es un error: sin dato.
  const dataset = f.get(variable);
  if (!dataset) return [variable, celdas.map(() => null)];
  const v = dataset.value;
  return [variable, celdas.map(([j, i]) => { const x = v[j * ncols + i]; return Number.isFinite(x) && Math.abs(x) < 1e10 ? x : null; })];
})));

/** Celda más cercana de la grilla a cada punto {lat, lng}. La grilla no cambia: se calcula una vez y se guarda. */
async function celdasDe(puntos, init) {
  const clave = puntos.map((p) => `${p.lat},${p.lng}`).join(";");
  try { const g = JSON.parse(fs.readFileSync(GRILLA_JSON, "utf8")); if (g.clave === clave) return g.celdas; } catch { /* no hay o es de otros puntos */ }
  // El diario del día 1 existe en todas las corridas (el del día 0 no está en la de las 18 UTC).
  const celdas = await leerRala(urlArchivo(init, "24H", 1), (f) => {
    const lat = f.get("lat").value, lon = f.get("lon").value, n = 999;
    return puntos.map((p) => {
      let mejor = Infinity, idx = 0; const k = Math.cos((p.lat * Math.PI) / 180);
      for (let c = 0; c < lat.length; c++) { const d = (lat[c] - p.lat) ** 2 + ((lon[c] - p.lng) * k) ** 2; if (d < mejor) { mejor = d; idx = c; } }
      return [Math.floor(idx / n), idx % n];
    });
  });
  try { fs.writeFileSync(GRILLA_JSON, JSON.stringify({ clave, celdas })); } catch { /* sólo es una optimización */ }
  return celdas;
}

/** La corrida más reciente que ya terminó de publicarse (tiene el plazo 72 h horario y el 2.º día). */
let vigente = null;
async function corridaVigente() {
  if (vigente && Date.now() - vigente.t < 20 * 60000) return vigente.init;
  const ahora = new Date(); ahora.setUTCMinutes(0, 0, 0); ahora.setUTCHours(Math.floor(ahora.getUTCHours() / 6) * 6);
  for (let k = 0; k < 8; k++) {
    const init = new Date(ahora.getTime() - k * 6 * 3600000);
    if (await existe(urlArchivo(init, "01H", HORAS_MAX)) && await existe(urlArchivo(init, "24H", 2))) { vigente = { t: Date.now(), init }; return init; }
  }
  throw new Error("WRF-SMN: no se encontró ninguna corrida completa reciente.");
}

// Caché por corrida (memoria + archivo en tmp): { "01H|PP|12": [17 valores], "24H|Tmax|1": [...] }.
const memoria = new Map();
function cacheDe(id) {
  if (!memoria.has(id)) { let d = {}; try { d = JSON.parse(fs.readFileSync(path.join(DIR_CACHE, `${id}.json`), "utf8")); } catch { /* vacía */ } memoria.set(id, d); }
  return memoria.get(id);
}
function guardarCache(id) {
  try {
    fs.mkdirSync(DIR_CACHE, { recursive: true }); fs.writeFileSync(path.join(DIR_CACHE, `${id}.json`), JSON.stringify(memoria.get(id)));
    const limite = idCorrida(new Date(Date.now() - 3 * 86400000)); // las corridas de más de 3 días ya no sirven.
    for (const f of fs.readdirSync(DIR_CACHE)) if (f.slice(0, 10) < limite) fs.unlinkSync(path.join(DIR_CACHE, f));
  } catch { /* no es grave */ }
}

async function enParalelo(trabajos, n, hacer) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, trabajos.length) }, async () => { while (i < trabajos.length) await hacer(trabajos[i++]); }));
}

// Avance de lo que se está bajando (lo lee la pantalla mientras dura la consulta).
const avance = { total: 0, hechos: 0, corrida: null };
let trabajosActivos = 0; // consultas del WRF que todavía están bajando (aunque sea sólo la grilla)
const progreso = () => ({ activo: trabajosActivos > 0, ...avance });
const enCurso = new Map(); // «corrida|archivo|variable» → promesa: dos consultas a la vez no bajan lo mismo dos veces.

/**
 * Lo que dice el WRF-SMN en cada punto para el rango [desde, hasta] («AAAA-MM-DDTHH:MM», hora de Misiones).
 * Devuelve { corrida, porHora: { PP|HR2|magViento10|dirViento10 (y T2 si `temperatura`): Map(stamp → [valor por punto]) }, diario: { tmax: Map(fecha → […]), tmin: … } };
 * lo que no cubre el modelo (más de 72 h, o un archivo que no está) simplemente no figura.
 */
async function wrfSmn({ desde, hasta, puntos, temperatura = false }) {
  const horarias = temperatura ? [...VARIABLES_HORARIAS, VARIABLE_TEMPERATURA] : VARIABLES_HORARIAS;
  const init = await corridaVigente(), id = `${idCorrida(init)}-p${puntos.length}`, cache = cacheDe(id); // las lecturas se guardan por posición: otra lista de puntos, otra caché
  const celdas = await celdasDe(puntos, init);
  const initMs = init.getTime();

  // Horas del rango → plazo del archivo horario (la lluvia de la «hora anterior» a cada hora de Misiones).
  const horas = [];
  for (let dia = desde.slice(0, 10); dia <= hasta.slice(0, 10); dia = sumarDia(dia)) {
    for (let h = 0; h < 24; h++) {
      const stamp = `${dia}T${pad(h)}:00`, plazo = (stampAMs(stamp) - initMs) / 3600000;
      if (stamp >= desde && stamp <= hasta && plazo >= 1 && plazo <= HORAS_MAX) horas.push({ stamp, plazo });
    }
  }
  // Un día (UTC) del archivo diario → Tmin/Tmax de ese día de Misiones; sólo si el rango cubre su ventana.
  const initDia = Date.UTC(init.getUTCFullYear(), init.getUTCMonth(), init.getUTCDate());
  const dias = [];
  for (let dia = desde.slice(0, 10); dia <= hasta.slice(0, 10); dia = sumarDia(dia)) {
    const d = Math.round((Date.parse(`${dia}T00:00:00Z`) - initDia) / 86400000);
    if (d >= 0 && d <= 3) dias.push({ fecha: dia, plazo: d, tmin: desde <= `${dia}T00:00` && hasta >= `${dia}T09:00`, tmax: desde <= `${dia}T09:00` && hasta >= `${dia}T21:00` });
  }

  // Un trabajo = un archivo con las variables que todavía no están en caché.
  const trabajos = [
    ...horas.map((h) => ({ frec: "01H", plazo: h.plazo, variables: horarias })),
    ...dias.map((d) => ({ frec: "24H", plazo: d.plazo, variables: [d.tmin && "Tmin", d.tmax && "Tmax"].filter(Boolean) })),
  ].map((t) => ({ ...t, url: urlArchivo(init, t.frec, t.plazo), variables: t.variables.filter((v) => !cache[claveDe(t.frec, v, t.plazo)]) })).filter((t) => t.variables.length);
  const avisos = [];
  if (trabajos.length) {
    if (trabajosActivos <= 1) Object.assign(avance, { total: 0, hechos: 0 }); // arranca una tanda nueva
    avance.corrida = init.toISOString(); avance.total += trabajos.length;
    let desdeGuardado = 0;
    await enParalelo(trabajos, CONCURRENCIA, async (t) => {
      const k = `${id}|${t.frec}|${t.plazo}|${t.variables.join("+")}`;
      if (!enCurso.has(k)) {
        enCurso.set(k, (async () => {
          for (let intento = 0; intento < 3; intento++) { // un corte de red no tiene que tirar toda la consulta
            try {
              const valores = await leerVarias(t.url, t.variables, celdas);
              for (const v of t.variables) cache[claveDe(t.frec, v, t.plazo)] = valores[v];
              return;
            } catch (e) { if (e.noEsta) return; if (intento === 2) avisos.push(e.message); }
          }
        })().finally(() => enCurso.delete(k)));
      }
      await enCurso.get(k);
      avance.hechos++;
      if (++desdeGuardado % 8 === 0) guardarCache(id); // si se corta, no se pierde lo ya bajado
    });
    guardarCache(id);
  }

  // Valor por punto de cada variable horaria, hora a hora (clave «AAAA-MM-DDTHH:00», hora de Misiones).
  const porHora = Object.fromEntries(horarias.map((v) => [v, new Map()])), diario = { tmax: new Map(), tmin: new Map() };
  for (const h of horas) for (const v of horarias) if (cache[claveDe("01H", v, h.plazo)]) porHora[v].set(h.stamp, cache[claveDe("01H", v, h.plazo)]);
  for (const d of dias) {
    if (d.tmax && cache[claveDe("24H", "Tmax", d.plazo)]) diario.tmax.set(d.fecha, cache[claveDe("24H", "Tmax", d.plazo)]);
    if (d.tmin && cache[claveDe("24H", "Tmin", d.plazo)]) diario.tmin.set(d.fecha, cache[claveDe("24H", "Tmin", d.plazo)]);
  }
  return { corrida: init.toISOString(), porHora, diario, avisos: [...new Set(avisos)] };
}

const enFondo = new Map(); // «rango» → promesa de la consulta en marcha
/**
 * Igual que `wrfSmn`, pero sin trabar al que pregunta: la consulta corre en segundo plano y se la espera
 * `esperaMs`. Si termina (lo normal cuando la corrida ya está en caché) devuelve los datos; si no,
 * `{ pendiente: true }` y sigue bajando: al repetir la consulta se la encuentra lista. Una consulta que dura
 * minutos en un solo pedido HTTP no sobrevive a los proxies que hay entre el navegador y el servidor.
 */
async function wrfConEspera(args, esperaMs = 8000) {
  const k = `${args.desde}|${args.hasta}|${args.temperatura ? "T" : ""}`;
  let trabajo = enFondo.get(k);
  if (!trabajo) {
    trabajosActivos++;
    trabajo = wrfSmn(args);
    enFondo.set(k, trabajo);
    trabajo.catch((e) => console.error("[WRF-SMN]", e.message)).finally(() => { enFondo.delete(k); trabajosActivos--; });
  }
  let timer;
  const r = await Promise.race([trabajo, new Promise((res) => { timer = setTimeout(() => res(null), esperaMs); })]).finally(() => clearTimeout(timer));
  return r || { pendiente: true, progreso: progreso() };
}

/** Baja (o completa en caché) todo lo que cubre el rango, contando como trabajo activo para `progreso()`; devuelve lo mismo que `wrfSmn`. */
async function wrfCompleto(args) {
  trabajosActivos++;
  try { return await wrfSmn(args); } finally { trabajosActivos--; }
}

/** Deja en caché las 72 h de la corrida vigente (lluvia + temperaturas diarias), para que las consultas sean instantáneas. */
async function precargar(puntos) {
  const init = await corridaVigente(), dia = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const desde = `${dia(init.getTime())}T00:00`, hasta = `${dia(init.getTime() + 4 * 86400000)}T23:00`;
  return wrfConEspera({ desde, hasta, puntos }, 0).then(() => enFondo.get(`${desde}|${hasta}|`));
}

module.exports = { wrfSmn, wrfCompleto, wrfConEspera, corridaVigente, leerRala, progreso, precargar };
