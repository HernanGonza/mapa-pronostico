const crypto = require("crypto");
const store = require("./store");
const { subirArchivo, urlPublica } = require("./storage");
const { tipoValido, severidadValida } = require("./catalogoEventos");
const { loadDepartamentos } = require("./departamentos");

/**
 * Registro histórico de eventos meteorológicos puntuales (tornado,
 * granizo, inundación, etc.) — carga manual del operador, con imágenes
 * (ej. daños de un tornado). Mismo patrón "publicado" que
 * `avisosCortoPlazoStore.js`: `publicado_en` nulo = borrador interno,
 * no nulo = visible en `/embed/historico`.
 */

let initPromise;

async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  const p = store.getPool();
  initPromise = p
    .query(
      `CREATE TABLE IF NOT EXISTS eventos_climaticos (
         id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         tipo          text NOT NULL,
         tipo_otro     text,
         titulo        text NOT NULL,
         descripcion   text NOT NULL,
         severidad     text,
         fecha_inicio  date NOT NULL,
         fecha_fin     date,
         departamento  text,
         municipio     text,
         lat           double precision,
         lng           double precision,
         fuente        text,
         datos_extra   jsonb,
         creado_por    bigint REFERENCES usuarios(id),
         creado_en     timestamptz NOT NULL DEFAULT now(),
         actualizado_en timestamptz NOT NULL DEFAULT now(),
         publicado_en  timestamptz
       )`
    )
    .then(() =>
      p.query(
        `CREATE TABLE IF NOT EXISTS eventos_climaticos_imagenes (
           id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
           evento_id     bigint NOT NULL REFERENCES eventos_climaticos(id) ON DELETE CASCADE,
           storage_path  text NOT NULL,
           pie_de_foto   text,
           orden         int NOT NULL DEFAULT 0,
           subido_en     timestamptz NOT NULL DEFAULT now()
         )`
      )
    )
    .then(() => console.log("[eventosClimaticosStore] Postgres listo (tablas eventos_climaticos*)"))
    .catch((e) => { initPromise = null; throw e; });
  return initPromise;
}

const MAX_IMAGENES = 8;
const MAX_IMAGEN_BYTES = 5 * 1024 * 1024;
const RE_IMAGEN = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const EXT_POR_TIPO = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function errorDeEvento({ tipo, tipoOtro, titulo, descripcion, severidad, fechaInicio, fechaFin, departamento, lat, lng, imagenes }) {
  if (!tipoValido(tipo)) return "Elegí un tipo de evento válido.";
  if (tipo === "otro" && (typeof tipoOtro !== "string" || !tipoOtro.trim())) return "Describí el tipo de evento en «otro».";
  if (typeof titulo !== "string" || !titulo.trim() || titulo.length > 140) return "El título es obligatorio (hasta 140 caracteres).";
  if (typeof descripcion !== "string" || !descripcion.trim() || descripcion.length > 4000) return "La descripción es obligatoria (hasta 4000 caracteres).";
  if (!severidadValida(severidad)) return "Severidad inválida.";
  if (!fechaInicio || Number.isNaN(Date.parse(fechaInicio))) return "Falta la fecha de inicio del evento.";
  if (fechaFin && Number.isNaN(Date.parse(fechaFin))) return "Fecha de fin inválida.";
  if (fechaFin && fechaFin < fechaInicio) return "La fecha de fin no puede ser anterior a la de inicio.";
  if (departamento && !loadDepartamentos().some((d) => d.nombre === departamento)) return "Departamento inválido.";
  if (lat != null && (typeof lat !== "number" || lat < -30 || lat > -25)) return "Latitud fuera de rango.";
  if (lng != null && (typeof lng !== "number" || lng < -57 || lng > -53)) return "Longitud fuera de rango.";
  if (imagenes) {
    if (!Array.isArray(imagenes) || imagenes.length > MAX_IMAGENES) return `Como máximo ${MAX_IMAGENES} imágenes.`;
    for (const img of imagenes) {
      const match = typeof img?.dataUrl === "string" && img.dataUrl.match(RE_IMAGEN);
      if (!match || Buffer.byteLength(match[2], "base64") > MAX_IMAGEN_BYTES) {
        return "Cada imagen debe ser PNG, JPG o WebP de hasta 5 MB.";
      }
    }
  }
  return null;
}

async function subirImagenes(eventoId, imagenes) {
  const subidas = [];
  for (let i = 0; i < (imagenes || []).length; i++) {
    const { dataUrl, pieDeFoto } = imagenes[i];
    const match = dataUrl.match(RE_IMAGEN);
    const ext = EXT_POR_TIPO[`image/${match[1]}`] || "jpg";
    const buffer = Buffer.from(match[2], "base64");
    const ruta = `eventos-climaticos/${eventoId}/${i}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
    await subirArchivo(ruta, buffer, `image/${match[1]}`);
    subidas.push({ storage_path: ruta, pie_de_foto: pieDeFoto || null, orden: i });
  }
  return subidas;
}

async function crear({ tipo, tipoOtro = null, titulo, descripcion, severidad = null, fechaInicio, fechaFin = null, departamento = null, municipio = null, lat = null, lng = null, fuente = null, usuarioId = null, imagenes = [] }) {
  const error = errorDeEvento({ tipo, tipoOtro, titulo, descripcion, severidad, fechaInicio, fechaFin, departamento, lat, lng, imagenes });
  if (error) throw Object.assign(new Error(error), { status: 400 });
  await init();
  const p = store.getPool();
  if (!p) throw Object.assign(new Error("No hay base de datos disponible para guardar el evento."), { status: 503 });

  const { rows } = await p.query(
    `INSERT INTO eventos_climaticos (tipo, tipo_otro, titulo, descripcion, severidad, fecha_inicio, fecha_fin, departamento, municipio, lat, lng, fuente, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [tipo, tipo === "otro" ? tipoOtro : null, titulo, descripcion, severidad, fechaInicio, fechaFin, departamento, municipio, lat, lng, fuente, usuarioId]
  );
  const id = Number(rows[0].id);

  const subidas = await subirImagenes(id, imagenes);
  for (const img of subidas) {
    await p.query(
      `INSERT INTO eventos_climaticos_imagenes (evento_id, storage_path, pie_de_foto, orden) VALUES ($1,$2,$3,$4)`,
      [id, img.storage_path, img.pie_de_foto, img.orden]
    );
  }
  return obtener(id, { incluirNoPublicados: true });
}

function filaAEvento(r) {
  return {
    id: Number(r.id),
    tipo: r.tipo,
    tipoOtro: r.tipo_otro,
    titulo: r.titulo,
    descripcion: r.descripcion,
    severidad: r.severidad,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
    departamento: r.departamento,
    municipio: r.municipio,
    lat: r.lat,
    lng: r.lng,
    fuente: r.fuente,
    creadoEn: r.creado_en.toISOString(),
    publicadoEn: r.publicado_en ? r.publicado_en.toISOString() : null,
    creadoPorEmail: r.creado_por_email || null,
  };
}

async function adjuntarImagenes(p, eventos) {
  if (!eventos.length) return eventos;
  const { rows } = await p.query(
    `SELECT evento_id, storage_path, pie_de_foto, orden FROM eventos_climaticos_imagenes
      WHERE evento_id = ANY($1::bigint[]) ORDER BY evento_id, orden`,
    [eventos.map((e) => e.id)]
  );
  const porEvento = new Map();
  for (const r of rows) {
    const lista = porEvento.get(Number(r.evento_id)) || [];
    lista.push({ url: urlPublica(r.storage_path), pieDeFoto: r.pie_de_foto });
    porEvento.set(Number(r.evento_id), lista);
  }
  return eventos.map((e) => ({ ...e, imagenes: porEvento.get(e.id) || [] }));
}

/** Filtros opcionales: tipo, departamento, desde/hasta (fecha_inicio). Sin
 * `incluirNoPublicados`, solo devuelve lo publicado (uso público/embed). */
async function listar({ tipo, departamento, desde, hasta, incluirNoPublicados = false } = {}) {
  if (!store.usaPostgres()) return [];
  await init();
  const p = store.getPool();
  const condiciones = [];
  const valores = [];
  if (!incluirNoPublicados) condiciones.push("publicado_en IS NOT NULL");
  if (tipo) { valores.push(tipo); condiciones.push(`tipo = $${valores.length}`); }
  if (departamento) { valores.push(departamento); condiciones.push(`departamento = $${valores.length}`); }
  if (desde) { valores.push(desde); condiciones.push(`fecha_inicio >= $${valores.length}`); }
  if (hasta) { valores.push(hasta); condiciones.push(`fecha_inicio <= $${valores.length}`); }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const { rows } = await p.query(
    `SELECT e.*, u.email AS creado_por_email
       FROM eventos_climaticos e LEFT JOIN usuarios u ON u.id = e.creado_por
       ${where}
      ORDER BY e.fecha_inicio DESC, e.id DESC
      LIMIT 500`,
    valores
  );
  return adjuntarImagenes(p, rows.map(filaAEvento));
}

async function obtener(id, { incluirNoPublicados = false } = {}) {
  await init();
  const p = store.getPool();
  if (!p) return null;
  const { rows } = await p.query(
    `SELECT e.*, u.email AS creado_por_email
       FROM eventos_climaticos e LEFT JOIN usuarios u ON u.id = e.creado_por
      WHERE e.id = $1 ${incluirNoPublicados ? "" : "AND e.publicado_en IS NOT NULL"}`,
    [id]
  );
  if (!rows.length) return null;
  const [evento] = await adjuntarImagenes(p, rows.map(filaAEvento));
  return evento;
}

async function actualizar(id, { titulo, descripcion, severidad, fechaInicio, fechaFin, departamento, municipio, lat, lng, fuente }) {
  await init();
  const p = store.getPool();
  if (!p) throw Object.assign(new Error("No hay base de datos disponible."), { status: 503 });
  const actual = await obtener(id, { incluirNoPublicados: true });
  if (!actual) throw Object.assign(new Error("No existe ese evento."), { status: 404 });
  const error = errorDeEvento({
    tipo: actual.tipo, tipoOtro: actual.tipoOtro,
    titulo: titulo ?? actual.titulo, descripcion: descripcion ?? actual.descripcion,
    severidad: severidad !== undefined ? severidad : actual.severidad,
    fechaInicio: fechaInicio || actual.fechaInicio, fechaFin: fechaFin !== undefined ? fechaFin : actual.fechaFin,
    departamento: departamento !== undefined ? departamento : actual.departamento, lat: lat !== undefined ? lat : actual.lat, lng: lng !== undefined ? lng : actual.lng,
  });
  if (error) throw Object.assign(new Error(error), { status: 400 });
  await p.query(
    `UPDATE eventos_climaticos SET
       titulo = $2, descripcion = $3, severidad = $4, fecha_inicio = $5, fecha_fin = $6,
       departamento = $7, municipio = $8, lat = $9, lng = $10, fuente = $11, actualizado_en = now()
     WHERE id = $1`,
    [id, titulo ?? actual.titulo, descripcion ?? actual.descripcion, severidad !== undefined ? severidad : actual.severidad,
     fechaInicio || actual.fechaInicio, fechaFin !== undefined ? fechaFin : actual.fechaFin,
     departamento !== undefined ? departamento : actual.departamento, municipio !== undefined ? municipio : actual.municipio,
     lat !== undefined ? lat : actual.lat, lng !== undefined ? lng : actual.lng, fuente !== undefined ? fuente : actual.fuente]
  );
  return obtener(id, { incluirNoPublicados: true });
}

async function publicar(id) {
  await init();
  const p = store.getPool();
  if (!p) throw Object.assign(new Error("No hay base de datos disponible para publicar."), { status: 503 });
  const { rowCount } = await p.query(`UPDATE eventos_climaticos SET publicado_en = now() WHERE id = $1`, [id]);
  if (!rowCount) throw Object.assign(new Error("No existe ese evento."), { status: 404 });
  return obtener(id, { incluirNoPublicados: true });
}

async function despublicar(id) {
  await init();
  const p = store.getPool();
  if (!p) throw Object.assign(new Error("No hay base de datos disponible."), { status: 503 });
  const { rowCount } = await p.query(`UPDATE eventos_climaticos SET publicado_en = NULL WHERE id = $1`, [id]);
  if (!rowCount) throw Object.assign(new Error("No existe ese evento."), { status: 404 });
  return obtener(id, { incluirNoPublicados: true });
}

module.exports = { init, crear, listar, obtener, actualizar, publicar, despublicar, errorDeEvento, MAX_IMAGENES };
