const puntosStore = require("./puntosStore");
const { CODIGOS } = require("../snihEstaciones");

/**
 * Monitor de arroyos internos (módulo Inundaciones): la altura de cada punto con estación de la Red
 * Hidrológica Nacional, leída del SNIH (`MuestraDatos.aspx/LeerUltimosRegistros`, código 1 = altura).
 * Esas estaciones transmiten cada ~4 h, así que una lectura se considera vigente hasta 9 h. Los -999 /
 * -9999 del SNIH son «sin dato». Los estados se calculan contra los umbrales que cargó el equipo en cada
 * punto (vigilancia < alerta < corte); sin umbrales sólo se muestra el valor y la tendencia.
 */

const BASE = "https://snih.hidricosargentina.gob.ar";
const HORA = 3600e3;
const DIAS_SERIE = 7, VIGENCIA_H = 9, TTL_MS = 10 * 60e3, TIMEOUT_MS = 30000;
const UMBRAL_TENDENCIA = 0.02; // m/h (≈ 8 cm entre dos lecturas de 4 h)

const ETIQUETAS = { normal: "Normal", vigilancia: "Vigilancia", alerta: "Alerta", corte: "Nivel de corte de ruta", sin_umbral: "Sin umbral definido", sin_datos: "Sin datos recientes", sin_sensor: "Sin sensor" };

const redondear = (n, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
const fechaISO = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Lecturas válidas [{ t, valor }] ordenadas de más nueva a más vieja, a partir de la respuesta del SNIH. */
function lecturasDe(respuesta) {
  const filas = (respuesta?.Mediciones || []).map((m) => ({ t: Number(/-?\d+/.exec(m.FechaHora)?.[0]), valor: m.Mediciones?.[0]?.Valor }))
    .filter((r) => Number.isFinite(r.t) && typeof r.valor === "number" && r.valor > -100);
  const unicas = new Map(filas.map((r) => [r.t, r]));
  return [...unicas.values()].sort((a, b) => b.t - a.t);
}

/** Estado según los umbrales del punto ({ vigilancia, alerta, corte }, en m) para una altura. */
function estadoPorUmbral(valor, p) {
  const hay = [p.vigilancia, p.alerta, p.corte].some((u) => u != null);
  if (!hay) return "sin_umbral";
  if (p.corte != null && valor >= p.corte) return "corte";
  if (p.alerta != null && valor >= p.alerta) return "alerta";
  if (p.vigilancia != null && valor >= p.vigilancia) return "vigilancia";
  return "normal";
}

/** Arma el resumen de un punto a partir de sus lecturas (más nueva primero). */
function resumir(punto, lecturas, ahora = Date.now()) {
  const base = { id: punto.id, nombre: punto.nombre, arroyo: punto.arroyo, estacion: punto.estacion || null, ruta: punto.ruta || "", municipio: punto.municipio || "", lat: punto.lat, lng: punto.lng,
    umbrales: { vigilancia: punto.vigilancia ?? null, alerta: punto.alerta ?? null, corte: punto.corte ?? null }, nota: punto.nota || "", activo: punto.activo !== false };
  if (!punto.estacion) return { ...base, estado: { codigo: "sin_sensor", etiqueta: ETIQUETAS.sin_sensor, motivo: "Punto sin estación automática: se informa por otros canales." }, valor: null, fecha: null, vigente: false, serie: [] };
  const ultima = lecturas[0];
  if (!ultima) return { ...base, estado: { codigo: "sin_datos", etiqueta: ETIQUETAS.sin_datos, motivo: `La estación no tiene lecturas en los últimos ${DIAS_SERIE} días.` }, valor: null, fecha: null, vigente: false, serie: [] };

  const edadH = (ahora - ultima.t) / HORA;
  const vigente = edadH <= VIGENCIA_H && edadH >= -0.25;
  // Tendencia: contra la lectura más cercana a 3 h o más hacia atrás (y no más de 12 h).
  const previa = lecturas.find((r) => ultima.t - r.t >= 3 * HORA && ultima.t - r.t <= 12 * HORA);
  const horas = previa ? (ultima.t - previa.t) / HORA : 0;
  const ritmo = previa ? (ultima.valor - previa.valor) / horas : null;
  const hace24 = lecturas.find((r) => ultima.t - r.t >= 22 * HORA && ultima.t - r.t <= 30 * HORA);
  const valores = lecturas.map((r) => r.valor);
  const porUmbral = estadoPorUmbral(ultima.valor, punto);
  const codigo = vigente ? porUmbral : "sin_datos";
  const motivo = !vigente ? `Última lectura hace ${edadH < 48 ? `${Math.round(edadH)} h` : `${Math.round(edadH / 24)} días`}.`
    : porUmbral === "sin_umbral" ? "Todavía no hay umbrales cargados para este punto."
    : porUmbral === "normal" ? "Por debajo de los umbrales cargados."
    : porUmbral === "corte" ? `Alcanzó el nivel de corte de ruta (${punto.corte} m).`
    : porUmbral === "alerta" ? `Superó el nivel de alerta (${punto.alerta} m).` : `Superó el nivel de vigilancia (${punto.vigilancia} m).`;
  return {
    ...base,
    estado: { codigo, etiqueta: ETIQUETAS[codigo], motivo },
    valor: ultima.valor, fecha: new Date(ultima.t).toISOString(), vigente,
    tendencia: ritmo == null ? "Sin tendencia reciente" : ritmo >= UMBRAL_TENDENCIA ? "Sube" : ritmo <= -UMBRAL_TENDENCIA ? "Baja" : "Estable",
    variacion: redondear(ritmo, 3), // m/h
    cambio24h: hace24 ? redondear(ultima.valor - hace24.valor) : null,
    maximo: redondear(Math.max(...valores)), minimo: redondear(Math.min(...valores)),
    serie: lecturas.slice().reverse().map((r) => ({ t: new Date(r.t).toISOString(), valor: r.valor })),
  };
}

async function leerSerie(estacion, ahora = Date.now()) {
  const r = await fetch(`${BASE}/MuestraDatos.aspx/LeerUltimosRegistros`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ fechaDesde: fechaISO(ahora - DIAS_SERIE * 24 * HORA), fechaHasta: fechaISO(ahora + 24 * HORA), estacion: String(estacion), codigo: String(CODIGOS.altura) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`SNIH: HTTP ${r.status}.`);
  const j = (await r.json())?.d;
  if (j?.RespuestaOK === false) throw new Error(`SNIH: ${j.MsgErr || "respuesta no OK"}.`);
  return lecturasDe(j);
}

async function enParalelo(trabajos, n, hacer) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, trabajos.length) }, async () => { while (i < trabajos.length) await hacer(trabajos[i++]); }));
}

let cache = null; // { t, consultadoEn, porEstacion: Map(estacion → { lecturas, error }) }
let enCurso = null;

/** Baja las series de todas las estaciones en uso. Si una falla se conserva su último dato y se marca `error`. */
async function consultarEstaciones(puntos) {
  const estaciones = [...new Set(puntos.filter((p) => p.estacion && p.activo !== false).map((p) => p.estacion))];
  const previo = cache?.porEstacion || new Map();
  const porEstacion = new Map();
  await enParalelo(estaciones, 4, async (e) => {
    try { porEstacion.set(e, { lecturas: await leerSerie(e), error: null }); }
    catch (err) { console.error(`[arroyos] estación ${e}:`, err.message); porEstacion.set(e, { lecturas: previo.get(e)?.lecturas || [], error: err.message }); }
  });
  cache = { t: Date.now(), consultadoEn: new Date().toISOString(), porEstacion };
}

/** Estado actual de todos los puntos. `forzar` ignora la caché de 10 minutos. */
async function obtener({ forzar = false } = {}) {
  const puntos = await puntosStore.listar();
  const faltan = puntos.some((p) => p.estacion && p.activo !== false && !cache?.porEstacion.has(p.estacion));
  if (forzar || !cache || faltan || Date.now() - cache.t > TTL_MS) {
    enCurso = enCurso || consultarEstaciones(puntos).finally(() => { enCurso = null; });
    await enCurso;
  }
  const items = puntos.map((p) => {
    const d = p.estacion ? cache.porEstacion.get(p.estacion) : null;
    return { ...resumir(p, d?.lecturas || []), error: d?.error || null };
  });
  return { consultadoEn: cache?.consultadoEn || null, puntos: items };
}

/** Lo que ve el público (embed): sólo puntos activos con sensor, sin notas internas ni errores. */
async function obtenerPublico() {
  const { consultadoEn, puntos } = await obtener();
  return {
    consultadoEn,
    puntos: puntos.filter((p) => p.activo && p.estacion).map(({ nota, error, activo, estacion, ...p }) => p),
  };
}

// Validación de lo que llega del panel. Devuelve el punto limpio o lanza un error con status 400.
const BBOX = { latMin: -28.3, latMax: -25.4, lngMin: -56.1, lngMax: -53.5 };
function error400(msg) { return Object.assign(new Error(msg), { status: 400 }); }
const numeroOpcional = (v, nombre) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < -5 || n > 100) throw error400(`${nombre}: tiene que ser una altura en metros.`);
  return n;
};
function validarPunto(b, id) {
  const texto = (v, max) => String(v ?? "").trim().slice(0, max);
  const nombre = texto(b.nombre, 80), arroyo = texto(b.arroyo, 80);
  if (!nombre) throw error400("Falta el nombre del punto.");
  if (!arroyo) throw error400("Falta el arroyo.");
  const lat = Number(String(b.lat).replace(",", ".")), lng = Number(String(b.lng).replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw error400("Faltan la latitud y la longitud.");
  if (lat < BBOX.latMin || lat > BBOX.latMax || lng < BBOX.lngMin || lng > BBOX.lngMax) throw error400("Las coordenadas están fuera de Misiones (la latitud y la longitud son negativas, por ejemplo -27.37 y -55.89).");
  const estacion = texto(b.estacion, 12);
  if (estacion && !/^\d+$/.test(estacion)) throw error400("El código de estación del SNIH son sólo números.");
  const vigilancia = numeroOpcional(b.vigilancia, "Vigilancia"), alerta = numeroOpcional(b.alerta, "Alerta"), corte = numeroOpcional(b.corte, "Corte de ruta");
  const cargados = [["vigilancia", vigilancia], ["alerta", alerta], ["corte", corte]].filter(([, v]) => v != null);
  for (let i = 1; i < cargados.length; i++) if (cargados[i][1] < cargados[i - 1][1]) throw error400("Los umbrales tienen que ir de menor a mayor: vigilancia, alerta, corte de ruta.");
  return { id, nombre, arroyo, estacion: estacion || null, ruta: texto(b.ruta, 80), municipio: texto(b.municipio, 80), lat, lng, vigilancia, alerta, corte, nota: texto(b.nota, 400), activo: b.activo !== false };
}

const nuevoId = () => `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
async function crearPunto(body) { return puntosStore.guardar(validarPunto(body, nuevoId())); }
async function editarPunto(id, body) {
  if (!(await puntosStore.listar()).some((p) => p.id === id)) throw Object.assign(new Error("Ese punto no existe."), { status: 404 });
  return puntosStore.guardar(validarPunto(body, id));
}
async function borrarPunto(id) {
  if (!(await puntosStore.borrar(id))) throw Object.assign(new Error("Ese punto no existe."), { status: 404 });
}

module.exports = { obtener, obtenerPublico, crearPunto, editarPunto, borrarPunto, resumir, lecturasDe, estadoPorUmbral, validarPunto };
