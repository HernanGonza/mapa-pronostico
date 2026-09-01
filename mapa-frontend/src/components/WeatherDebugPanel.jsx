import { useEffect, useState } from "react";

const PRESETS = ["AUTO", "CLEAR", "PARTLY_CLOUDY", "CLOUDY", "OVERCAST", "FOG", "MIST", "LIGHT_RAIN", "RAIN", "HEAVY_RAIN", "THUNDERSTORM", "NIGHT_THUNDERSTORM", "SEVERE_THUNDERSTORM", "HAIL", "HIGH_WIND", "EXTREME_HEAT"];
const PRESET_LABELS = {
  AUTO: "Automático (clima del municipio)",
  CLEAR: "Despejado",
  PARTLY_CLOUDY: "Parcialmente nublado",
  CLOUDY: "Nublado",
  OVERCAST: "Cubierto",
  FOG: "Niebla",
  MIST: "Neblina",
  LIGHT_RAIN: "Lluvia leve",
  RAIN: "Lluvia",
  HEAVY_RAIN: "Lluvia intensa",
  THUNDERSTORM: "Tormenta eléctrica",
  NIGHT_THUNDERSTORM: "Tormenta eléctrica nocturna",
  SEVERE_THUNDERSTORM: "Tormenta eléctrica severa",
  HAIL: "Granizo",
  HIGH_WIND: "Viento fuerte",
  EXTREME_HEAT: "Calor extremo",
};

export default function WeatherDebugPanel({ onChange }) {
  const query = new URLSearchParams(window.location.search).get("weather")?.toUpperCase().replaceAll("-", "_") || "AUTO";
  const [value, setValue] = useState({ preset: PRESETS.includes(query) ? query : "AUTO", rain: -1, fog: -1, clouds: -1, wind: -1, lightning: -1 });
  useEffect(() => { onChange(value); }, [onChange, value]);
  const range = (key, label) => <label>{label}<input type="range" min="-1" max="1" step="0.05" value={value[key]} onChange={(e) => setValue((v) => ({ ...v, [key]: Number(e.target.value) }))} /><output>{value[key] < 0 ? "automático" : value[key].toFixed(2)}</output></label>;
  return <details className="weather-debug">
    <summary>Laboratorio meteorológico</summary>
    <label>Condición<select value={value.preset} onChange={(e) => setValue((v) => ({ ...v, preset: e.target.value }))}>{PRESETS.map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}</select></label>
    {range("rain", "Lluvia")}{range("fog", "Niebla")}{range("clouds", "Nubes")}{range("wind", "Viento")}{range("lightning", "Rayos")}
  </details>;
}
