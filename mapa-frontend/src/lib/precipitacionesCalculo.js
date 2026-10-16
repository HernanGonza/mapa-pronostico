/**
 * Cálculos de la planilla de precipitaciones (las «fórmulas» del Excel original): total del mes = suma de los días, anomalía = total − media,
 * y el resumen de un período (lo acumulado en esos días, el acumulado del mes hasta la fecha final, la media y la anomalía).
 */
export const REDES = { 1: "SMN", 2: "INTA", 3: "Automática", 4: "Red Matteo" };
export const REDES_LARGO = { 1: "Estaciones del SMN", 2: "Estaciones del INTA", 3: "Estaciones Automáticas", 4: "Estaciones Red Matteo" };
export const SUPER = { 1: "¹", 2: "²", 3: "³", 4: "⁴" };
export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const pad = (n) => String(n).padStart(2, "0");
export const AR = "America/Argentina/Buenos_Aires";
export const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(new Date());
export const diasDelMes = (anio, mes) => new Date(anio, mes, 0).getDate();
export const fechaDe = (anio, mes, dia) => `${anio}-${pad(mes)}-${pad(dia)}`;
export const primerDia = (anio, mes) => fechaDe(anio, mes, 1);
export const ultimoDia = (anio, mes) => fechaDe(anio, mes, diasDelMes(anio, mes));
export const mesAnterior = ({ anio, mes }) => (mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 });
export const mesSiguiente = ({ anio, mes }) => (mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 });
export const mesDe = (fecha) => ({ anio: Number(fecha.slice(0, 4)), mes: Number(fecha.slice(5, 7)) });
export const ddmm = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
export const ddmmaaaa = (f) => `${ddmm(f)}/${f.slice(0, 4)}`;
export const coma = (n, d = 1) => (n == null || Number.isNaN(n) ? "—" : (Math.round(n * 10 ** d) / 10 ** d).toString().replace(".", ","));
export const redondear = (x) => (x == null ? null : Math.round(x * 10) / 10);
export const normal = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Un número escrito a mano («3,5», «3.5», vacío) → número o null; NaN si no es un número. */
export const leerNumero = (t) => { const s = String(t ?? "").trim().replace(",", "."); return s === "" ? null : Number(s); };

/** [[estacionId, fecha, mm]] → Map «id|fecha» → mm. */
export const indexar = (diarias) => new Map(diarias.map(([id, f, mm]) => [`${id}|${f}`, mm]));

/** Lista de fechas AAAA-MM-DD entre desde y hasta (inclusive). */
export function fechasEntre(desde, hasta) {
  const r = [], fin = Date.parse(`${hasta}T12:00:00Z`);
  for (let t = Date.parse(`${desde}T12:00:00Z`); t <= fin; t += 864e5) r.push(new Date(t).toISOString().slice(0, 10));
  return r;
}

/** Suma de los días con dato de una estación en [desde, hasta]; null si no tiene ninguno. */
export function sumar(mapa, id, desde, hasta) {
  let s = 0, n = 0;
  for (const f of fechasEntre(desde, hasta)) { const v = mapa.get(`${id}|${f}`); if (v != null) { s += v; n++; } }
  return n ? { suma: redondear(s), dias: n } : null;
}

/** Media del mes de una estación: { mediaMm, ref } (ref = la estación de la que «se toma la media», si es el caso). */
export function mediaDe(est, mes, porId) {
  const m = est.medias?.[mes];
  if (!m) return { mediaMm: null, ref: null };
  const ref = m.usaMediaDe != null ? porId.get(m.usaMediaDe) : null;
  return ref ? { mediaMm: ref.medias?.[mes]?.mediaMm ?? null, ref } : { mediaMm: m.mediaMm, ref: null };
}

/** Total, media y anomalía de una estación en un mes (con `mapa` ya con las ediciones). */
export function totalesDelMes(est, anio, mes, mapa, porId) {
  const t = sumar(mapa, est.id, primerDia(anio, mes), ultimoDia(anio, mes)), { mediaMm, ref } = mediaDe(est, mes, porId);
  return { total: t?.suma ?? null, dias: t?.dias ?? 0, media: mediaMm, ref, anomalia: t && mediaMm != null ? redondear(t.suma - mediaMm) : null };
}

/**
 * El resumen de un período para el informe (hoja «informe» del Excel): por estación, lo acumulado entre desde y hasta,
 * el acumulado del mes de `hasta` (del 1.º a `hasta`), la media de ese mes y la anomalía (acumulado del mes − media).
 */
export function resumenPeriodo(estaciones, todas, mapa, desde, hasta) {
  const porId = new Map(todas.map((e) => [e.id, e])), { anio, mes } = mesDe(hasta);
  return estaciones.map((e) => {
    const p = sumar(mapa, e.id, desde, hasta), m = sumar(mapa, e.id, primerDia(anio, mes), hasta), { mediaMm, ref } = mediaDe(e, mes, porId);
    return { id: e.id, nombre: e.nombre, red: e.red, periodo: p?.suma ?? null, diasConDato: p?.dias ?? 0, mes: m?.suma ?? null, media: mediaMm, ref, anomalia: m && mediaMm != null ? redondear(m.suma - mediaMm) : null };
  });
}

/** Los asteriscos «* se toma la media de …» de un conjunto de filas: [{ marca, nombre }] y la marca de cada estación. */
export function notasDeMedia(filas) {
  const refs = [...new Map(filas.filter((f) => f.ref).map((f) => [f.ref.id, f.ref.nombre])).entries()];
  return { leyendas: refs.map(([, nombre], i) => ({ marca: "*".repeat(i + 1), nombre })), marcaDe: (f) => (f.ref ? "*".repeat(1 + refs.findIndex(([id]) => id === f.ref.id)) : "") };
}

/** Color del punto en el mapa según los mm. */
export const ESCALA = [[0, "#c3cad2", "Sin lluvia"], [0.1, "#9fd0f2", "Hasta 10 mm"], [10, "#4a9be0", "10 a 25 mm"], [25, "#1f5fbf", "25 a 50 mm"], [50, "#6b2fb0", "50 a 100 mm"], [100, "#b4233c", "Más de 100 mm"]];
export const colorDe = (mm) => { let c = "#8793a0"; if (mm == null) return c; c = ESCALA[0][1]; for (const [desde, color] of ESCALA) if (mm >= desde) c = color; return c; };
