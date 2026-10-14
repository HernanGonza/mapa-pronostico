/**
 * MONAN (Model for Ocean-laNd-Atmosphere predictioN) del CPTEC/INPE (Brasil), leído de sus datos abiertos:
 *   https://dataserver.cptec.inpe.br/dataserver_modelos/monan/{03km|10km}/brutos/AAAA/MM/DD/00/
 * Hay dos productos, los dos con una sola corrida por día (00 UTC, condiciones iniciales del GFS):
 *   - 03km: regional de Brasil (lat -42…11, lon -77…-31; cubre Misiones), horario hasta 72 h. Es el único del
 *     ensamble con ráfagas, CAPE, reflectividad de radar y helicidad de ascenso (tormentas severas).
 *   - 10km: global, cada 3 h hasta 264 h (11 días), con nubosidad.
 * Usar estos datos obliga a citar la fuente (CPTEC/INPE).
 *
 * Cada archivo NetCDF4 pesa entre 3 y 4 GB, pero no está comprimido: el valor de un punto está en una posición exacta
 * del archivo y se lee con un pedido Range de 4 bytes (el servidor acepta varios rangos en un solo pedido). Así una
 * corrida entera, para los 30 puntos del ensamble, son unos pocos cientos de KB en vez de unos 230 GB.
 * La posición de cada variable dentro del archivo (el «diseño») se descubre sola: se abre el archivo con h5wasm sobre
 * una copia rala en disco, trayendo de a trozos sólo los metadatos que HDF5 pide y anotando dónde lee los bloques de
 * datos (que no se traen). Se guarda por tamaño de archivo: si el CPTEC cambia el contenido, el tamaño cambia y el
 * diseño se vuelve a descubrir (el 3 km ya cambió una vez, entre el 30/09 y el 12/10 de 2026).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "https://dataserver.cptec.inpe.br/dataserver_modelos/monan";
const PRODUCTOS = {
  "03km": { paso: 3600e3, horas: 72, variables: ["t2m", "q2", "surface_pressure", "u10", "v10", "gust10m_max", "rainc", "rainnc", "sbcape", "refl10cm_max", "updraft_helicity_max"] },
  "10km": { paso: 3 * 3600e3, horas: 264, variables: ["t2m", "q2", "surface_pressure", "u10", "v10", "rainc", "rainnc", "cldfrac_tot_UPP", "cape"] },
};
const CONCURRENCIA = Math.max(1, Number(process.env.MONAN_CONCURRENCIA) || 8);
const RANGOS_POR_PEDIDO = 90; // un encabezado Range muy largo lo rechazan los servidores
const TIMEOUT_MS = 60000;
const DIR_CACHE = path.join(os.tmpdir(), "monan-cache");
const ARCHIVO_DISENOS = path.join(DIR_CACHE, "disenos.json");

async function pedir(url, opciones = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...opciones, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
const pad = (n, l = 2) => String(n).padStart(l, "0");
const idHora = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`; };
const msDeId = (id) => Date.UTC(+id.slice(0, 4), +id.slice(4, 6) - 1, +id.slice(6, 8), +id.slice(8, 10));
const unir = (iv) => { const o = iv.slice().sort((x, y) => x[0] - y[0]), s = []; for (const [a, b] of o) { const u = s.at(-1); if (u && a <= u[1]) u[1] = Math.max(u[1], b); else s.push([a, b]); } return s; };
async function enParalelo(trabajos, n, hacer) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, trabajos.length) }, async () => { while (i < trabajos.length) await hacer(trabajos[i++]); }));
}

// ===================================================================================================================
// Corrida vigente
// ===================================================================================================================
const RE_ARCHIVO = /^(MONAN_DIAG_[A-Z]_POS_[A-Z0-9]+)_(\d{10})_(\d{10})\.\d{2}\.\d{2}\.(.+\.nc)$/;

/** Nombres de archivo (y carpetas) de una carpeta del servidor; null si no existe. */
async function listar(url) {
  const r = await pedir(url);
  if (r.status === 404) return null;
  if (r.status === 401) throw new Error("el CPTEC/INPE puso el MONAN 3 km detrás de usuario y clave (desde el 13/10; «Área restrita - MONAN»). Hay que pedirles acceso.");
  if (!r.ok) throw new Error(`MONAN: HTTP ${r.status} al listar ${url}.`);
  return [...(await r.text()).matchAll(/<a href="([^"?]+)">/g)].map((m) => decodeURIComponent(m[1])).filter((x) => !x.startsWith("/"));
}
async function tamanoDe(url) {
  const r = await pedir(url, { method: "HEAD" });
  return r.ok ? Number(r.headers.get("content-length")) : null;
}

const vigentes = new Map(); // producto → { t, run }
/**
 * La corrida más reciente (de las últimas 5) que ya está completa: tiene la última hora que le corresponde y todos
 * los archivos pesan lo mismo. → { init (ms), dir, archivos: Map(validoMs → nombre), tamano }
 */
async function corridaVigente(producto) {
  const prod = PRODUCTOS[producto], guardada = vigentes.get(producto);
  if (guardada && Date.now() - guardada.t < 20 * 60000) return guardada.run;
  const hoy = new Date(); hoy.setUTCHours(0, 0, 0, 0);
  for (let k = 0; k < 5; k++) {
    const init = hoy.getTime() - k * 86400000, d = new Date(init);
    const dir = `${BASE}/${producto}/brutos/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/00/`;
    const nombres = await listar(dir);
    if (!nombres) continue;
    const archivos = new Map();
    for (const n of nombres) { const m = RE_ARCHIVO.exec(n); if (m && msDeId(m[2]) === init) archivos.set(msDeId(m[3]), n); }
    const ultimo = init + prod.horas * 3600e3;
    if (!archivos.has(ultimo) || !archivos.has(init + prod.paso)) continue; // todavía se está generando
    const [a, b] = await Promise.all([tamanoDe(dir + archivos.get(init + prod.paso)), tamanoDe(dir + archivos.get(ultimo))]);
    if (!a || a !== b) continue; // el último todavía se está escribiendo
    const run = { init, dir, archivos, tamano: a };
    vigentes.set(producto, { t: Date.now(), run });
    return run;
  }
  throw new Error(`MONAN ${producto}: no se encontró ninguna corrida completa reciente.`);
}

// ===================================================================================================================
// Diseño de los archivos (dónde está cada variable) — descubierto con h5wasm sobre un archivo ralo
// ===================================================================================================================
// Mientras se descubre, el lector de HDF5 usa el `fs` de Node: se anota qué posiciones lee (sólo de nuestro archivo).
const vigilados = new Map(); // fd → arreglo donde anotar [desde, hasta)
const rutasVigiladas = new Map(); // ruta → arreglo (para asociar el fd cuando HDF5 abre el archivo)
let intervenido = false;
function intervenirFs() {
  if (intervenido) return;
  intervenido = true;
  const abrir = fs.openSync, leer = fs.readSync, cerrar = fs.closeSync;
  fs.openSync = (p, ...r) => { const fd = abrir(p, ...r); if (rutasVigiladas.has(p)) vigilados.set(fd, rutasVigiladas.get(p)); return fd; };
  fs.readSync = (fd, buf, off, len, pos) => { const a = vigilados.get(fd); if (a && pos != null) a.push([Number(pos), Number(pos) + len]); return leer(fd, buf, off, len, pos); };
  fs.closeSync = (fd) => { vigilados.delete(fd); return cerrar(fd); };
}
let h5 = null;
async function cargarH5() {
  if (!h5) {
    const m = await import("h5wasm/node"); await m.default.ready; h5 = m.default;
    // HDF5 escribe un diagnóstico por cada lectura que «falla» a propósito mientras se arma la copia rala: se filtra.
    const escribir = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...resto) => (/HDF5-DIAG|^\s+#\d{3}: |^\s+(major|minor): /.test(String(chunk)) ? true : escribir(chunk, ...resto));
  }
  return h5;
}

/**
 * Abre `url` (sin bajarla) y devuelve el diseño: { tamano, lat, lon, Ny, Nx, H, W, vars: { nombre: { "j0,i0": offset } } }.
 * `H`×`W` es el tamaño de cada bloque de datos; `offset`, la posición del bloque que empieza en la fila j0, columna i0.
 */
async function descubrirDiseno(url, tamano, variables) {
  const lib = await cargarH5(); intervenirFs();
  const ruta = path.join(os.tmpdir(), `monan-diseno-${process.pid}-${Date.now()}.nc`);
  const fd = fs.openSync(ruta, "w+"); fs.ftruncateSync(fd, tamano); // archivo ralo: no ocupa disco
  let llenos = [], leidos = [];
  rutasVigiladas.set(ruta, leidos);
  const cubierto = (a, b) => llenos.some(([x, y]) => a >= x && b <= y);
  const poner = async (a, b) => {
    const r = await pedir(url, { headers: { Range: `bytes=${a}-${b - 1}` } });
    if (!r.ok) throw new Error(`MONAN: HTTP ${r.status} al leer metadatos.`);
    const buf = Buffer.from(await r.arrayBuffer()); fs.writeSync(fd, buf, 0, buf.length, a); llenos = unir([...llenos, [a, a + buf.length]]);
  };
  const GRANDE = 512 * 1024; // las lecturas de bloques de datos no se traen: sólo interesa dónde están
  async function intentar(fn) {
    for (let vuelta = 0; vuelta < 60; vuelta++) {
      leidos.length = 0; let res, error;
      try { const f = new lib.File(ruta, "r"); try { res = fn(f); } finally { f.close(); } } catch (e) { error = e; }
      const marcas = leidos.slice();
      const faltan = unir(marcas.filter(([a, b]) => b - a < GRANDE && !cubierto(a, b)));
      if (!error && !faltan.length) return { res, lecturas: marcas };
      if (!faltan.length) throw error;
      await Promise.all(unir(faltan.map(([a, b]) => [Math.max(0, a - 65536), Math.min(tamano, b + 65536)])).map(([a, b]) => poner(a, b)));
    }
    throw new Error("MONAN: no se pudo leer la estructura del archivo (demasiadas vueltas).");
  }
  try {
    await poner(0, 65536);
    const { res: base } = await intentar((f) => ({
      lat: Array.from(f.get("latitude").value), lon: Array.from(f.get("longitude").value),
      vars: Object.fromEntries(variables.filter((v) => f.get(v)).map((v) => [v, { forma: f.get(v).shape, bloque: f.get(v).metadata.chunks }])),
    }));
    const presentes = Object.keys(base.vars);
    if (!presentes.length) throw new Error("MONAN: el archivo no trae ninguna de las variables esperadas.");
    const primera = base.vars[presentes[0]], [, Ny, Nx] = primera.forma, [, H, W] = primera.bloque; // forma [1, filas, columnas]; bloque [1, H, W]
    const vars = {};
    for (const v of presentes) {
      const { forma, bloque } = base.vars[v];
      if (forma[1] !== Ny || forma[2] !== Nx || bloque[1] !== H || bloque[2] !== W) throw new Error(`MONAN: ${v} no tiene la misma grilla que las demás.`);
      vars[v] = {};
      for (let a = 0; a * H < Ny; a++) for (let b = 0; b * W < Nx; b++) {
        // Se lee el primer valor del bloque: HDF5 trae el bloque entero, y de esa lectura sale su posición.
        const { lecturas } = await intentar((f) => f.get(v).slice([[0, 1], [a * H, a * H + 1], [b * W, b * W + 1]]));
        const bloqueLeido = lecturas.filter(([x, y]) => x > 1_000_000 && y - x >= (H * W * 4) / 2).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
        if (!bloqueLeido) throw new Error(`MONAN: no se encontró dónde está ${v} en el archivo.`);
        vars[v][`${a * H},${b * W}`] = bloqueLeido[0];
      }
    }
    return { tamano, lat: base.lat, lon: base.lon, Ny, Nx, H, W, vars };
  } finally {
    rutasVigiladas.delete(ruta);
    try { fs.closeSync(fd); } catch { /* ya cerrado */ }
    try { fs.unlinkSync(ruta); } catch { /* ya no estaba */ }
  }
}

const disenos = new Map(); // «producto|tamaño» → diseño
function leerDisenosGuardados() { try { return JSON.parse(fs.readFileSync(ARCHIVO_DISENOS, "utf8")); } catch { return {}; } }
const enDescubrimiento = new Map();
/** El diseño de los archivos de la corrida: del caché si el tamaño coincide, o descubriéndolo (unos segundos, una vez). */
async function diseno(producto, run) {
  const clave = `${producto}|${run.tamano}`;
  if (disenos.has(clave)) return disenos.get(clave);
  const guardados = leerDisenosGuardados();
  if (guardados[clave]) { disenos.set(clave, guardados[clave]); return guardados[clave]; }
  if (!enDescubrimiento.has(clave)) {
    enDescubrimiento.set(clave, (async () => {
      const prod = PRODUCTOS[producto], primero = run.archivos.get(run.init + prod.paso);
      const d = await descubrirDiseno(run.dir + primero, run.tamano, prod.variables);
      disenos.set(clave, d);
      try { fs.mkdirSync(DIR_CACHE, { recursive: true }); fs.writeFileSync(ARCHIVO_DISENOS, JSON.stringify({ ...leerDisenosGuardados(), [clave]: d })); } catch { /* sólo es una optimización */ }
      return d;
    })().finally(() => enDescubrimiento.delete(clave)));
  }
  return enDescubrimiento.get(clave);
}

// ===================================================================================================================
// Lectura de los puntos
// ===================================================================================================================
const mas_cercano = (arreglo, x) => { let mejor = 0, d = Infinity; for (let i = 0; i < arreglo.length; i++) { const e = Math.abs(arreglo[i] - x); if (e < d) { d = e; mejor = i; } } return mejor; };
/** La celda [fila, columna] de la grilla más cercana a cada punto {lat, lng}. */
const celdasDe = (d, puntos) => puntos.map((p) => [mas_cercano(d.lat, p.lat), mas_cercano(d.lon, ((p.lng % 360) + 360) % 360)]);
/** Posición (en bytes) del valor de `variable` en la celda [j, i]. */
const posicion = (d, variable, j, i) => { const j0 = Math.floor(j / d.H) * d.H, i0 = Math.floor(i / d.W) * d.W; return d.vars[variable][`${j0},${i0}`] + ((j - j0) * d.W + (i - i0)) * 4; };

/**
 * Interpreta la respuesta a un pedido de varios rangos (multipart/byteranges) o de uno solo.
 * Devuelve [{ ini, datos: Buffer }]: el servidor puede unir rangos que se tocan, por eso se ubica cada valor por posición.
 */
function trozosDeRespuesta(buf, contentType, contentRange) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/.exec(contentType || "");
  if (!m) { const r = /bytes (\d+)-(\d+)\//.exec(contentRange || ""); return r ? [{ ini: +r[1], datos: buf }] : []; }
  const texto = buf.toString("latin1"), sep = `--${m[1] || m[2]}`, trozos = [];
  for (const parte of texto.split(sep)) {
    const finEnc = parte.indexOf("\r\n\r\n");
    if (finEnc < 0) continue;
    const r = /content-range:\s*bytes (\d+)-(\d+)\//i.exec(parte.slice(0, finEnc));
    if (!r) continue;
    const largo = +r[2] - +r[1] + 1;
    trozos.push({ ini: +r[1], datos: Buffer.from(parte.slice(finEnc + 4, finEnc + 4 + largo), "latin1") });
  }
  return trozos;
}
const valorEn = (trozos, pos) => { const t = trozos.find((x) => x.ini <= pos && pos + 4 <= x.ini + x.datos.length); return t ? t.datos.readFloatLE(pos - t.ini) : null; };

/** Un archivo: el valor de cada variable en cada celda → { variable: Float32Array(por punto) }. */
async function leerArchivo(url, d, celdas, variables) {
  const pedidos = [];
  for (const v of variables) if (d.vars[v]) celdas.forEach(([j, i], p) => pedidos.push({ v, p, pos: posicion(d, v, j, i) }));
  const salida = Object.fromEntries(variables.map((v) => [v, new Float32Array(celdas.length).fill(NaN)]));
  for (let a = 0; a < pedidos.length; a += RANGOS_POR_PEDIDO) {
    const lote = pedidos.slice(a, a + RANGOS_POR_PEDIDO);
    let trozos = null;
    for (let intento = 0; intento < 3 && !trozos; intento++) {
      try {
        const r = await pedir(url, { headers: { Range: `bytes=${lote.map((x) => `${x.pos}-${x.pos + 3}`).join(",")}` } });
        if (r.status !== 206) throw new Error(`MONAN: HTTP ${r.status} al leer ${url.split("/").pop()}.`);
        trozos = trozosDeRespuesta(Buffer.from(await r.arrayBuffer()), r.headers.get("content-type"), r.headers.get("content-range"));
      } catch (e) { if (intento === 2) throw e; }
    }
    for (const x of lote) { const val = valorEn(trozos, x.pos); if (val != null && Number.isFinite(val) && Math.abs(val) < 1e30) salida[x.v][x.p] = val; }
  }
  return salida;
}

// ===================================================================================================================
// Variables derivadas
// ===================================================================================================================
const esFinito = Number.isFinite;
/**
 * De lo que publica el modelo (K, kg/kg, Pa, m/s, mm acumulados…) a lo que usa el ensamble, para un punto en una hora.
 * tc °C · hr % · td °C (rocío) · st °C (sensación térmica, Steadman) · vel km/h · dir ° (de dónde sopla) · rafaga km/h ·
 * lluviaAcc mm (acumulada desde el inicio de la corrida) · cape J/kg · refl dBZ · uh m²/s² · nub %.
 */
function derivar(c) {
  const salida = {};
  const tk = c.t2m, tc = esFinito(tk) ? tk - 273.15 : NaN, P = esFinito(c.surface_pressure) ? c.surface_pressure / 100 : NaN; // hPa
  salida.tc = tc;
  if (esFinito(tc) && esFinito(c.q2) && esFinito(P)) {
    const e = (c.q2 * P) / (0.622 + 0.378 * c.q2), es = 6.112 * Math.exp((17.67 * tc) / (tc + 243.5));
    salida.hr = Math.min(100, Math.max(0, (100 * e) / es));
    const l = Math.log(Math.max(e, 1e-6) / 6.112);
    salida.td = (243.5 * l) / (17.67 - l);
  }
  if (esFinito(c.u10) && esFinito(c.v10)) {
    const vel = Math.hypot(c.u10, c.v10);
    salida.vel = vel * 3.6;
    salida.dir = ((Math.atan2(-c.u10, -c.v10) * 180) / Math.PI + 360) % 360;
    if (esFinito(tc) && esFinito(salida.hr)) { // sensación térmica (Steadman): la misma fórmula que usa Open-Meteo
      const ea = (salida.hr / 100) * 6.105 * Math.exp((17.27 * tc) / (237.7 + tc));
      salida.st = tc + 0.33 * ea - 0.7 * vel - 4;
    }
  }
  if (esFinito(c.gust10m_max)) salida.rafaga = c.gust10m_max * 3.6;
  if (esFinito(c.rainc) && esFinito(c.rainnc)) salida.lluviaAcc = c.rainc + c.rainnc;
  const cape = esFinito(c.sbcape) ? c.sbcape : c.cape;
  if (esFinito(cape)) salida.cape = cape;
  if (esFinito(c.refl10cm_max)) salida.refl = c.refl10cm_max;
  if (esFinito(c.updraft_helicity_max)) salida.uh = c.updraft_helicity_max;
  if (esFinito(c.cldfrac_tot_UPP)) salida.nub = Math.min(100, Math.max(0, c.cldfrac_tot_UPP * 100));
  return salida;
}
const SERIES = ["tc", "hr", "td", "st", "vel", "dir", "rafaga", "lluviaAcc", "cape", "refl", "uh", "nub"];

// ===================================================================================================================
// Una corrida entera
// ===================================================================================================================
const avance = { total: 0, hechos: 0, producto: null };
let trabajosActivos = 0;
const progreso = () => ({ activo: trabajosActivos > 0, ...avance });
const memoria = new Map();
function leerCacheCorrida(id) {
  if (memoria.has(id)) return memoria.get(id);
  try { const c = JSON.parse(fs.readFileSync(path.join(DIR_CACHE, `${id}.json`), "utf8")); memoria.set(id, c); return c; } catch { return null; }
}
function guardarCacheCorrida(id, datos) {
  memoria.set(id, datos);
  try {
    fs.mkdirSync(DIR_CACHE, { recursive: true }); fs.writeFileSync(path.join(DIR_CACHE, `${id}.json`), JSON.stringify(datos));
    const limite = idHora(Date.now() - 4 * 86400000);
    for (const f of fs.readdirSync(DIR_CACHE)) { const m = /^\d+km-(\d{10})-/.exec(f); if (m && m[1] < limite) fs.unlinkSync(path.join(DIR_CACHE, f)); }
  } catch { /* no es grave */ }
}

/**
 * Lee la corrida vigente del producto para los `puntos` ({lat, lng}).
 * → { corrida: ISO, paso: ms, validos: [ms…], ser: { tc: [Float para cada hora → arreglo por punto], … } }
 */
async function monan({ producto, puntos }) {
  if (!PRODUCTOS[producto]) throw new Error(`MONAN: producto desconocido (${producto}).`);
  const prod = PRODUCTOS[producto], run = await corridaVigente(producto);
  const id = `${producto}-${idHora(run.init)}-p${puntos.length}`, guardada = leerCacheCorrida(id);
  if (guardada) return guardada;

  const d = await diseno(producto, run), celdas = celdasDe(d, puntos);
  const validos = [...run.archivos.keys()].filter((t) => t > run.init && t <= run.init + prod.horas * 3600e3).sort((a, b) => a - b);
  if (trabajosActivos <= 1) Object.assign(avance, { total: 0, hechos: 0 });
  avance.producto = producto; avance.total += validos.length + 1;
  const crudo = new Map();
  const leerYa = async (t) => { crudo.set(t, await leerArchivo(run.dir + run.archivos.get(t), d, celdas, prod.variables)); avance.hechos++; };
  await leerYa(run.init + prod.paso); // el primero: sirve de control del diseño
  const control = crudo.get(run.init + prod.paso).t2m;
  if (![...control].some((x) => x > 200 && x < 340)) { disenos.delete(`${producto}|${run.tamano}`); try { const g = leerDisenosGuardados(); delete g[`${producto}|${run.tamano}`]; fs.writeFileSync(ARCHIVO_DISENOS, JSON.stringify(g)); } catch { /* sin caché */ } throw new Error(`MONAN ${producto}: la temperatura leída no es creíble (cambió el diseño de los archivos); se va a redescubrir.`); }
  await enParalelo(validos.filter((t) => !crudo.has(t)), CONCURRENCIA, leerYa);

  const ser = Object.fromEntries(SERIES.map((s) => [s, []]));
  for (const t of validos) {
    const c = crudo.get(t), porPunto = puntos.map((_, p) => derivar(Object.fromEntries(Object.entries(c).map(([v, a]) => [v, a[p]]))));
    for (const s of SERIES) ser[s].push(porPunto.map((x) => (esFinito(x[s]) ? Math.round(x[s] * 100) / 100 : null)));
  }
  const datos = { corrida: new Date(run.init).toISOString(), paso: prod.paso, validos, ser };
  guardarCacheCorrida(id, datos);
  return datos;
}

const enFondo = new Map();
/**
 * Igual que `monan`, pero sin trabar al que pregunta: se lo espera `esperaMs`; si no terminó (la primera lectura de una
 * corrida lleva unos segundos, y más si hay que descubrir el diseño), devuelve `{ pendiente: true }` y sigue en
 * segundo plano: al repetir la consulta está listo.
 */
async function monanConEspera(args, esperaMs = 8000) {
  const k = `${args.producto}|${args.puntos.length}`;
  let trabajo = enFondo.get(k);
  if (!trabajo) {
    trabajosActivos++;
    trabajo = monan(args);
    enFondo.set(k, trabajo);
    trabajo.catch((e) => console.error("[MONAN]", e.message)).finally(() => { enFondo.delete(k); trabajosActivos--; });
  }
  let timer;
  const r = await Promise.race([trabajo, new Promise((res) => { timer = setTimeout(() => res(null), esperaMs); })]).finally(() => clearTimeout(timer));
  return r || { pendiente: true, progreso: progreso() };
}

module.exports = { monan, monanConEspera, progreso, derivar, trozosDeRespuesta, valorEn, posicion, celdasDe, corridaVigente, PRODUCTOS, SERIES };
