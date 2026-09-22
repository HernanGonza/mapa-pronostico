/**
 * Clima diario (temperatura, humedad, viento, lluvia) por coordenada, vía
 * Open-Meteo (https://open-meteo.com — API abierta, gratuita, sin key).
 *
 * Reemplaza lo que ECOSOTAT arma combinando 4 estaciones del SMN (viento y
 * temperatura de un archivo público, pero la LLUVIA la sacaba con Selenium
 * de smn.gob.ar/observaciones — hoy detrás de un challenge de Cloudflare,
 * ver charla) y 4 estaciones provinciales de un servidor de INA con
 * credenciales de 2017 que no respondió al probarlo. Acá se pide el clima
 * directo en el centroide de cada uno de los 17 departamentos (no hace
 * falta que haya una estación cerca de cada uno).
 *
 * Un valor por variable y por día: T/H/W instantáneos a HORA_REFERENCIA
 * (9h local, mismo criterio horario que usaba ECOSOTAT), lluvia = suma del
 * día calendario completo (0-24h locales) — no es exactamente la ventana
 * "9h de ayer a 9h de hoy" que arma el Java sumando dos mitades, pero es
 * la misma idea (un total de 24h) y es lo que separa limpio la API.
 */
const HORA_REFERENCIA = 9;
const VARIABLES_HORARIAS = "temperature_2m,relative_humidity_2m,wind_speed_10m";
const TIMEOUT_MS = 15000;

async function pedir(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error(`Open-Meteo: HTTP ${r.status}.`);
    return await r.json();
  } catch (e) {
    throw e.name === "AbortError" ? new Error(`Open-Meteo: tiempo de espera agotado (${url}).`) : e;
  } finally {
    clearTimeout(timer);
  }
}

/** Clima de un día pasado concreto — API de archivo histórico (ERA5, con
 * algunos días de rezago respecto de hoy; para días recientes usar
 * climaReciente). `fechaISO`: "YYYY-MM-DD". */
async function climaHistorico(lat, lng, fechaISO) {
  const serie = await climaHistoricoEnRango(lat, lng, fechaISO, fechaISO);
  const dia = serie.get(fechaISO);
  if (!dia) throw new Error(`Open-Meteo: sin datos históricos para ${fechaISO} (${lat},${lng}).`);
  return dia;
}

/** Clima de TODO un rango de días pasados — un solo pedido HTTP (no uno
 * por día), pensado para el backfill. Devuelve un Map fecha -> clima. */
async function climaHistoricoEnRango(lat, lng, desdeISO, hastaISO) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${desdeISO}&end_date=${hastaISO}&hourly=${VARIABLES_HORARIAS}&daily=precipitation_sum&timezone=America%2FArgentina%2FBuenos_Aires`;
  const data = await pedir(url);
  const dias = data.daily?.time || [];
  const resultado = new Map();
  dias.forEach((fecha, i) => {
    const temperatura = data.hourly.temperature_2m[i * 24 + HORA_REFERENCIA];
    if (temperatura == null) return; // día sin dato horario todavía (muy reciente) — se salta, no rompe el rango.
    resultado.set(fecha, {
      fecha,
      temperatura,
      humedad: data.hourly.relative_humidity_2m[i * 24 + HORA_REFERENCIA],
      viento: data.hourly.wind_speed_10m[i * 24 + HORA_REFERENCIA],
      precipitacion: data.daily.precipitation_sum[i] ?? 0,
    });
  });
  return resultado;
}

/** Clima de hoy y de los `diasPasados` días anteriores — API de pronóstico
 * (incluye el análisis reciente, sin el rezago del archivo histórico).
 * Devuelve un array ordenado de más viejo a más nuevo (el último es hoy). */
async function climaReciente(lat, lng, diasPasados = 2) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=${VARIABLES_HORARIAS}&daily=precipitation_sum&past_days=${diasPasados}&forecast_days=1&timezone=America%2FArgentina%2FBuenos_Aires`;
  const data = await pedir(url);
  const dias = data.daily?.time || [];
  if (!dias.length) throw new Error(`Open-Meteo: respuesta sin días (${lat},${lng}).`);
  return dias.map((fecha, i) => ({
    fecha,
    temperatura: data.hourly.temperature_2m[i * 24 + HORA_REFERENCIA],
    humedad: data.hourly.relative_humidity_2m[i * 24 + HORA_REFERENCIA],
    viento: data.hourly.wind_speed_10m[i * 24 + HORA_REFERENCIA],
    precipitacion: data.daily.precipitation_sum[i] ?? 0,
  }));
}

module.exports = { climaHistorico, climaHistoricoEnRango, climaReciente, HORA_REFERENCIA };
