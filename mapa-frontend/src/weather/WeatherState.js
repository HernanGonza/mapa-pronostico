import { normalize } from "../lib/normalizeText";

function presetDeCondicion(condicion, temperature, windSpeed) {
  const c = normalize(condicion || "");
  if (/granizo/.test(c)) return "HAIL";
  if (/tormenta/.test(c)) return /severa|fuerte/.test(c) ? "SEVERE_THUNDERSTORM" : "THUNDERSTORM";
  if (/intensa/.test(c)) return "HEAVY_RAIN";
  if (/llovizna|lluvia leve|lluvias leves|lluvias debiles/.test(c)) return "LIGHT_RAIN";
  if (/lluvia|chaparron/.test(c)) return "RAIN";
  if (/niebla/.test(c)) return "FOG";
  if (/neblina|bruma/.test(c)) return "MIST";
  if (/cubierto/.test(c)) return "OVERCAST";
  if (/nublado/.test(c) && !/parcial|algo/.test(c)) return "CLOUDY";
  if (/parcial|algo nublado/.test(c)) return "PARTLY_CLOUDY";
  if (Number(temperature) >= 37) return "EXTREME_HEAT";
  if (Number(windSpeed) >= 15) return "HIGH_WIND";
  return "CLEAR";
}

function muestraGrilla(grilla, lngLat, hora) {
  if (!grilla?.puntos?.length || !lngLat) return {};
  let mejor = null;
  let distancia = Infinity;
  for (const p of grilla.puntos) {
    const d = (p.lng - lngLat[0]) ** 2 + (p.lat - lngLat[1]) ** 2;
    if (d < distancia) { distancia = d; mejor = p; }
  }
  if (!mejor) return {};
  const max = Math.max(0, (grilla.horas?.length || 1) - 1);
  const hf = Math.max(0, Math.min(max, Number(hora) || 0));
  const h0 = Math.floor(hf);
  const h1 = Math.min(max, h0 + 1);
  const t = hf - h0;
  const valor = (key) => (mejor[key]?.[h0] ?? 0) * (1 - t) + (mejor[key]?.[h1] ?? 0) * t;
  const u = valor("windU");
  const v = valor("windV");
  return {
    temperature: valor("temp"),
    precipitationRate: valor("precip"),
    cloudCoverage: valor("cloud"),
    windSpeed: Math.hypot(u, v),
    windDirection: (Math.atan2(u, -v) * 180) / Math.PI,
  };
}

export function normalizeWeather({ condicion, pronostico, grilla, lngLat, hora, isDay = true, override = null }) {
  const modelo = muestraGrilla(grilla, lngLat, hora);
  const condition = override?.condition || condicion || pronostico?.CONDICION || "sin dato";
  const tPronostico = Number(pronostico?.TMAX);
  const temperature = override?.temperature ?? modelo.temperature ?? (Number.isFinite(tPronostico) ? tPronostico : null);
  const preset = override?.preset || presetDeCondicion(condition, temperature, modelo.windSpeed);
  return {
    preset,
    condition,
    temperature,
    feelsLike: override?.feelsLike ?? null,
    humidity: override?.humidity ?? null,
    precipitation: modelo.precipitationRate ?? 0,
    precipitationRate: override?.precipitationRate ?? modelo.precipitationRate ?? 0,
    cloudCoverage: override?.cloudCoverage ?? modelo.cloudCoverage ?? null,
    visibility: override?.visibility ?? null,
    windSpeed: override?.windSpeed ?? modelo.windSpeed ?? 0,
    windDirection: override?.windDirection ?? modelo.windDirection ?? 0,
    windGust: override?.windGust ?? null,
    pressure: override?.pressure ?? null,
    lightningProbability: override?.lightningProbability ?? null,
    fog: override?.fog ?? null,
    isDay,
    sunrise: override?.sunrise ?? null,
    sunset: override?.sunset ?? null,
    precipitationZones: override?.precipitationZones || [],
  };
}
