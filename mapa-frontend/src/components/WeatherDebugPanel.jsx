import { useEffect, useState } from "react";

const PRESETS = ["AUTO", "CLEAR", "FOG", "RAIN", "HEAVY_RAIN", "THUNDERSTORM", "SEVERE_THUNDERSTORM", "HAIL", "EXTREME_HEAT"];

export default function WeatherDebugPanel({ onChange }) {
  const query = new URLSearchParams(window.location.search).get("weather")?.toUpperCase().replaceAll("-", "_") || "AUTO";
  const [value, setValue] = useState({ preset: PRESETS.includes(query) ? query : "AUTO", rain: -1, fog: -1, clouds: -1, wind: -1, lightning: -1 });
  useEffect(() => { onChange(value); }, [onChange, value]);
  const range = (key, label) => <label>{label}<input type="range" min="-1" max="1" step="0.05" value={value[key]} onChange={(e) => setValue((v) => ({ ...v, [key]: Number(e.target.value) }))} /><output>{value[key] < 0 ? "auto" : value[key].toFixed(2)}</output></label>;
  return <details className="weather-debug">
    <summary>Clima DEV</summary>
    <label>Preset<select value={value.preset} onChange={(e) => setValue((v) => ({ ...v, preset: e.target.value }))}>{PRESETS.map((p) => <option key={p}>{p}</option>)}</select></label>
    {range("rain", "Lluvia")}{range("fog", "Niebla")}{range("clouds", "Nubes")}{range("wind", "Viento")}{range("lightning", "Rayos")}
  </details>;
}
