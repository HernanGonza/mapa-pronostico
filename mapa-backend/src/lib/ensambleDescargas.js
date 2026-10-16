const store = require("./ensambleStore");
const { bajarYr } = require("./yrNo");
const bam = require("./inpeBam");
const eta = require("./inpeEta");
const observaciones = require("./observaciones");
const { bajarPronosticoSmn } = require("./smnPronostico");
const { wrfCompleto, corridaVigente } = require("./wrfSmn");

/**
 * Descarga programada de los modelos del ensamble. Cada 10 minutos se mira si algún modelo tiene una corrida nueva y, si es así,
 * se baja y se guarda (ensambleStore.js): las consultas del ensamble leen de ahí y no salen a internet.
 *
 *   - Open-Meteo (ECMWF, GFS, ICON, GEM, ARPEGE, JMA GSM, UKMO, CMA GRAPES): Open-Meteo publica en `/data/<modelo>/static/meta.json` cuándo inició la última corrida, cuándo
 *     quedó disponible y cada cuánto se actualiza. De ahí salen la corrida nueva y la próxima actualización. El meta del GEM está desactualizado
 *     en Open-Meteo: para ese se usa un horario fijo (corridas de 00 y 12 UTC, disponibles unas 5,5 h después; es una estimación).
 *   - WRF-SMN: 4 corridas por día (00/06/12/18 UTC). Se mira qué corrida completa hay en el bucket de AWS; cuando aparece una nueva se baja
 *     entera (72 h; puede llevar minutos). La próxima es una estimación: inicio de la corrida + 6 h + unas 5,5 h de demora de publicación.
 *   - yr.no (MET Norway): se renueva cada ~30–60 min; se vuelve a bajar cuando pasó casi una hora desde la última descarga (ver yrNo.js).
 *   - BAM 20 km y Eta 8 km (CPTEC/INPE): una corrida por día (00 UTC) que el INPE publica unas 8–9 h después. Se mira cuál es la última corrida completa
 *     del servidor y, si es más nueva que la guardada, se lee lo que usa el ensamble sin bajar los archivos enteros (ver inpeBam.js e inpeEta.js).
 *   - Referencias para comparar con los modelos: lo observado por las estaciones automáticas (INTA y SiNaRaMe, cada 20 min), por las del SMN (datos horarios
 *     abiertos, que el SMN sube al día siguiente; cada hora) y el pronóstico a 5 días del SMN (datos abiertos, cada 3 horas). Ver observaciones.js y smnPronostico.js.
 *   - El MONAN (apagado) sigue yendo por consulta directa: ver monan.js.
 *
 * Open-Meteo se baja con el rango que admite el ensamble: de 7 días atrás a 9 días adelante (hora de Misiones).
 */
const ART = "America/Argentina/Buenos_Aires";
const HORA = 3600e3;
const REVISION_MS = 10 * 60e3;
const META_OM = { ecmwf_ifs025: "ecmwf_ifs025", gfs_seamless: "ncep_gfs025", icon_seamless: "dwd_icon", gem_seamless: "cmc_gem_gdps",
  meteofrance_arpege_world: "meteofrance_arpege_world025", jma_gsm: "jma_gsm", ukmo_global_deterministic_10km: "ukmo_global_deterministic_10km", cma_grapes_global: "cma_grapes_global" };
const SLOTS_GEM_UTC = [5.5, 17.5];
const INPE_DEMORA_MS = 9 * HORA; // el INPE publica la corrida de las 00 UTC entre 7,5 y 9 h después (hora del servidor, que está en UTC)
// Cada cuánto se vuelven a bajar las referencias (minutos de vigencia de lo que ya se guardó).
const REFERENCIAS_VIGENCIA_MS = { "obs-estaciones": 20 * 60e3, "obs-smn": 60 * 60e3, "smn-pron": 3 * HORA };
const YR_VIGENCIA_MS = 55 * 60e3; // yr.no renueva cada 30–60 min; no hace falta bajarlo más seguido
const WRF_PASO_MS = 6 * HORA, WRF_DEMORA_MS = 5.5 * HORA;
const DIAS_ATRAS = 7, DIAS_ADELANTE = 9;
const diaART = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: ART }).format(new Date(ms));
const sumarDias = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function pedirJson(url, timeoutMs) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw Object.assign(new Error(r.status === 429 ? "Open-Meteo: límite de consultas alcanzado (HTTP 429)." : `Open-Meteo: HTTP ${r.status}.`), { status: r.status });
  return r.json();
}

/** Corrida más reciente de un modelo de Open-Meteo: { inicio, disponible, intervalo } en ms, o null si no se puede saber (o el meta está viejo). */
async function metaDe(modeloOM) {
  try {
    const j = await pedirJson(`https://api.open-meteo.com/data/${modeloOM}/static/meta.json`, 15000);
    const inicio = j.last_run_initialisation_time * 1000, disponible = j.last_run_availability_time * 1000, intervalo = j.update_interval_seconds * 1000;
    if (![inicio, disponible, intervalo].every(Number.isFinite) || Date.now() - disponible > 2.5 * intervalo) return null;
    return { inicio, disponible, intervalo };
  } catch { return null; }
}

/** Primer y último horario fijo (horas UTC) respecto de `ahora`: { ultimo, proximo } en ms. */
function horarios(horasUtc, ahora = Date.now()) {
  const dia0 = Date.UTC(new Date(ahora).getUTCFullYear(), new Date(ahora).getUTCMonth(), new Date(ahora).getUTCDate());
  const todos = [-1, 0, 1].flatMap((d) => horasUtc.map((h) => dia0 + d * 86400000 + h * HORA)).sort((a, b) => a - b);
  return { ultimo: todos.filter((t) => t <= ahora).at(-1), proximo: todos.find((t) => t > ahora) };
}

/** `ctx`: { puntos: () => [{ lat, lng }…], horarias: [variables de Open-Meteo], modelos: MODELOS }. */
function crear(ctx) {
  const estados = new Map(); // id → { descargando, revisando, error, intento, proxima }
  const de = (id) => { if (!estados.has(id)) estados.set(id, { descargando: false, revisando: false, error: null, intento: null, proxima: null }); return estados.get(id); };
  const wrfCache = { descargadoEn: null, valor: null };

  async function bajarOpenMeteo(m, corrida) {
    const e = de(m.id), t0 = Date.now(), puntos = ctx.puntos();
    const hoy = diaART(Date.now());
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${puntos.map((c) => c.lat.toFixed(3)).join(",")}&longitude=${puntos.map((c) => c.lng.toFixed(3)).join(",")}`
      + `&hourly=${ctx.horarias.join(",")}&models=${m.id}&timezone=${encodeURIComponent(ART)}&start_date=${sumarDias(hoy, -DIAS_ATRAS)}&end_date=${sumarDias(hoy, DIAS_ADELANTE)}`;
    let data = null, ultimo = null;
    for (let intento = 0; intento < 3 && !data; intento++) {
      try { data = await pedirJson(url, 60000); } catch (err) { ultimo = err; if (err.status === 429) break; await new Promise((r) => setTimeout(r, 3000)); }
    }
    if (!data) throw ultimo || new Error("Open-Meteo no respondió.");
    const pts = Array.isArray(data) ? data : [data];
    if (pts.length !== puntos.length || !pts[0]?.hourly?.time) throw new Error("Open-Meteo devolvió una respuesta inesperada.");
    const horas = pts[0].hourly.time;
    const datos = { horas, puntos: pts.map((p) => { const { time, ...h } = p.hourly; return { hourly: h }; }) };
    await store.guardar(m.id, { corrida: new Date(corrida).toISOString(), datos, duracionMs: Date.now() - t0 });
    e.error = null;
    console.log(`[ensamble] ${m.nombre}: corrida ${new Date(corrida).toISOString().slice(0, 13)}Z guardada (${Math.round((Date.now() - t0) / 1000)} s)`);
  }

  async function bajarYrNo(m) {
    const t0 = Date.now(), r = await bajarYr(ctx.puntos());
    await store.guardar(m.id, { corrida: r.corrida, datos: r.datos, duracionMs: Date.now() - t0 });
    const e = de(m.id);
    e.error = null; e.proxima = Math.max(r.expira || 0, Date.now() + 30 * 60e3);
    console.log(`[ensamble] ${m.nombre}: pronóstico guardado (${Math.round((Date.now() - t0) / 1000)} s)`);
  }

  async function bajarInpe(m, modulo, bajar) {
    const t0 = Date.now(), r = await bajar(ctx.puntos(), { alAvanzar: (h, n, s) => console.log(`[ensamble] ${m.nombre}: ${h}/${n} pasos leídos (${Math.round(s)} s)`) });
    await store.guardar(m.id, { corrida: r.corrida, datos: r.datos, duracionMs: Date.now() - t0 });
    de(m.id).error = null;
    console.log(`[ensamble] ${m.nombre}: corrida ${r.corrida.slice(0, 13)}Z guardada (${Math.round((Date.now() - t0) / 1000)} s)`);
  }

  async function bajarReferencia(m, bajar) {
    const t0 = Date.now(), r = await bajar(ctx.puntos());
    await store.guardar(m.id, { corrida: r.corrida || new Date().toISOString(), datos: r.datos, duracionMs: Date.now() - t0 });
    const e = de(m.id);
    e.error = r.avisos?.length ? `Algunas fuentes no respondieron: ${r.avisos.slice(0, 2).join("; ")}` : null;
    console.log(`[ensamble] ${m.nombre}: actualizado (${Math.round((Date.now() - t0) / 1000)} s)${r.avisos?.length ? ` · avisos: ${r.avisos.length}` : ""}`);
  }

  async function bajarWrf(init) {
    const t0 = Date.now();
    const desde = `${diaART(init)}T00:00`, hasta = `${diaART(init + 4 * 86400000)}T23:00`;
    const r = await wrfCompleto({ desde, hasta, puntos: ctx.puntos(), temperatura: true });
    if (!r.porHora.PP.size) throw new Error(r.avisos[0] || "La corrida no trajo lluvia horaria.");
    const mapas = (o) => Object.fromEntries(Object.entries(o).map(([k, mp]) => [k, Object.fromEntries(mp)]));
    await store.guardar("wrf_smn", { corrida: r.corrida, datos: { porHora: mapas(r.porHora), diario: mapas(r.diario), avisos: r.avisos }, duracionMs: Date.now() - t0 });
    de("wrf_smn").error = null;
    console.log(`[ensamble] WRF-SMN: corrida ${r.corrida.slice(0, 13)}Z guardada (${Math.round((Date.now() - t0) / 1000)} s)`);
  }

  /** Mira si `m` tiene una corrida nueva y, si es así, la baja. `forzar`: la baja aunque no haya una nueva. */
  async function revisar(m, forzar = false) {
    const e = de(m.id);
    if (e.descargando || e.revisando) return;
    e.revisando = true;
    const guardado = (await store.resumen())[m.id] || null;
    e.intento = new Date().toISOString();
    try {
      let corrida = null, hayNueva;
      if (m.fuente === "wrf") {
        const init = (await corridaVigente()).getTime();
        e.proxima = init + WRF_PASO_MS + WRF_DEMORA_MS;
        hayNueva = !guardado || init > Date.parse(guardado.corrida); corrida = init;
      } else if (m.fuente === "inpe-bam" || m.fuente === "inpe-eta") {
        const init = (await (m.fuente === "inpe-bam" ? bam : eta).corridaVigente()).init;
        e.proxima = init + 24 * HORA + INPE_DEMORA_MS;
        hayNueva = !guardado || init > Date.parse(guardado.corrida); corrida = init;
      } else if (REFERENCIAS_VIGENCIA_MS[m.fuente]) {
        const vigencia = REFERENCIAS_VIGENCIA_MS[m.fuente], ultima = guardado ? Date.parse(guardado.descargadoEn) : 0;
        e.proxima = ultima ? ultima + vigencia : null;
        hayNueva = !guardado || Date.now() - ultima > vigencia; corrida = Date.now();
      } else if (m.fuente === "yr") {
        const ultima = guardado ? Date.parse(guardado.descargadoEn) : 0;
        e.proxima = ultima ? ultima + YR_VIGENCIA_MS : null;
        hayNueva = !guardado || Date.now() - ultima > YR_VIGENCIA_MS; corrida = Date.now();
      } else {
        const meta = META_OM[m.id] ? await metaDe(META_OM[m.id]) : null;
        if (meta) { e.proxima = meta.disponible + meta.intervalo; hayNueva = !guardado || Date.parse(guardado.corrida) < meta.inicio; corrida = meta.inicio; }
        else if (m.id === "gem_seamless") { const h = horarios(SLOTS_GEM_UTC); e.proxima = h.proximo; hayNueva = !guardado || Date.parse(guardado.descargadoEn) < h.ultimo; corrida = h.ultimo - 5.5 * HORA; }
        else { hayNueva = !guardado; corrida = Date.now(); } // sin saber cuándo sale la próxima: sólo se baja si nunca se bajó
      }
      if (!hayNueva && !forzar) { e.error = null; return; }
      e.descargando = true; e.error = null;
      if (m.fuente === "wrf") await bajarWrf(corrida); else if (m.fuente === "yr") await bajarYrNo(m); else if (m.fuente === "obs-estaciones") await bajarReferencia(m, observaciones.bajarEstaciones); else if (m.fuente === "obs-smn") await bajarReferencia(m, observaciones.bajarSmn); else if (m.fuente === "smn-pron") await bajarReferencia(m, bajarPronosticoSmn); else if (m.fuente === "inpe-bam") await bajarInpe(m, bam, bam.bajarBam); else if (m.fuente === "inpe-eta") await bajarInpe(m, eta, eta.bajarEta); else await bajarOpenMeteo(m, corrida);
    } catch (err) {
      e.error = err.cause?.code ? `${err.message} (${err.cause.code})` : err.message;
      console.error(`[ensamble] ${m.nombre}:`, e.error);
    } finally { e.descargando = false; e.revisando = false; }
  }

  const bajables = () => ctx.modelos.filter((m) => !m.deshabilitado && ["open-meteo", "wrf", "yr", "inpe-bam", "inpe-eta", ...Object.keys(REFERENCIAS_VIGENCIA_MS)].includes(m.fuente));
  const tick = (forzar = false) => Promise.all(bajables().map((m) => revisar(m, forzar)));

  let timer = null;
  function iniciar() {
    if (timer) return;
    setTimeout(() => tick(), 5000);
    timer = setInterval(() => tick(), REVISION_MS);
    timer.unref?.();
  }

  /** Las series horarias de un modelo de Open-Meteo, o null si todavía no se bajó. Si falta, lo pide en segundo plano. */
  async function leerOpenMeteo(id) {
    const g = await store.leer(id);
    if (!g) { const m = ctx.modelos.find((x) => x.id === id); if (m) revisar(m); return null; }
    return { ...g.datos, corrida: g.corrida, descargadoEn: g.descargadoEn };
  }

  /** La última corrida del WRF-SMN como la devuelve wrfSmn (con Maps), o null si todavía no se bajó. */
  async function leerWrf() {
    const g = await store.leer("wrf_smn");
    if (!g) { const m = ctx.modelos.find((x) => x.id === "wrf_smn"); if (m) revisar(m); return null; }
    if (wrfCache.descargadoEn !== g.descargadoEn) {
      const mapas = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, new Map(Object.entries(v))]));
      wrfCache.descargadoEn = g.descargadoEn;
      wrfCache.valor = { corrida: g.corrida, descargadoEn: g.descargadoEn, porHora: mapas(g.datos.porHora), diario: mapas(g.datos.diario), avisos: g.datos.avisos || [] };
    }
    return wrfCache.valor;
  }

  const enCurso = (id) => de(id).descargando || de(id).revisando; // revisando: mirando si hay corrida nueva (o por empezar a bajarla)
  const ultimoError = (id) => de(id).error;

  /** Para el panel: de cada modelo, la corrida y el momento de la última descarga, la próxima actualización estimada y si está bajando. */
  async function estado() {
    const guardado = await store.resumen();
    return bajables().map((m) => {
      const e = de(m.id), g = guardado[m.id];
      return { id: m.id, nombre: m.nombre, corrida: g?.corrida || null, descargadoEn: g?.descargadoEn || null, duracionMs: g?.duracionMs ?? null,
        proxima: e.proxima ? new Date(e.proxima).toISOString() : null, descargando: e.descargando, error: e.error, ultimaRevision: e.intento };
    });
  }

  return { iniciar, tick, leerOpenMeteo, leerWrf, estado, enCurso, ultimoError };
}

module.exports = { crear, horarios };
