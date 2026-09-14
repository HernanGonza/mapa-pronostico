import { API_URL } from "./config";

// El back setea el cookie de sesión como httpOnly — hace falta pedirle al
// fetch que lo mande (y lo reciba) aunque front y back vivan en orígenes
// distintos (Vercel/Render en vez de estar detrás del mismo Caddy).
const CON_SESION = { credentials: "include" };
// Geometrías y catálogo cambian solo con un deploy. Compartir la promesa
// evita descargar los mismos MB cada vez que se cambia de pantalla.
const cacheEstatico = new Map();
async function getEstatico(url) {
  if (!cacheEstatico.has(url)) {
    const solicitud = (async () => handleJson(await fetch(url, { cache: "no-cache" })))()
      .catch((error) => { cacheEstatico.delete(url); throw error; });
    cacheEstatico.set(url, solicitud);
  }
  return cacheEstatico.get(url);
}

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
  return getEstatico(`${API_URL}/api/municipios/geojson`);
}

/** Países del mundo (polígonos + fronteras). */
export async function getMundoGeojson() {
  return getEstatico(`${API_URL}/api/mundo/geojson`);
}

/** GeoJSON de división política / rótulos: `paises-labels`, `provincias`, `provincias-labels`. */
export async function getGeo(nombre) {
  return getEstatico(`${API_URL}/api/geo/${nombre}`);
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

export async function publicar(filas, fechaPronostico) {
  const res = await fetch(`${API_URL}/api/pronostico/publicar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filas, fechaPronostico }),
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

// --- Usuarios (pantalla "Usuarios" del panel — sin alta pública) ----------

export async function listarUsuariosPanel() {
  return handleJson(await fetch(`${API_URL}/api/auth/usuarios`, CON_SESION));
}

export async function crearUsuarioPanel(datos) {
  const res = await fetch(`${API_URL}/api/auth/usuarios`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos),
    ...CON_SESION,
  });
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
export async function publicarAlertasIncendio(datos) {
  const res = await fetch(`${API_URL}/api/incendios/publicar`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ datos }), ...CON_SESION,
  });
  return handleJson(res);
}

/** Última tanda guardada (`null` si todavía no se recuperó ninguna). */
export async function getAlertasIncendioActual() {
  const res = await fetch(`${API_URL}/api/incendios/actual`, CON_SESION);
  if (res.status === 404) return null;
  return handleJson(res);
}

// --- Riesgo por departamento (categoría manual de ECOSOTAT) --------------
export async function getRiesgoCatalogo() {
  return getEstatico(`${API_URL}/api/riesgo-incendios/catalogo`);
}
export async function getDepartamentosGeojson() {
  return getEstatico(`${API_URL}/api/departamentos/geojson`);
}
export async function getRiesgoActual() {
  const res = await fetch(`${API_URL}/api/riesgo-incendios/actual`, { cache: "no-store" });
  if (res.status === 404) return null;
  return handleJson(res);
}
export async function publicarRiesgo(zonas) {
  return handleJson(await fetch(`${API_URL}/api/riesgo-incendios/publicar`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zonas }), ...CON_SESION,
  }));
}

export async function renderRiesgoPng(zonas, fecha) {
  const res = await fetch(`${API_URL}/api/riesgo-incendios/render-png`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zonas, fecha }), ...CON_SESION,
  });
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || "No se pudo generar la imagen."); }
  return res.blob();
}
export const getAlertasMeteorologicasCatalogo = () => getEstatico(`${API_URL}/api/alertas-meteorologicas/catalogo`);
export const getAlertasMeteorologicasGeojson = () => getEstatico(`${API_URL}/api/alertas-meteorologicas/geojson`);
export async function getAlertasMeteorologicasActual(){const r=await fetch(`${API_URL}/api/alertas-meteorologicas/actual`,{cache:"no-store"});return r.status===404?null:handleJson(r);}
export async function publicarAlertasMeteorologicas(zonas,iconos){return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/publicar`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({zonas,iconos}),...CON_SESION}));}
export async function generarPlaca(payload) {
  return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/placa`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),...CON_SESION}));
}
export async function generarRecomendaciones(payload) {
  return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/recomendaciones`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), ...CON_SESION,
  }));
}
export async function getSmnAlertas() { return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/smn`,{cache:'no-store'})); }
export async function actualizarSmnAlertas() { return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/smn/actualizar`, { method: 'POST', cache: 'no-store' })); }
export async function getSmnApiAlertas() { return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/smn-api`, { cache: 'no-store' })); }
export async function scrapeSmnPagina(url) { const q = url ? `?url=${encodeURIComponent(url)}` : ''; return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/smn-scrape${q}`, { cache: 'no-store' })); }

export async function generarCodigoRecuperacion(usuarioId, telefono) {
  return handleJson(await fetch(`${API_URL}/api/auth/usuarios/${encodeURIComponent(usuarioId)}/recuperacion`, {
    method: "POST", headers: { "Content-Type": "application/json" }, ...CON_SESION,
    body: JSON.stringify({ identidadVerificada: true, telefono }),
  }));
}
export async function recuperarPassword({ codigo, password, repetirPassword }) {
  return handleJson(await fetch(`${API_URL}/api/auth/recuperacion`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codigo, password, repetirPassword }),
  }));
}
