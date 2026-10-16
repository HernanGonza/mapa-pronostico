/**
 * Armado de las series horarias que guarda el ensamble (la forma de Open-Meteo: `{ horas, puntos: [{ hourly: { <variable>: [...] } }] }`, con las
 * horas de Misiones) a partir de modelos que publican cada 1, 3 o 6 horas: interpolación lineal de lo instantáneo, reparto de los acumulados
 * y las magnitudes derivadas (viento, humedad, punto de rocío). Funciones puras, sin red.
 */
const ART = "America/Argentina/Buenos_Aires";
const HORA = 3600e3, OFFSET_ART = 3 * HORA; // Misiones: UTC−3, sin horario de verano
const DIAS_ATRAS = 7, DIAS_ADELANTE = 9; // el rango que cubre el ensamble
const diaART = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: ART }).format(new Date(ms));
const sumarDias = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** «AAAA-MM-DDTHH:00» de Misiones para un instante UTC (ms). */
const stampART = (ms) => new Date(ms - OFFSET_ART).toISOString().slice(0, 13) + ":00";
const msDeStamp = (stamp) => Date.parse(`${stamp}:00-03:00`);

/** Las horas de Misiones que cubre el ensamble (de 7 días atrás a 9 adelante): { horas: [stamp…], ms: [UTC ms…] }. */
function horasDelRango(ahora = Date.now()) {
  const hoy = diaART(ahora), horas = [];
  for (let d = sumarDias(hoy, -DIAS_ATRAS); d <= sumarDias(hoy, DIAS_ADELANTE); d = sumarDias(d, 1)) for (let h = 0; h < 24; h++) horas.push(`${d}T${String(h).padStart(2, "0")}:00`);
  return { horas, ms: horas.map(msDeStamp) };
}

/**
 * Una magnitud instantánea que se conoce en unos pocos instantes `muestras` [{ ms, v }] → valor en cada hora de `horasMs`, por interpolación
 * lineal entre muestras vecinas. Antes de la primera y después de la última queda en null; entre dos muestras separadas por más de `huecoMax`
 * horas también (no se inventa un hueco largo).
 */
function interpolar(muestras, horasMs, huecoMax = 7) {
  const m = muestras.filter((x) => x.v != null && Number.isFinite(x.v)).sort((a, b) => a.ms - b.ms), salida = new Array(horasMs.length).fill(null);
  if (!m.length) return salida;
  let k = 0;
  horasMs.forEach((t, i) => {
    if (t < m[0].ms || t > m.at(-1).ms) return;
    while (k < m.length - 2 && m[k + 1].ms < t) k++;
    const a = m[k], b = m[Math.min(k + 1, m.length - 1)];
    if (t === a.ms) { salida[i] = a.v; return; }
    if (t === b.ms) { salida[i] = b.v; return; }
    if (b.ms - a.ms > huecoMax * HORA) return;
    salida[i] = a.v + (b.v - a.v) * ((t - a.ms) / (b.ms - a.ms));
  });
  return salida;
}

/**
 * Lluvia acumulada: cada muestra { ms, mm, horas } es lo caído en las `horas` que terminan en `ms`. Se reparte parejo entre esas horas y la
 * serie queda con la convención de Open-Meteo (la lluvia de la hora que TERMINA en t va en t). Una hora sin ninguna muestra que la cubra queda en null.
 */
function repartirAcumulado(muestras, horasMs) {
  const idx = new Map(horasMs.map((t, i) => [t, i])), salida = new Array(horasMs.length).fill(null);
  for (const { ms, mm, horas } of muestras) {
    if (mm == null || !Number.isFinite(mm)) continue;
    for (let k = 0; k < horas; k++) { const i = idx.get(ms - k * HORA); if (i != null) salida[i] = Math.max(0, mm) / horas; }
  }
  return salida;
}

/** Viento a partir de sus componentes (m/s): velocidad en km/h y dirección de DONDE sopla (°). */
const velocidadKmh = (u, v) => (u == null || v == null ? null : Math.hypot(u, v) * 3.6);
const direccionViento = (u, v) => (u == null || v == null ? null : (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360);
/** Punto de rocío (°C) con la fórmula de Magnus a partir de la temperatura (°C) y la humedad relativa (%). */
function puntoDeRocio(t, hr) {
  if (t == null || hr == null || hr <= 0) return null;
  const a = Math.log(hr / 100) + 17.625 * t / (243.04 + t);
  return 243.04 * a / (17.625 - a);
}
/** Humedad relativa (%) a partir de la temperatura y el punto de rocío (°C), nunca más de 100. */
function humedadRelativa(t, td) {
  if (t == null || td == null) return null;
  const e = (x) => Math.exp(17.625 * x / (243.04 + x));
  return Math.min(100, Math.max(0, 100 * e(Math.min(td, t)) / e(t)));
}
const redondear = (x, d = 1) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const aCelsius = (k) => (k == null || !Number.isFinite(k) ? null : k - 273.15);

module.exports = { ART, HORA, horasDelRango, interpolar, repartirAcumulado, velocidadKmh, direccionViento, puntoDeRocio, humedadRelativa, redondear, aCelsius, stampART, msDeStamp };
