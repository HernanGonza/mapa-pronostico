const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");

/**
 * Qué se ve en la pantalla de transmisión (/tv) y en qué orden (panel → Configuración →
 * Pantalla TV). Una sola fila: la lista de pantallas tal como la deja el panel.
 *
 * - Las pantallas del sistema (mapas embebidos y videos institucionales) están definidas en
 *   el front (mapa-frontend/src/lib/tvPantallas.js); acá sólo se guarda si están activas, su
 *   orden y su duración.
 * - Las propias (un video o una imagen subidos, o una página de otro sitio) se guardan
 *   completas. Los archivos subidos van a TV_ARCHIVOS_DIR (un volumen de docker del backend)
 *   y se sirven en /api/tv/archivos/<nombre>: mismo origen que /tv, así los ve también el
 *   Chromium del servicio de transmisión, adentro de docker.
 *
 * - `urgentes`: si los avisos a muy corto plazo y las alertas cortan la rotación para verse a
 *   pantalla completa ({ acp, alertas }, los dos prendidos por defecto). Apagados, /tv sigue con
 *   la rotación (el video que esté pasando no se corta). Se cambian al toque desde el panel.
 *
 * Sin DATABASE_URL (desarrollo) se guarda en data/store/tv-rotacion.json.
 */

const DIR_ARCHIVOS = process.env.TV_ARCHIVOS_DIR || path.join(__dirname, "..", "..", "data", "tv");
const ARCHIVO_LOCAL = path.join(__dirname, "..", "..", "data", "store", "tv-rotacion.json");
const TIPOS_PROPIOS = ["video", "imagen", "pagina"];
const MAX_PANTALLAS = 60;
const NOMBRE_ARCHIVO = /^[a-z0-9-]+\.(mp4|webm|png|jpg|webp)$/;
const PREFIJO_ARCHIVO = "/api/tv/archivos/";

let initPromise;

async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  await auth.init();
  initPromise = store.getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS tv_rotacion (
         id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
         pantallas       jsonb NOT NULL,
         actualizado_en  timestamptz NOT NULL DEFAULT now(),
         actualizado_por bigint REFERENCES usuarios(id)
       );
       ALTER TABLE tv_rotacion ADD COLUMN IF NOT EXISTS urgentes jsonb`
    )
    .then(() => console.log("[tvStore] Postgres listo (tabla tv_rotacion)"))
    .catch((e) => {
      initPromise = null;
      throw e;
    });
  return initPromise;
}

const error400 = (mensaje) => Object.assign(new Error(mensaje), { status: 400 });
const texto = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Valida y limpia la lista que manda el panel. Tira un error 400 con el motivo. */
function normalizar(pantallas) {
  if (!Array.isArray(pantallas)) throw error400("Falta la lista de pantallas.");
  if (pantallas.length > MAX_PANTALLAS) throw error400(`Hay demasiadas pantallas (máximo ${MAX_PANTALLAS}).`);
  const ids = new Set();
  return pantallas.map((p, i) => {
    const id = texto(p?.id, 60);
    if (!/^[a-z0-9-]+$/.test(id) || ids.has(id)) throw error400(`La pantalla ${i + 1} no tiene un identificador válido.`);
    ids.add(id);
    const limpia = { id, activo: p.activo !== false };
    const titulo = texto(p.titulo, 80);
    if (titulo) limpia.titulo = titulo;
    if (p.duracion != null) {
      const d = Math.round(Number(p.duracion));
      if (!Number.isFinite(d) || d < 5 || d > 600) throw error400(`«${titulo || id}»: la duración tiene que estar entre 5 y 600 segundos.`);
      limpia.duracion = d;
    }
    if (!p.propia) return limpia; // del sistema: sólo activo, orden, duración y título
    if (!TIPOS_PROPIOS.includes(p.tipo)) throw error400(`«${titulo || id}»: tipo de pantalla desconocido.`);
    const src = texto(p.src, 2000);
    if (p.tipo === "pagina") {
      let url;
      try { url = new URL(src); } catch { throw error400(`«${titulo || id}»: la dirección de la página no es válida.`); }
      if (!/^https?:$/.test(url.protocol)) throw error400(`«${titulo || id}»: la página tiene que empezar con https://`);
    } else if (!src.startsWith(PREFIJO_ARCHIVO) || !NOMBRE_ARCHIVO.test(src.slice(PREFIJO_ARCHIVO.length))) {
      throw error400(`«${titulo || id}»: falta el archivo.`);
    }
    if (!titulo) throw error400(`La pantalla ${i + 1} necesita un título (es lo que se ve arriba en /tv).`);
    return { ...limpia, propia: true, tipo: p.tipo, src };
  });
}

const URGENTES_PREDETERMINADOS = { acp: true, alertas: true };
const conUrgentes = (u) => ({ ...URGENTES_PREDETERMINADOS, ...(u && typeof u === "object" ? u : {}) });
function leerLocal() {
  try { return JSON.parse(fs.readFileSync(ARCHIVO_LOCAL, "utf8")); } catch { return { pantallas: null, actualizadoEn: null }; }
}
function escribirLocal(datos) {
  fs.mkdirSync(path.dirname(ARCHIVO_LOCAL), { recursive: true });
  fs.writeFileSync(ARCHIVO_LOCAL, JSON.stringify(datos));
}

async function obtener() {
  if (!store.usaPostgres()) { const l = leerLocal(); return { ...l, urgentes: conUrgentes(l.urgentes) }; }
  await init();
  const { rows } = await store.getPool().query("SELECT pantallas, actualizado_en, urgentes FROM tv_rotacion WHERE id = 1");
  // pantallas null = nunca se guardó la lista: /tv usa la rotación de siempre.
  return rows[0] ? { pantallas: rows[0].pantallas, actualizadoEn: rows[0].actualizado_en.toISOString(), urgentes: conUrgentes(rows[0].urgentes) }
    : { pantallas: null, actualizadoEn: null, urgentes: conUrgentes(null) };
}

/** Prende o apaga que los ACP / las alertas corten la rotación. `cambio`: { acp?, alertas? } (booleanos). */
async function guardarUrgentes(cambio, usuarioId = null) {
  if (!cambio || typeof cambio !== "object" || !Object.keys(cambio).length || Object.entries(cambio).some(([k, v]) => !(k in URGENTES_PREDETERMINADOS) || typeof v !== "boolean")) {
    throw error400("Indicá qué cortes de la rotación prender o apagar (acp, alertas).");
  }
  if (!store.usaPostgres()) {
    const l = leerLocal();
    const urgentes = conUrgentes({ ...l.urgentes, ...cambio });
    escribirLocal({ ...l, urgentes });
    return urgentes;
  }
  await init();
  // Si la lista nunca se guardó, la fila se crea con pantallas = null de JSON (la rotación de siempre).
  const { rows } = await store.getPool().query(
    `INSERT INTO tv_rotacion (id, pantallas, urgentes, actualizado_por) VALUES (1, 'null'::jsonb, $1::jsonb, $2)
     ON CONFLICT (id) DO UPDATE SET urgentes = COALESCE(tv_rotacion.urgentes, '{}'::jsonb) || $1::jsonb, actualizado_por = EXCLUDED.actualizado_por
     RETURNING urgentes`,
    [JSON.stringify(cambio), usuarioId]
  );
  return conUrgentes(rows[0].urgentes);
}

async function guardar(pantallas, usuarioId = null) {
  const limpias = normalizar(pantallas);
  let resultado;
  if (!store.usaPostgres()) {
    resultado = { pantallas: limpias, actualizadoEn: new Date().toISOString() };
    escribirLocal({ ...leerLocal(), ...resultado });
  } else {
    await init();
    const { rows } = await store.getPool().query(
      `INSERT INTO tv_rotacion (id, pantallas, actualizado_en, actualizado_por) VALUES (1, $1, now(), $2)
       ON CONFLICT (id) DO UPDATE SET pantallas = EXCLUDED.pantallas, actualizado_en = now(), actualizado_por = EXCLUDED.actualizado_por
       RETURNING actualizado_en`,
      [JSON.stringify(limpias), usuarioId]
    );
    resultado = { pantallas: limpias, actualizadoEn: rows[0].actualizado_en.toISOString() };
  }
  borrarArchivosSinUso(limpias);
  return resultado;
}

/**
 * Borra los archivos subidos que ya no usa ninguna pantalla (se quitaron en el panel). Sólo
 * los de más de una hora: uno recién subido todavía no está guardado en la lista.
 */
function borrarArchivosSinUso(pantallas) {
  const enUso = new Set(pantallas.filter((p) => p.propia && p.src.startsWith(PREFIJO_ARCHIVO)).map((p) => p.src.slice(PREFIJO_ARCHIVO.length)));
  let nombres = [];
  try { nombres = fs.readdirSync(DIR_ARCHIVOS); } catch { return; }
  for (const nombre of nombres) {
    if (enUso.has(nombre) || !NOMBRE_ARCHIVO.test(nombre)) continue;
    const ruta = path.join(DIR_ARCHIVOS, nombre);
    try { if (Date.now() - fs.statSync(ruta).mtimeMs > 3600_000) fs.unlinkSync(ruta); } catch { /* ya no está */ }
  }
}

/** Nombre nuevo para un archivo subido (sin datos del original: no hace falta y evita problemas). */
function nombreNuevo(extension) {
  return `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(6).toString("hex")}.${extension}`;
}

module.exports = { init, obtener, guardar, guardarUrgentes, nombreNuevo, DIR_ARCHIVOS, NOMBRE_ARCHIVO, PREFIJO_ARCHIVO };
