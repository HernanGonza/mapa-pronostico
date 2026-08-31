export const WEATHER_PRESETS = {
  CLEAR: { clouds: 0.03, fog: 0.02, haze: 0.08, rain: 0, distantRain: 0, hail: 0, wind: 0.12, wetness: 0, lightning: 0, darkness: 0, heatHaze: 0 },
  PARTLY_CLOUDY: { clouds: 0.35, fog: 0.03, haze: 0.1, rain: 0, distantRain: 0, hail: 0, wind: 0.18, wetness: 0, lightning: 0, darkness: 0.08, heatHaze: 0 },
  CLOUDY: { clouds: 0.68, fog: 0.08, haze: 0.15, rain: 0, distantRain: 0, hail: 0, wind: 0.2, wetness: 0, lightning: 0, darkness: 0.22, heatHaze: 0 },
  OVERCAST: { clouds: 0.95, fog: 0.16, haze: 0.22, rain: 0, distantRain: 0, hail: 0, wind: 0.25, wetness: 0.08, lightning: 0, darkness: 0.38, heatHaze: 0 },
  FOG: { clouds: 0.7, fog: 0.9, haze: 0.5, rain: 0, distantRain: 0, hail: 0, wind: 0.05, wetness: 0.2, lightning: 0, darkness: 0.2, heatHaze: 0 },
  MIST: { clouds: 0.55, fog: 0.48, haze: 0.4, rain: 0, distantRain: 0, hail: 0, wind: 0.08, wetness: 0.15, lightning: 0, darkness: 0.12, heatHaze: 0 },
  LIGHT_RAIN: { clouds: 0.78, fog: 0.2, haze: 0.25, rain: 0.28, distantRain: 0.35, hail: 0, wind: 0.24, wetness: 0.4, lightning: 0, darkness: 0.28, heatHaze: 0 },
  RAIN: { clouds: 0.88, fog: 0.27, haze: 0.34, rain: 0.6, distantRain: 0.68, hail: 0, wind: 0.36, wetness: 0.72, lightning: 0, darkness: 0.42, heatHaze: 0 },
  HEAVY_RAIN: { clouds: 1, fog: 0.42, haze: 0.46, rain: 1, distantRain: 1, hail: 0, wind: 0.58, wetness: 1, lightning: 0.03, darkness: 0.58, heatHaze: 0 },
  THUNDERSTORM: { clouds: 1, fog: 0.36, haze: 0.42, rain: 0.88, distantRain: 1, hail: 0, wind: 0.66, wetness: 1, lightning: 0.55, darkness: 0.72, heatHaze: 0 },
  SEVERE_THUNDERSTORM: { clouds: 1, fog: 0.5, haze: 0.54, rain: 1, distantRain: 1, hail: 0.15, wind: 0.86, wetness: 1, lightning: 0.82, darkness: 0.86, heatHaze: 0 },
  HAIL: { clouds: 1, fog: 0.35, haze: 0.4, rain: 0.68, distantRain: 0.8, hail: 0.85, wind: 0.72, wetness: 0.9, lightning: 0.18, darkness: 0.65, heatHaze: 0 },
  HIGH_WIND: { clouds: 0.45, fog: 0.06, haze: 0.25, rain: 0, distantRain: 0, hail: 0, wind: 1, wetness: 0, lightning: 0, darkness: 0.12, heatHaze: 0 },
  EXTREME_HEAT: { clouds: 0.04, fog: 0, haze: 0.46, rain: 0, distantRain: 0, hail: 0, wind: 0.14, wetness: 0, lightning: 0, darkness: 0, heatHaze: 0.72 },
};

export const VISUAL_KEYS = Object.keys(WEATHER_PRESETS.CLEAR);

export function presetVisual(id) {
  return WEATHER_PRESETS[id] || WEATHER_PRESETS.CLOUDY;
}
