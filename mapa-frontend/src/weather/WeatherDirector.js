import { presetVisual, VISUAL_KEYS } from "./WeatherPresets";

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

export class WeatherDirector {
  constructor({ audio = null } = {}) {
    this.audio = audio || { setRainIntensity() {}, setWindIntensity() {}, playThunder() {} };
    this.current = { ...presetVisual("CLEAR") };
    this.from = { ...this.current };
    this.target = { ...this.current };
    this.output = { ...this.current, phase: "ambient", nearPrecipitation: 0, distantPrecipitation: 0 };
    this.weather = null;
    this.startedAt = performance.now();
    this.duration = 1;
    this.key = "";
  }

  transitionTo(weather, { duration = 4000 } = {}) {
    const key = JSON.stringify([weather?.preset, weather?.condition, weather?.isDay,
      weather?.precipitationRate, weather?.cloudCoverage, weather?.windSpeed]);
    if (key === this.key) return;
    this.key = key;
    this.weather = weather;
    Object.assign(this.from, this.current);
    Object.assign(this.target, presetVisual(weather?.preset));
    // Los valores medidos refinan el preset, sin inventar campos ausentes.
    if (weather?.cloudCoverage != null) this.target.clouds = clamp01(weather.cloudCoverage / 100);
    if (weather?.windSpeed != null) this.target.wind = Math.max(this.target.wind, clamp01(weather.windSpeed / 20));
    if (weather?.precipitationRate > 0) this.target.rain = Math.max(this.target.rain, clamp01(weather.precipitationRate / 8));
    if (weather?.lightningProbability != null) this.target.lightning = clamp01(weather.lightningProbability);
    if (weather?.fog != null) this.target.fog = clamp01(weather.fog);
    this.startedAt = performance.now();
    this.duration = Math.max(1, duration);
  }

  update(now, flightProgress = 1) {
    const t = smooth((now - this.startedAt) / this.duration);
    for (const key of VISUAL_KEYS) {
      this.current[key] = this.from[key] + (this.target[key] - this.from[key]) * t;
    }
    const p = clamp01(flightProgress);
    const atmosphere = smooth(p / 0.42);
    const distant = smooth((p - 0.18) / 0.46);
    const near = smooth((p - 0.58) / 0.38);
    for (const key of VISUAL_KEYS) this.output[key] = this.current[key];
    this.output.clouds *= atmosphere;
    this.output.fog *= atmosphere;
    this.output.haze *= atmosphere;
    this.output.darkness *= atmosphere;
    this.output.distantPrecipitation = this.current.distantRain * distant;
    this.output.nearPrecipitation = this.current.rain * near;
    this.output.hail *= near;
    this.output.wetness *= near;
    this.output.lightning *= distant;
    this.output.heatHaze *= near;
    this.output.phase = p < 0.3 ? "approach" : p < 0.62 ? "descent" : p < 0.98 ? "entry" : "ambient";
    this.output.weather = this.weather;
    this.audio.setRainIntensity(this.output.nearPrecipitation);
    this.audio.setWindIntensity(this.output.wind);
    return this.output;
  }
}
