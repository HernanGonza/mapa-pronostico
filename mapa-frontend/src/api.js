import { API_URL } from "./config";

// El back setea el cookie de sesión como httpOnly — hace falta pedirle al
// fetch que lo mande (y lo reciba) aunque front y back vivan en orígenes
// distintos (Vercel/Render en vez de estar detrás del mismo Caddy).
const CON_SESION = { credentials: "include" };

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
    ...CON_SESION,
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

/** Países del mundo (polígonos + fronteras). */
export async function getMundoGeojson() {
  const res = await fetch(`${API_URL}/api/mundo/geojson`);
  return handleJson(res);
}

/** GeoJSON de división política / rótulos: `paises-labels`, `provincias`, `provincias-labels`. */
export async function getGeo(nombre) {
  const res = await fetch(`${API_URL}/api/geo/${nombre}`);
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
    ...CON_SESION,
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
    ...CON_SESION,
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
    ...CON_SESION,
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

// --- Sesión ---------------------------------------------------------------

export async function iniciarSesion(email, password) {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    ...CON_SESION,
  });
  return handleJson(res);
}

export async function cerrarSesion() {
  const res = await fetch(`${API_URL}/api/auth/logout`, {
    method: "POST",
    ...CON_SESION,
  });
  return handleJson(res);
}

/** `null` si no hay sesión activa (en vez de tirar error — es el chequeo
 * normal al cargar la app). */
export async function getSesion() {
  const res = await fetch(`${API_URL}/api/auth/me`, CON_SESION);
  if (res.status === 401) return null;
  return handleJson(res);
}

// --- Alertas de incendio (NASA FIRMS, vía nuestro sistema de alertas) -----

/** Le pide al back que traiga la última tanda de alertas y la guarde. */
export async function recuperarAlertasIncendio() {
  const res = await fetch(`${API_URL}/api/incendios/recuperar`, {
    method: "POST",
    ...CON_SESION,
  });
  return handleJson(res);
}

/** Última tanda guardada (`null` si todavía no se recuperó ninguna). */
export async function getAlertasIncendioActual() {
  const res = await fetch(`${API_URL}/api/incendios/actual`, CON_SESION);
  if (res.status === 404) return null;
  return handleJson(res);
}
