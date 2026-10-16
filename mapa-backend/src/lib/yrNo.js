/**
 * yr.no (Instituto Meteorológico de Noruega, MET Norway) por su API pública Locationforecast 2.0: un pedido por punto.
 * Se guarda con la misma forma que las series horarias de Open-Meteo (`{ horas, puntos: [{ hourly: { <variable>: [...] } }] }`, hora de Misiones),
 * así el ensamble lo trata igual que a ECMWF, GFS, ICON y GEM.
 *
 * Reglas del servicio: User-Agent propio con un contacto (sin él responde 403), no más de 20 pedidos por segundo y respetar la caché
 * (cabecera `Expires`: el pronóstico se renueva cada ~30–60 min). Los datos son CC BY 4.0: hay que citar a MET Norway.
 *
 * Fuera de Noruega trae un paso horario sólo las primeras ~60 h y después cada 6 h con acumulados de 6 h. Se usa únicamente la parte horaria:
 * pasadas esas horas el modelo «no llega» (queda en blanco, como el WRF-SMN pasadas las 72 h) en vez de inventar valores intermedios.
 * No publica ráfagas ni CAPE.
 */
const ART = "America/Argentina/Buenos_Aires";
const URL_BASE = "https://api.met.no/weatherapi/locationforecast/2.0/complete";
const USER_AGENT = () => process.env.YR_USER_AGENT || "AlertaTempranaMisiones/1.0 alertatemprana@ecologia.misiones.gob.ar";
const CONCURRENCIA = 4;
const HORA = 3600e3, OFFSET_ART = 3 * HORA; // Misiones: UTC−3, sin horario de verano
const DIAS_ATRAS = 7, DIAS_ADELANTE = 9;
const diaART = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: ART }).format(new Date(ms));
const sumarDias = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** «AAAA-MM-DDTHH:00» de Misiones para un instante UTC (ms). */
const stampART = (ms) => new Date(ms - OFFSET_ART).toISOString().slice(0, 13) + ":00";

async function pedirPunto(p) {
  const url = `${URL_BASE}?lat=${p.lat.toFixed(4)}&lon=${p.lng.toFixed(4)}`;
  let ultimo = null;
  for (let intento = 0; intento < 3; intento++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": USER_AGENT(), Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
      if (r.status === 403) throw Object.assign(new Error("yr.no rechazó el pedido (HTTP 403): falta o no sirve el User-Agent (variable YR_USER_AGENT)."), { fatal: true });
      if (r.status === 429) throw Object.assign(new Error("yr.no: demasiados pedidos (HTTP 429)."), { fatal: true });
      if (!r.ok) throw new Error(`yr.no: HTTP ${r.status}.`);
      const j = await r.json();
      if (!j?.properties?.timeseries?.length) throw new Error("yr.no devolvió una respuesta inesperada.");
      return { j, expira: Date.parse(r.headers.get("expires") || "") || null };
    } catch (e) { ultimo = e; if (e.fatal) break; await new Promise((res) => setTimeout(res, 2500)); }
  }
  throw ultimo;
}

/** Las horas de Misiones del rango que cubre el ensamble (de 7 días atrás a 9 adelante), como en Open-Meteo. */
function horasDelRango() {
  const hoy = diaART(Date.now()), horas = [];
  for (let d = sumarDias(hoy, -DIAS_ATRAS); d <= sumarDias(hoy, DIAS_ADELANTE); d = sumarDias(d, 1)) for (let h = 0; h < 24; h++) horas.push(`${d}T${String(h).padStart(2, "0")}:00`);
  return horas;
}

const redondear = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/** Convierte la respuesta de un punto en columnas alineadas con `indice` (stamp → posición). */
function columnas(j, indice, n) {
  const col = () => new Array(n).fill(null);
  const c = { temperature_2m: col(), apparent_temperature: col(), precipitation: col(), wind_speed_10m: col(), wind_direction_10m: col(), relative_humidity_2m: col(), cloud_cover: col(), dew_point_2m: col() };
  for (const t of j.properties.timeseries) {
    const horaria = t.data?.next_1_hours; // el tramo horario (primeras ~60 h): lo posterior viene cada 6 h y no se usa
    if (!horaria) continue;
    const ms = Date.parse(t.time), i = indice.get(stampART(ms)), d = t.data.instant?.details || {};
    if (i != null) {
      if (d.air_temperature != null) c.temperature_2m[i] = d.air_temperature;
      if (d.apparent_air_temperature != null) c.apparent_temperature[i] = d.apparent_air_temperature;
      if (d.wind_speed != null) c.wind_speed_10m[i] = redondear(d.wind_speed * 3.6); // m/s → km/h
      if (d.wind_from_direction != null) c.wind_direction_10m[i] = d.wind_from_direction;
      if (d.relative_humidity != null) c.relative_humidity_2m[i] = d.relative_humidity;
      if (d.cloud_area_fraction != null) c.cloud_cover[i] = d.cloud_area_fraction;
      if (d.dew_point_temperature != null) c.dew_point_2m[i] = d.dew_point_temperature;
    }
    // La lluvia de «next_1_hours» es la de la hora que empieza en `t`: en la convención de Open-Meteo (acumulado de la hora anterior) va en t + 1 h.
    const j2 = indice.get(stampART(ms + HORA)), mm = horaria.details?.precipitation_amount;
    if (j2 != null && mm != null) c.precipitation[j2] = mm;
  }
  return c;
}

/** Baja los puntos [{ lat, lng }] y devuelve { datos: { horas, puntos }, corrida: ISO, expira: ms|null }. */
async function bajarYr(puntos) {
  const horas = horasDelRango(), indice = new Map(horas.map((h, i) => [h, i]));
  const salida = new Array(puntos.length);
  let corrida = null, expira = null, siguiente = 0;
  await Promise.all(Array.from({ length: CONCURRENCIA }, async () => {
    while (siguiente < puntos.length) {
      const k = siguiente++;
      const { j, expira: e } = await pedirPunto(puntos[k]);
      salida[k] = { hourly: columnas(j, indice, horas.length) };
      const act = j.properties.meta?.updated_at;
      if (act && (!corrida || act < corrida)) corrida = act; // la más vieja de todos los puntos
      if (e && (!expira || e < expira)) expira = e;
    }
  }));
  if (!salida.some((p) => p.hourly.temperature_2m.some((x) => x != null))) throw new Error("yr.no no trajo datos horarios.");
  return { datos: { horas, puntos: salida }, corrida: new Date(corrida || Date.now()).toISOString(), expira };
}

module.exports = { bajarYr, columnas, stampART };
