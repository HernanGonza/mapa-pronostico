const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { subirArchivo, urlPublica } = require("./storage");

/**
 * Historial de "placas" generadas para redes (las imágenes feed +
 * historias). Una fila por cada click en "Generar placa para redes":
 * quién la generó, cuándo, con qué parámetros exactos (período, fondo,
 * zonas e iconos elegidos — acá sí como snapshot jsonb, es una foto de
 * auditoría de qué se renderizó, no la fuente para estadísticas por
 * departamento — para eso está `alertas_meteo_publicacion_departamentos`)
 * y dónde quedaron guardadas las dos imágenes en el bucket de Storage.
 *
 * `publicado_en` queda nullable — para más adelante, cuando haya forma
 * de marcar en el panel que una placa ya se posteó afuera (Instagram,
 * Facebook, etc. no se puede detectar solo, así que es un dato manual).
 */

let initPromise;

async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  await auth.init();
  const p = store.getPool();
  initPromise = p
    .query(
      `CREATE TABLE IF NOT EXISTS alertas_meteo_placas (
         id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         generado_por   bigint REFERENCES usuarios(id),
         generado_en    timestamptz NOT NULL DEFAULT now(),
         periodo        text NOT NULL,
         fondo          text NOT NULL,
         zonas          jsonb NOT NULL,
         iconos         jsonb NOT NULL DEFAULT '[]',
         feed_path      text NOT NULL,
         historias_path text NOT NULL,
         publicado_en   timestamptz
       )`
    )
    .then(() => console.log("[placasMeteoStore] Postgres listo (tabla alertas_meteo_placas)"))
    .catch((e) => {
      initPromise = null;
      throw e;
    });
  return initPromise;
}

function baseRuta() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `placas/${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

function nombresArchivos(tipo, fondo) {
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return {
    feedNombre: `${tipo}-feed-${fondo}-${fecha}.png`,
    historiasNombre: `${tipo}-historias-${fondo}-${fecha}.png`,
  };
}

/** Sube feed + historias al bucket y graba la fila. Sin DATABASE_URL no
 * hay dónde grabar autoría/histórico — igual sube las imágenes y
 * devuelve sus URLs, para no perder la función en desarrollo local. */
async function crear({ zonas, iconos, periodo, fondo, usuarioId = null, feedPng, historiasPng }) {
  const base = baseRuta();
  const nombres = nombresArchivos('alerta-meteorologica', fondo);
  const feedPath = `${base}/${nombres.feedNombre}`;
  const historiasPath = `${base}/${nombres.historiasNombre}`;
  await Promise.all([subirArchivo(feedPath, feedPng), subirArchivo(historiasPath, historiasPng)]);

  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(
      `INSERT INTO alertas_meteo_placas (generado_por, periodo, fondo, zonas, iconos, feed_path, historias_path)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)
       RETURNING id, generado_en`,
      [usuarioId, periodo, fondo, JSON.stringify(zonas), JSON.stringify(iconos), feedPath, historiasPath]
    );
    return {
      id: Number(rows[0].id),
      ...nombres,
      generadoEn: rows[0].generado_en.toISOString(),
      feedUrl: urlPublica(feedPath),
      historiasUrl: urlPublica(historiasPath),
    };
  }
  return {
    id: null,
    ...nombres,
    generadoEn: new Date().toISOString(),
    feedUrl: urlPublica(feedPath),
    historiasUrl: urlPublica(historiasPath),
  };
}

// Placa opcional de texto: conserva las imágenes sin publicar el mapa.
async function crearRecomendaciones({ feedPng, historiasPng, fondo }) {
  const base = `${baseRuta()}/recomendaciones`;
  const nombres = nombresArchivos('recomendaciones', fondo);
  const feedPath = `${base}/${nombres.feedNombre}`, historiasPath = `${base}/${nombres.historiasNombre}`;
  await Promise.all([subirArchivo(feedPath, feedPng), subirArchivo(historiasPath, historiasPng)]);
  return { ...nombres, feedUrl: urlPublica(feedPath), historiasUrl: urlPublica(historiasPath) };
}

module.exports = { init, crear, crearRecomendaciones };
