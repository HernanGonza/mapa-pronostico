import { API_URL } from "./config";

async function handleJson(res) {
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }
  return res.json();
}

export async function parseDocx(file) {
  const form = new FormData();
  form.append("pronostico", file);
  const res = await fetch(`${API_URL}/api/pronostico/parse`, {
    method: "POST",
    body: form,
  });
  const data = await handleJson(res);
  return data.filas;
}

export async function getMunicipios() {
  const res = await fetch(`${API_URL}/api/municipios`);
  return handleJson(res);
}

/**
 * Los 79 polígonos reales (GeoJSON, WGS84). Geometría pura, sin datos de
 * pronóstico — cambia poco, se puede cachear agresivo en el cliente.
 */
export async function getMunicipiosGeojson() {
  const res = await fetch(`${API_URL}/api/municipios/geojson`);
  return handleJson(res);
}

/**
 * Territorios que rodean Misiones (Paraguay, Brasil, Argentina/Corrientes,
 * Uruguay, Bolivia), recortados a un recuadro alrededor de la provincia.
 * Solo para contexto visual — se dibuja plano.
 */
export async function getContextoGeojson() {
  const res = await fetch(`${API_URL}/api/contexto/geojson`);
  return handleJson(res);
}

/** Tierra firme mundial simplificada — fondo plano del mapa. */
export async function getMundoGeojson() {
  const res = await fetch(`${API_URL}/api/mundo/geojson`);
  return handleJson(res);
}

/**
 * Campo de viento global (formato GFS-JSON) para la animación de
 * partículas sobre todo el globo. Es un snapshot servido como estático
 * desde el propio front, no del backend.
 */
export async function getVientoGlobal() {
  const res = await fetch("/wind-global.json");
  return handleJson(res);
}

/**
 * Grilla de viento real (velocidad + dirección, modelo numérico vía
 * Open-Meteo) para animar las partículas. Devuelve { puntos, gridSize,
 * bounds } — gridSize/bounds los define el back, no hay que duplicarlos.
 */
export async function getVientoGrilla() {
  const res = await fetch(`${API_URL}/api/viento/grilla`);
  return handleJson(res);
}

/**
 * Endpoint principal del mapa interactivo: los 79 municipios con lat/lng
 * real + el pronóstico de la estación más cercana (de las 13 oficiales).
 */
export async function getMapaActual() {
  const res = await fetch(`${API_URL}/api/pronostico/mapa`);
  return handleJson(res);
}

/**
 * Vista previa (sin publicar) de los 79 municipios con los datos que el
 * operador está editando en ese momento.
 */
export async function getMapaPreview(filas) {
  const res = await fetch(`${API_URL}/api/pronostico/mapa-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filas }),
  });
  const data = await handleJson(res);
  return data.municipios;
}

/**
 * Último pronóstico publicado con su metadata: `{ publicadoEn, filas }`.
 * `null` si todavía no se publicó nada.
 */
export async function getActual() {
  const res = await fetch(`${API_URL}/api/pronostico/actual`);
  if (res.status === 404) return null;
  return handleJson(res);
}

export async function publicar(filas) {
  const res = await fetch(`${API_URL}/api/pronostico/publicar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filas }),
  });
  return handleJson(res);
}

/**
 * Pide al back que genere el PNG (server-side, con canvas) y devuelve un
 * Blob listo para descargar. Usa el último publicado si no se pasan filas.
 */
export async function renderPngEnBack(filas) {
  const res = await fetch(`${API_URL}/api/pronostico/render-png`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(filas ? { filas } : {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res.blob();
}

export function iconUrl(condicion) {
  // Resuelto en el back (ignora tildes/mayúsculas) en vez de armar el
  // nombre de archivo a mano acá.
  return `${API_URL}/api/materiales/icono/${encodeURIComponent(condicion)}`;
}
