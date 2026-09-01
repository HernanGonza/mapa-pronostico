import { createWeatherCell } from "./WeatherCell";

const R = Math.PI / 180;
const EARTH_KM = 6371;
const distanceKm = (a, b) => {
  const dLat = (b.latitude - a.latitude) * R;
  const dLng = (b.longitude - a.longitude) * R;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * R) * Math.cos(b.latitude * R) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(x));
};

/**
 * Registro espacial preparado para grillas/radar. No crea fenómenos por sí
 * mismo: en producción sólo se alimenta con celdas derivadas de datos.
 */
export class WeatherCellManager {
  constructor({ maxDistanceKm = 80 } = {}) {
    this.maxDistanceKm = maxDistanceKm;
    this.cells = new Map();
    this.listeners = new Set();
  }
  setCells(cells = []) {
    this.cells.clear();
    for (const input of cells) {
      const cell = createWeatherCell(input);
      if (cell.radius > 0 || cell.polygon || cell.bounds || cell.grid) this.cells.set(cell.id, cell);
    }
    this.emit();
  }
  upsert(cell) { const value = createWeatherCell(cell); this.cells.set(value.id, value); this.emit(); return value; }
  remove(id) { const removed = this.cells.delete(String(id)); if (removed) this.emit(); return removed; }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  visibleAt({ latitude, longitude, maxDistanceKm = this.maxDistanceKm } = {}) {
    const origin = { latitude: Number(latitude), longitude: Number(longitude) };
    return [...this.cells.values()]
      .map((cell) => ({ cell, distanceKm: distanceKm(origin, cell) }))
      .filter(({ cell, distanceKm: d }) => d <= maxDistanceKm + cell.radius)
      .map(({ cell, distanceKm: d }) => ({ cell, distanceKm: d, lod: d > 50 ? 0 : d > 25 ? 1 : d > 8 ? 2 : 3 }));
  }
  emit() { for (const listener of this.listeners) listener([...this.cells.values()]); }
}

export { distanceKm };
