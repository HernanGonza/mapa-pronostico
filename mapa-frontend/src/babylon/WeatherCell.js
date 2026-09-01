/** Condición meteorológica localizada; no depende del proveedor de datos. */
export function createWeatherCell(input = {}) {
  return {
    id: String(input.id ?? globalThis.crypto?.randomUUID?.() ?? `cell-${Date.now()}`),
    latitude: Number(input.latitude ?? input.lat ?? 0),
    longitude: Number(input.longitude ?? input.lng ?? 0),
    altitude: Number(input.altitude ?? 0),
    radius: Math.max(0, Number(input.radius ?? 0)),
    height: Math.max(0, Number(input.height ?? 0)),
    condition: input.condition ?? "CLEAR",
    intensity: Math.max(0, Math.min(1, Number(input.intensity ?? 0))),
    precipitation: Math.max(0, Number(input.precipitation ?? 0)),
    cloudCoverage: Math.max(0, Math.min(1, Number(input.cloudCoverage ?? 0))),
    cloudType: input.cloudType ?? "default",
    windSpeed: Math.max(0, Number(input.windSpeed ?? 0)),
    windDirection: Number(input.windDirection ?? 0),
    lightningProbability: Math.max(0, Math.min(1, Number(input.lightningProbability ?? 0))),
    movementDirection: Number(input.movementDirection ?? 0),
    movementSpeed: Math.max(0, Number(input.movementSpeed ?? 0)),
    polygon: input.polygon ?? null,
    bounds: input.bounds ?? null,
    grid: input.grid ?? null,
  };
}
