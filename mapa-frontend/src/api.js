import { API_URL } from "./config";
import { enDemo, leerDemo, acpDePrueba, alertaDePrueba, smnDePrueba } from "./lib/demo";

// El back setea el cookie de sesión como httpOnly — hace falta pedirle al
// fetch que lo mande (y lo reciba) aunque front y back vivan en orígenes
// distintos (Vercel/Render en vez de estar detrás del mismo Caddy).
const CON_SESION = { credentials: "include" };
// Geometrías y catálogo cambian solo con un deploy. Compartir la promesa
// evita descargar los mismos MB cada vez que se cambia de pantalla.
const cacheEstatico = new Map();
async function getEstatico(url) {
  if (!cacheEstatico.has(url)) {
    const solicitud = (async () => handleJson(await fetch(url)))()
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
  return handleJson(res);
}

// --- Envío del pronóstico por correo (Microsoft 365) ---
/** { configurado, remitente }: si el servidor tiene cargados los datos de Microsoft 365. */
export async function getCorreoEstado() {
  return handleJson(await fetch(`${API_URL}/api/correo/estado`, { cache: "no-store", ...CON_SESION }));
}
export async function getCorreoDestinatarios() {
  return (await handleJson(await fetch(`${API_URL}/api/correo/destinatarios`, { cache: "no-store", ...CON_SESION }))).destinatarios;
}
/** Reemplaza la lista completa de destinatarios: [{ nombre, email }]. */
export async function guardarCorreoDestinatarios(destinatarios) {
  return (await handleJson(await fetch(`${API_URL}/api/correo/destinatarios`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinatarios }), ...CON_SESION,
  }))).destinatarios;
}
/** Envía el pronóstico: docx + rtf adjuntos, a los ids elegidos de la lista (en copia oculta). */
export async function enviarPronosticoPorCorreo({ docx, rtf, asunto, cuerpo, ids }) {
  const form = new FormData();
  form.append("docx", docx);
  form.append("rtf", rtf);
  form.append("asunto", asunto);
  form.append("cuerpo", cuerpo);
  form.append("ids", JSON.stringify(ids));
  return handleJson(await fetch(`${API_URL}/api/correo/pronostico`, { method: "POST", body: form, ...CON_SESION }));
}
export async function getCorreoEnvios() {
  return (await handleJson(await fetch(`${API_URL}/api/correo/envios`, { cache: "no-store", ...CON_SESION }))).envios;
}

// --- Transmisión a YouTube (servicio `transmision`, sólo superadmin) ---
export async function getTransmisionEstado() {
  return handleJson(await fetch(`${API_URL}/api/transmision/estado`, { cache: "no-store", ...CON_SESION }));
}
export async function iniciarTransmision() {
  return handleJson(await fetch(`${API_URL}/api/transmision/iniciar`, { method: "POST", ...CON_SESION }));
}
export async function detenerTransmision() {
  return handleJson(await fetch(`${API_URL}/api/transmision/detener`, { method: "POST", ...CON_SESION }));
}
/** URL de la vista previa (lo que se está transmitiendo); `t` evita la caché. */
export const urlCapturaTransmision = (t) => `${API_URL}/api/transmision/captura.jpg?t=${t}`;

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

export async function publicar(filas, fechaPronostico, extendido) {
  const res = await fetch(`${API_URL}/api/pronostico/publicar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filas, fechaPronostico, extendido: extendido || null }),
    ...CON_SESION,
  });
  return handleJson(res);
}

/**
 * Pide al back que genere el PNG (server-side, con canvas) y devuelve un
 * Blob listo para descargar. Usa el último publicado si no se pasan filas.
 */
export async function generarPronosticoPlaca(filas, fechaPronostico, extra = {}) {
  return handleJson(await fetch(`${API_URL}/api/pronostico/placa`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(filas ? { filas, fechaPronostico } : { fechaPronostico }), ...extra }), ...CON_SESION,
  }));
}
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

/** Última tanda recibida por webhook (`null` si todavía no llegó ninguna). */
export async function getAlertasIncendioActual() {
  const res = await fetch(`${API_URL}/api/incendios/actual`, { cache: "no-store" });
  if (res.status === 404) return null;
  return handleJson(res);
}

export function escucharAlertasIncendio(onActualizar) {
  const eventos = new EventSource(`${API_URL}/api/incendios/eventos`);
  eventos.addEventListener("actualizado", onActualizar);
  return () => eventos.close();
}

// --- Riesgo por departamento (índice FWI de ECOSOTAT, calculado solo; la
// categoría PUBLICADA la sigue confirmando una persona) -------------------
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
/** Último cálculo automático del índice FWI (uno por departamento) — para
 * prellenar el editor en vez de arrancar en blanco. `null` si todavía no
 * corrió ninguna vez. */
export async function getRiesgoAutomatico() {
  const res = await fetch(`${API_URL}/api/riesgo-incendios/automatico`, { cache: "no-store", ...CON_SESION });
  if (res.status === 404) return null;
  return handleJson(res);
}
export async function publicarRiesgo(zonas) {
  return handleJson(await fetch(`${API_URL}/api/riesgo-incendios/publicar`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zonas }), ...CON_SESION,
  }));
}

export async function generarRiesgoPlaca(zonas, fecha, extra = {}) {
  return handleJson(await fetch(`${API_URL}/api/riesgo-incendios/placa`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zonas, fecha, ...extra }), ...CON_SESION,
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
/** Publica el mapa manual para `periodo`, visible hasta `vigenteHasta` (ISO); `reemplazar`: ids de vigentes que saca. */
export async function publicarAlertasMeteorologicas(zonas,iconos,{periodo,vigenteHasta,reemplazar=[]}){return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/publicar`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({zonas,iconos,periodo,vigenteHasta,reemplazar}),...CON_SESION}));}
/** Publicaciones manuales vigentes (público, lo usa el iframe). [] = ninguna. */
export async function getAlertasMeteorologicasVigentes(){
  const reales=(await handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/vigentes`,{cache:"no-store"}))).publicaciones;
  // Modo demostración (?demo=1, ver lib/demo.js): se suma la alerta de prueba si está activada.
  if(!enDemo()||!leerDemo().alerta)return reales;
  return [...reales,...alertaDePrueba((await getAlertasMeteorologicasCatalogo()).departamentos)];
}
export async function despublicarAlertaMeteorologica(id){return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/publicaciones/${id}/despublicar`,{method:"POST",...CON_SESION}));}
export async function generarPlaca(payload) {
  return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/placa`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),...CON_SESION}));
}
export async function generarRecomendaciones(payload) {
  return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/recomendaciones`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), ...CON_SESION,
  }));
}
export async function generarAvisoCortoPlazo(payload) {
  return handleJson(await fetch(`${API_URL}/api/avisos-corto-plazo/generar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), ...CON_SESION,
  }));
}
export async function publicarAvisoCortoPlazo(id, vigenteHasta) {
  return handleJson(await fetch(`${API_URL}/api/avisos-corto-plazo/${id}/publicar`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vigenteHasta }), ...CON_SESION,
  }));
}
export async function despublicarAvisoCortoPlazo(id) {
  return handleJson(await fetch(`${API_URL}/api/avisos-corto-plazo/${id}/despublicar`, { method: "POST", ...CON_SESION }));
}
/** Aviso especial (texto libre + captura). `opciones`: { vistaPrevia: true } o { confirmarToken }
 * — al confirmar no se reenvía la imagen: el backend guarda la vista previa ya generada. */
export async function generarAvisoEspecial({ texto, emitidoEn, imagen }, { vistaPrevia = false, confirmarToken = null } = {}) {
  const form = new FormData();
  form.append("texto", texto);
  form.append("emitidoEn", emitidoEn);
  if (confirmarToken) form.append("confirmarToken", confirmarToken);
  else { form.append("imagen", imagen); if (vistaPrevia) form.append("vistaPrevia", "true"); }
  return handleJson(await fetch(`${API_URL}/api/avisos-especiales/generar`, { method: "POST", body: form, ...CON_SESION }));
}
/** Avisos publicados y todavía vigentes (público, lo usa el iframe). [] = ninguno. */
export async function getAvisosCortoPlazoVigentes() {
  const reales = (await handleJson(await fetch(`${API_URL}/api/avisos-corto-plazo/vigentes`, { cache: "no-store" }))).avisos;
  return enDemo() && leerDemo().acp ? [...reales, ...acpDePrueba()] : reales; // modo demostración
}
/** Alertas del SMN publicadas en el embebido y todavía vigentes (público). [] = ninguna. */
export async function getAlertasSmnPublicadas() {
  const reales = (await handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/smn/publicadas`, { cache: "no-store" }))).alertas;
  return enDemo() && leerDemo().smn ? [...reales, ...smnDePrueba()] : reales; // modo demostración
}
export async function getAlertasSmnPublicadasPanel() {
  return (await handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/smn/publicadas/panel`, { cache: "no-store", ...CON_SESION }))).alertas;
}
export async function publicarAlertaSmn(smnId) {
  return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/smn/publicar`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ smnId }), ...CON_SESION,
  }));
}
export async function despublicarAlertaSmn(id) {
  return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/smn/publicadas/${id}/despublicar`, { method: "POST", ...CON_SESION }));
}
export async function getSmnAlertas() { return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/smn`,{cache:'no-store'})); }
export async function actualizarSmnAlertas() { return handleJson(await fetch(`${API_URL}/api/alertas-meteorologicas/smn/actualizar`, { method: 'POST', cache: 'no-store' })); }

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

// --- Registro histórico y estadísticas ------------------------------------

export const getCatalogoEventos = () => getEstatico(`${API_URL}/api/catalogo-eventos`);

export async function getEventosClimaticos(filtros = {}) {
  const q = new URLSearchParams(Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)));
  const res = await fetch(`${API_URL}/api/eventos-climaticos?${q}`, CON_SESION);
  return handleJson(res);
}
export async function getEventosClimaticosPublicos(filtros = {}) {
  const q = new URLSearchParams(Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)));
  const res = await fetch(`${API_URL}/api/eventos-climaticos/publicos?${q}`, { cache: "no-store" });
  return handleJson(res);
}
export async function crearEventoClimatico(datos) {
  return handleJson(await fetch(`${API_URL}/api/eventos-climaticos`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos), ...CON_SESION,
  }));
}
export async function publicarEventoClimatico(id) {
  return handleJson(await fetch(`${API_URL}/api/eventos-climaticos/${id}/publicar`, { method: "POST", ...CON_SESION }));
}
export async function despublicarEventoClimatico(id) {
  return handleJson(await fetch(`${API_URL}/api/eventos-climaticos/${id}/despublicar`, { method: "POST", ...CON_SESION }));
}

export async function getEstacionesClimaticas() {
  return handleJson(await fetch(`${API_URL}/api/registros-climaticos/estaciones`, { cache: "no-store" }));
}
export async function getEstacionesHistoricas() {
  return handleJson(await fetch(`${API_URL}/api/estaciones-historicas`, { cache: 'no-store' }));
}
export async function getSerieEstacionHistorica(id, desde, hasta) {
  const q = new URLSearchParams({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) });
  return handleJson(await fetch(`${API_URL}/api/estaciones-historicas/${encodeURIComponent(id)}/serie?${q}`, { cache: 'no-store' }));
}
export async function getComparacionEstacionesHistoricas(desde, hasta) {
  const q = new URLSearchParams({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) });
  return handleJson(await fetch(`${API_URL}/api/estaciones-historicas/comparacion?${q}`, { cache: 'no-store' }));
}
export async function getSerieClimatica(estacion, desde, hasta) {
  const q = new URLSearchParams({ estacion, ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) });
  return handleJson(await fetch(`${API_URL}/api/registros-climaticos/serie?${q}`, { cache: "no-store" }));
}
export async function getEstadisticasClimaticas() {
  return handleJson(await fetch(`${API_URL}/api/registros-climaticos/estadisticas`, { cache: "no-store" }));
}
export async function cargarRegistroClimaticoManual(datos) {
  return handleJson(await fetch(`${API_URL}/api/registros-climaticos`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos), ...CON_SESION,
  }));
}
export async function detectarColumnasCsv(archivo) {
  const form = new FormData();
  form.append("archivo", archivo);
  return handleJson(await fetch(`${API_URL}/api/registros-climaticos/detectar-columnas`, { method: "POST", body: form, ...CON_SESION }));
}
export async function importarCsvClimatico(archivo, mapeo) {
  const form = new FormData();
  form.append("archivo", archivo);
  form.append("mapeo", JSON.stringify(mapeo));
  return handleJson(await fetch(`${API_URL}/api/registros-climaticos/importar`, { method: "POST", body: form, ...CON_SESION }));
}

export async function getCuencas() { return handleJson(await fetch(`${API_URL}/api/cuencas`, { cache: 'no-store' })); }
export async function actualizarCuencas() { return handleJson(await fetch(`${API_URL}/api/cuencas/actualizar`, { method: 'POST', cache: 'no-store' })); }

// --- Publicar placas en redes (Facebook / Instagram / Telegram) ---
export async function getRedesEstado() {
  return handleJson(await fetch(`${API_URL}/api/redes/estado`, { cache: "no-store", ...CON_SESION }));
}
export async function getRedesPublicaciones(feedUrl, historiasUrl) {
  const q = new URLSearchParams({ feedUrl, historiasUrl });
  return handleJson(await fetch(`${API_URL}/api/redes/publicaciones?${q}`, { cache: "no-store", ...CON_SESION }));
}
// Un 409 trae `yaPublicado` (la placa ya salió): se relanza el error con ese detalle.
export async function publicarEnRedes(payload) {
  const res = await fetch(`${API_URL}/api/redes/publicar`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), ...CON_SESION,
  });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || "Ya publicada."), { yaPublicado: body.yaPublicado || [] });
  }
  return handleJson(res);
}
