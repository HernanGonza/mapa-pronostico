export const WEATHER_QUALITY = {
  LOW: { fps: 24, pixels: 900000, dpr: 1.15, rain: 180, hail: 45, clouds: 8, stars: 45 },
  MEDIUM: { fps: 30, pixels: 1500000, dpr: 1.4, rain: 320, hail: 75, clouds: 11, stars: 65 },
  HIGH: { fps: 30, pixels: 1900000, dpr: 1.6, rain: 440, hail: 110, clouds: 14, stars: 85 },
};

export function autoWeatherQuality() {
  if (typeof window === "undefined") return "MEDIUM";
  const nav = navigator;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return "LOW";
  if (window.matchMedia?.("(max-width: 720px)").matches) return "LOW";
  if ((nav.deviceMemory && nav.deviceMemory <= 4) || (nav.hardwareConcurrency || 4) <= 4) return "LOW";
  return (nav.deviceMemory || 4) >= 8 && (nav.hardwareConcurrency || 4) >= 8 ? "HIGH" : "MEDIUM";
}
