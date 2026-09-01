/** Interfaz de audio sin archivos ni derechos de terceros. */
export class AudioManager {
  constructor() { this.rain = 0; this.wind = 0; this.enabled = false; }
  setRainIntensity(value) { this.rain = Math.max(0, Math.min(1, Number(value) || 0)); }
  setWindIntensity(value) { this.wind = Math.max(0, Math.min(1, Number(value) || 0)); }
  playThunder(_distance = 0) { /* preparado para un banco de sonidos propio */ }
  setEnvironment(_environment) {}
  dispose() {}
}
