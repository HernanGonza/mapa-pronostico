const fs = require("fs");
const path = require("path");
const store = require("./store");
const auth = require("./auth");
const departamentosStore = require("./departamentosStore");
const { errorDeVigencia } = require("./avisosCortoPlazoStore");
const { zonasEn, iconosEn, errorDeTramos, normalizarTramos } = require("./tramosAlerta");

/**
 * Publicación del mapa manual de alertas meteorológicas (el que alimenta
 * `/embed/alertas-meteorologicas`). Normalizado en tres tablas en vez de
 * los dos jsonb de antes, para poder hacer estadísticas/histórico
 * directo en SQL ("¿cuántas veces estuvo Rojo tal departamento este
 * año?") sin tener que desarmar jsonb:
 *   - alertas_meteo_publicaciones          (quién y cuándo)
 *   - alertas_meteo_publicacion_departamentos (color por departamento)
 *   - alertas_meteo_publicacion_fenomenos     (color por fenómeno elegido)
 *
 * Sin `DATABASE_URL`: cae a un archivo JSON en disco (como antes), sin
 * historial ni autoría — solo para desarrollo local sin base.
 */

const FILE = path.join(__dirname, "..", "..", "data", "store", "alertas-meteorologicas.json");
let initPromise;

async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  await Promise.all([auth.init(), departamentosStore.init()]);
  const p = store.getPool();
  initPromise = p
    .query(
      `CREATE TABLE IF NOT EXISTS alertas_meteo_publicaciones (
         id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         publicado_en timestamptz NOT NULL DEFAULT now(),
         usuario_id   bigint REFERENCES usuarios(id)
       );
       CREATE TABLE IF NOT EXISTS alertas_meteo_publicacion_departamentos (
         publicacion_id  bigint NOT NULL REFERENCES alertas_meteo_publicaciones(id) ON DELETE CASCADE,
         departamento_id text NOT NULL REFERENCES departamentos(id),
         categoria       text NOT NULL,
         PRIMARY KEY (publicacion_id, departamento_id)
       );
       CREATE TABLE IF NOT EXISTS alertas_meteo_publicacion_fenomenos (
         publicacion_id bigint NOT NULL REFERENCES alertas_meteo_publicaciones(id) ON DELETE CASCADE,
         fenomeno_id    text NOT NULL,
         categoria      text NOT NULL,
         PRIMARY KEY (publicacion_id, fenomeno_id)
       );
       ALTER TABLE alertas_meteo_publicacion_fenomenos ADD COLUMN IF NOT EXISTS categoria2 text;
       -- Como los avisos a muy corto plazo: cada publicación se ve en el embebido hasta
       -- vigente_hasta y después se saca sola; puede haber varias a la vez (hoy y mañana).
       -- periodo = para cuándo es (lo que se lee en la tarjeta del embebido).
       -- Las publicadas antes de esto (vigente_hasta NULL) ya no se muestran.
       ALTER TABLE alertas_meteo_publicaciones ADD COLUMN IF NOT EXISTS vigente_hasta timestamptz;
       ALTER TABLE alertas_meteo_publicaciones ADD COLUMN IF NOT EXISTS periodo text;
       -- Leyenda por nivel que se lee al tocar un departamento en el mapa público: { "Naranja": "…", "Amarillo": "…" }.
       ALTER TABLE alertas_meteo_publicaciones ADD COLUMN IF NOT EXISTS leyendas jsonb;
       -- Vigencias individuales: { "<departamento>": [{ categoria, hasta }] } (ver tramosAlerta.js).
       ALTER TABLE alertas_meteo_publicaciones ADD COLUMN IF NOT EXISTS tramos jsonb;
       -- En fila: no aparece hasta que deja de estar vigente la publicación en_fila_de
       -- (porque venció o porque se despublicó). NULL = aparece al publicarse.
       ALTER TABLE alertas_meteo_publicaciones ADD COLUMN IF NOT EXISTS en_fila_de bigint REFERENCES alertas_meteo_publicaciones(id);
       -- Fijada a mano desde el panel: mientras esté vigente, el embebido muestra sólo ésta
       -- (aunque esté en fila). Sin ninguna fijada, se muestran las vigentes por fecha.
       ALTER TABLE alertas_meteo_publicaciones ADD COLUMN IF NOT EXISTS fijada boolean NOT NULL DEFAULT false;
       -- Última vez que se le cambió la vigencia desde el panel (NULL = nunca).
       ALTER TABLE alertas_meteo_publicaciones ADD COLUMN IF NOT EXISTS actualizada_en timestamptz;
       -- Cuándo empezó a verse una que estaba en fila, si fue porque se despublicó la que esperaba
       -- (ahí se pierde el enlace con ésa). NULL = se calcula: al publicarse, o al vencer la que esperaba.
       -- La usa /tv para dejarla fija los primeros minutos.
       ALTER TABLE alertas_meteo_publicaciones ADD COLUMN IF NOT EXISTS visible_desde timestamptz;
       -- Historial de lo que se le hizo a cada alerta después de publicarla (para estadísticas e
       -- histórico): cambios de vigencia (antes/después, y las de la fila que se corrieron), fijar /
       -- desfijar, despublicar y las placas generadas, editadas o eliminadas. Una fila por evento.
       CREATE TABLE IF NOT EXISTS alertas_meteo_eventos (
         id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         publicacion_id bigint NOT NULL REFERENCES alertas_meteo_publicaciones(id),
         evento         text NOT NULL,
         detalle        jsonb NOT NULL DEFAULT '{}'::jsonb,
         usuario_id     bigint REFERENCES usuarios(id),
         en             timestamptz NOT NULL DEFAULT now()
       );
       CREATE INDEX IF NOT EXISTS alertas_meteo_eventos_pub_idx ON alertas_meteo_eventos (publicacion_id, en)`
    )
    .then(() => console.log("[alertasMeteorologicasStore] Postgres listo (publicaciones normalizadas)"))
    .catch((e) => {
      initPromise = null;
      throw e;
    });
  return initPromise;
}

const MAX_PERIODO_PUBLICACION = 120;
// Las que van en fila pueden ser para dentro de unos días (ej.: la del domingo).
const MAX_DIAS_EN_FILA = 7;
function errorDePublicacion({ vigenteHasta, periodo, reemplazar = [], enFilaDe = null }) {
  if (typeof periodo !== "string" || !periodo.trim() || periodo.length > MAX_PERIODO_PUBLICACION) return `Escribí para cuándo es la alerta (hasta ${MAX_PERIODO_PUBLICACION} caracteres).`;
  if (!Array.isArray(reemplazar) || reemplazar.some((id) => !Number.isInteger(id) || id <= 0)) return "Publicaciones a reemplazar inválidas.";
  if (enFilaDe == null) return errorDeVigencia(vigenteHasta);
  if (!Number.isInteger(enFilaDe) || enFilaDe <= 0) return "Alerta de la fila inválida.";
  if (reemplazar.length) return "Una alerta en fila no reemplaza a otras.";
  const t = Date.parse(vigenteHasta);
  if (typeof vigenteHasta !== "string" || Number.isNaN(t)) return "Elegí hasta cuándo está vigente la alerta.";
  if (t <= Date.now()) return "La vigencia tiene que ser una fecha y hora futura.";
  if (t > Date.now() + MAX_DIAS_EN_FILA * 24 * 3600 * 1000) return `La vigencia no puede superar los ${MAX_DIAS_EN_FILA} días.`;
  return null;
}

/**
 * Publica el mapa hasta `vigenteHasta` (se saca solo después). `reemplazar`: ids de
 * publicaciones vigentes que ésta reemplaza (se despublican en la misma transacción),
 * para no duplicar la alerta de hoy cuando se corrige; las que estaban en fila detrás
 * de una reemplazada pasan a esperar a ésta. `enFilaDe`: id de una publicación todavía
 * vigente (o en fila); ésta aparece recién cuando aquélla deja de estar vigente.
 */
async function publicar(zonas, iconos, usuarioId = null, { vigenteHasta, periodo, reemplazar = [], enFilaDe = null, tramos = {} } = {}) {
  await init();
  const p = store.getPool();
  if (p) {
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      if (enFilaDe != null) {
        const { rowCount } = await client.query(`SELECT 1 FROM alertas_meteo_publicaciones WHERE id = $1 AND vigente_hasta > now()`, [enFilaDe]);
        if (!rowCount) throw Object.assign(new Error("La alerta detrás de la que iba en fila ya no está vigente. Volvé a publicar."), { status: 409 });
      }
      const { rows: reemplazadas } = reemplazar.length
        ? await client.query(`UPDATE alertas_meteo_publicaciones SET vigente_hasta = now() WHERE id = ANY($1::bigint[]) AND vigente_hasta > now() RETURNING id`, [reemplazar])
        : { rows: [] };
      const { rows } = await client.query(
        `INSERT INTO alertas_meteo_publicaciones (usuario_id, vigente_hasta, periodo, en_fila_de, tramos) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id, publicado_en, vigente_hasta`,
        [usuarioId, vigenteHasta, periodo.trim(), enFilaDe, JSON.stringify(tramos)]
      );
      const { id, publicado_en } = rows[0];
      if (reemplazar.length) await client.query(`UPDATE alertas_meteo_publicaciones SET en_fila_de = $1 WHERE en_fila_de = ANY($2::bigint[])`, [id, reemplazar]);
      for (const z of zonas) {
        await client.query(
          `INSERT INTO alertas_meteo_publicacion_departamentos (publicacion_id, departamento_id, categoria) VALUES ($1,$2,$3)`,
          [id, z.id, z.categoria]
        );
      }
      for (const i of iconos) {
        await client.query(
          `INSERT INTO alertas_meteo_publicacion_fenomenos (publicacion_id, fenomeno_id, categoria, categoria2) VALUES ($1,$2,$3,$4)`,
          [id, i.id, i.categoria, i.categoria2 || null]
        );
      }
      await registrarEvento(client, { publicacionId: id, evento: "publicada", usuarioId, detalle: { vigenteHasta: rows[0].vigente_hasta.toISOString(), periodo: periodo.trim(), enFilaDe, reemplaza: reemplazadas.map((r) => Number(r.id)) } });
      for (const r of reemplazadas) await registrarEvento(client, { publicacionId: r.id, evento: "reemplazada", usuarioId, detalle: { por: Number(id) } });
      await client.query("COMMIT");
      return { id: Number(id), publicadoEn: publicado_en.toISOString(), vigenteHasta: rows[0].vigente_hasta.toISOString(), periodo: periodo.trim(), enFilaDe, tramos, zonas, iconos };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  const x = { id: 1, publicadoEn: new Date().toISOString(), vigenteHasta: new Date(vigenteHasta).toISOString(), periodo: periodo.trim(), tramos, zonas, iconos };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(x));
  return x;
}

/** Lo que va al archivo (sin base de datos): las zonas publicadas, no las resueltas a esta hora. */
const paraArchivo = ({ zonasBase, iconosBase, ...x }) => ({ ...x, zonas: zonasBase || x.zonas, iconos: iconosBase || x.iconos });

async function actual() {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows: pubs } = await p.query(
      `SELECT id, publicado_en, vigente_hasta, periodo, leyendas, tramos FROM alertas_meteo_publicaciones ORDER BY id DESC LIMIT 1`
    );
    if (!pubs.length) return null;
    return conDetalle(p, pubs[0]);
  }
  if (!fs.existsSync(FILE)) return null;
  const x = JSON.parse(fs.readFileSync(FILE));
  return { ...x, tramos: x.tramos || {}, zonasBase: x.zonas, zonas: zonasEn(x.zonas, x.tramos), iconosBase: x.iconos || [], iconos: iconosEn(x.iconos || [], zonasEn(x.zonas, x.tramos)) };
}

/** Zonas e íconos de una publicación. */
async function conDetalle(p, { id, publicado_en, vigente_hasta, periodo, leyendas, tramos, en_fila_de, fijada, actualizada_en }) {
    const [{ rows: zonas }, { rows: iconos }] = await Promise.all([
      p.query(
        `SELECT departamento_id AS id, categoria FROM alertas_meteo_publicacion_departamentos WHERE publicacion_id = $1`,
        [id]
      ),
      p.query(
        `SELECT fenomeno_id AS id, categoria, categoria2 FROM alertas_meteo_publicacion_fenomenos WHERE publicacion_id = $1`,
        [id]
      ),
    ]);
    // categoria2 sólo viaja si hay segundo color (así lo publicado antes de esta función queda igual).
    const iconosBase = iconos.map(({ categoria2, ...i }) => (categoria2 ? { ...i, categoria2 } : i));
    return { id: Number(id), publicadoEn: publicado_en.toISOString(), vigenteHasta: vigente_hasta ? vigente_hasta.toISOString() : null, periodo: periodo || null, leyendas: leyendas || {}, tramos: tramos || {},
      enFilaDe: en_fila_de ? Number(en_fila_de) : null, fijada: !!fijada, actualizadaEn: actualizada_en ? actualizada_en.toISOString() : null, zonas: zonasEn(zonas, tramos), zonasBase: zonas,
      iconos: iconosEn(iconosBase, zonasEn(zonas, tramos)), iconosBase };
}

/**
 * Las que todavía no vencieron, separadas en las que se ven ahora en el embebido
 * (más vieja primero) y las que esperan en fila (la que esperan sigue vigente).
 */
async function pendientes() {
  await init();
  const p = store.getPool();
  if (p) {
    const { rows } = await p.query(
      `SELECT id, publicado_en, vigente_hasta, periodo, leyendas, tramos, en_fila_de, fijada, actualizada_en, visible_desde FROM alertas_meteo_publicaciones WHERE vigente_hasta > now() ORDER BY publicado_en`
    );
    const ids = new Set(rows.map((r) => String(r.id)));
    const esperando = (r) => r.en_fila_de != null && ids.has(String(r.en_fila_de));
    const [vigentes, enFila] = await Promise.all([rows.filter((r) => !esperando(r)), rows.filter(esperando)].map((rs) => Promise.all(rs.map((r) => conDetalle(p, r)))));
    // Desde cuándo se ve cada una (para /tv, que la deja fija un rato al aparecer): al publicarse; si
    // estaba en fila, cuando terminó la que esperaba (venció, se le acortó la vigencia o se despublicó).
    const guardado = new Map(rows.filter((r) => r.visible_desde).map((r) => [Number(r.id), r.visible_desde]));
    const previas = vigentes.filter((v) => v.enFilaDe != null).map((v) => v.enFilaDe);
    const finDe = new Map(previas.length ? (await p.query(`SELECT id, vigente_hasta FROM alertas_meteo_publicaciones WHERE id = ANY($1::bigint[])`, [previas])).rows.map((r) => [Number(r.id), r.vigente_hasta]) : []);
    for (const v of vigentes) {
      const fin = guardado.get(v.id) || (v.enFilaDe != null ? finDe.get(v.enFilaDe) : null);
      v.visibleDesde = fin && fin.getTime() > Date.parse(v.publicadoEn) ? fin.toISOString() : v.publicadoEn;
    }
    return { vigentes, enFila };
  }
  const x = await actual();
  return { vigentes: x && Date.parse(x.vigenteHasta) > Date.now() ? [x] : [], enFila: [] };
}

/**
 * Las publicaciones que se ven ahora en el embebido (más vieja primero): la fijada a mano
 * si hay una (aunque esté en fila); si no, todas las vigentes por fecha (si se superponen,
 * el embebido las muestra con páginas).
 */
async function vigentes() {
  const { vigentes: v, enFila } = await pendientes();
  const fijada = [...v, ...enFila].find((x) => x.fijada);
  return fijada ? [fijada] : v;
}

/**
 * Anota un evento en el historial de la alerta (ver alertas_meteo_eventos). `db`: el pool o el
 * cliente de una transacción abierta (así el evento queda en la misma transacción).
 */
async function registrarEvento(db, { publicacionId, evento, detalle = {}, usuarioId = null }) {
  await db.query(`INSERT INTO alertas_meteo_eventos (publicacion_id, evento, detalle, usuario_id) VALUES ($1,$2,$3::jsonb,$4)`,
    [publicacionId, evento, JSON.stringify(detalle), usuarioId]);
}

/** Historial de una alerta, del más viejo al más nuevo (para el histórico). */
async function eventos(publicacionId) {
  await init();
  const p = store.getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `SELECT e.evento, e.detalle, e.en, u.email AS usuario_email FROM alertas_meteo_eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.publicacion_id = $1 ORDER BY e.en, e.id`, [publicacionId]);
  return rows.map((r) => ({ evento: r.evento, detalle: r.detalle, en: r.en.toISOString(), usuarioEmail: r.usuario_email }));
}

/** Fija una publicación (vigente o en fila) en el embebido; `id` null = volver a lo automático. */
async function fijar(id, usuarioId = null) {
  await init();
  const p = store.getPool();
  if (!p) throw Object.assign(new Error("No hay base de datos disponible."), { status: 503 });
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    if (id != null) {
      const { rowCount } = await client.query(`SELECT 1 FROM alertas_meteo_publicaciones WHERE id = $1 AND vigente_hasta > now() FOR UPDATE`, [id]);
      if (!rowCount) throw Object.assign(new Error("La alerta no está publicada."), { status: 404 });
    }
    const { rows: antes } = await client.query(`UPDATE alertas_meteo_publicaciones SET fijada = false WHERE fijada RETURNING id`);
    if (id != null) await client.query(`UPDATE alertas_meteo_publicaciones SET fijada = true WHERE id = $1`, [id]);
    for (const r of antes) if (Number(r.id) !== id) await registrarEvento(client, { publicacionId: r.id, evento: "desfijada", usuarioId });
    if (id != null && !antes.some((r) => Number(r.id) === id)) await registrarEvento(client, { publicacionId: id, evento: "fijada", usuarioId });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * La saca del embebido antes de que venza (o de la fila, si todavía no apareció).
 * Las que esperaban a ésta pasan a esperar a la que esperaba ella: si ésta ya se
 * veía, aparecen ahora.
 */
async function despublicar(id, usuarioId = null) {
  await init();
  const p = store.getPool();
  if (!p) { if (fs.existsSync(FILE)) fs.rmSync(FILE); return; }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const { rows: previa } = await client.query(`SELECT vigente_hasta FROM alertas_meteo_publicaciones WHERE id = $1 AND vigente_hasta > now() FOR UPDATE`, [id]);
    // ¿Se veía? (no estaba en fila, o la que esperaba ya terminó). Se mira antes de despublicarla.
    const { rows: seVeia } = await client.query(
      `SELECT a.en_fila_de IS NULL OR NOT EXISTS (SELECT 1 FROM alertas_meteo_publicaciones b WHERE b.id = a.en_fila_de AND b.vigente_hasta > now()) AS visible
         FROM alertas_meteo_publicaciones a WHERE a.id = $1`, [id]);
    const { rows } = await client.query(`UPDATE alertas_meteo_publicaciones SET vigente_hasta = now() WHERE id = $1 AND vigente_hasta > now() RETURNING en_fila_de`, [id]);
    if (!rows.length) throw Object.assign(new Error("La alerta no está publicada."), { status: 404 });
    // Si se veía, las que la esperaban aparecen ahora: queda anotado cuándo (para /tv).
    await client.query(`UPDATE alertas_meteo_publicaciones SET en_fila_de = $2, visible_desde = CASE WHEN $3 THEN now() ELSE visible_desde END WHERE en_fila_de = $1`,
      [id, rows[0].en_fila_de, !!seVeia[0]?.visible]);
    await registrarEvento(client, { publicacionId: id, evento: "despublicada", usuarioId, detalle: { ibaHasta: previa[0]?.vigente_hasta?.toISOString() ?? null } });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Error de una vigencia nueva para una alerta ya publicada (o en fila), o null. */
function errorDeCambioVigencia(vigenteHasta) {
  const t = Date.parse(vigenteHasta);
  if (typeof vigenteHasta !== "string" || Number.isNaN(t)) return "Elegí hasta cuándo está vigente la alerta.";
  if (t <= Date.now()) return "La vigencia tiene que ser una fecha y hora futura.";
  if (t > Date.now() + MAX_DIAS_EN_FILA * 24 * 3600 * 1000) return `La vigencia no puede superar los ${MAX_DIAS_EN_FILA} días.`;
  return null;
}

/**
 * Cambia hasta cuándo se ve una alerta publicada (o en fila), sin tocar su mapa. Las que
 * esperan en fila detrás de ella (y las de detrás de ésas) se corren lo mismo: aparecen
 * cuando ésta termina, así que conservan cuánto duran.
 */
async function cambiarVigencia(id, vigenteHasta, usuarioId = null) {
  const error = errorDeCambioVigencia(vigenteHasta);
  if (error) throw Object.assign(new Error(error), { status: 400 });
  await init();
  const p = store.getPool();
  if (!p) {
    const x = await actual();
    if (!x || x.id !== id || Date.parse(x.vigenteHasta) <= Date.now()) throw Object.assign(new Error("La alerta no está publicada."), { status: 404 });
    fs.writeFileSync(FILE, JSON.stringify({ ...paraArchivo(x), vigenteHasta: new Date(vigenteHasta).toISOString() }));
    return;
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT vigente_hasta FROM alertas_meteo_publicaciones WHERE id = $1 AND vigente_hasta > now() FOR UPDATE`, [id]);
    if (!rows.length) throw Object.assign(new Error("La alerta no está publicada."), { status: 404 });
    const { rows: corridas } = await client.query(
      `WITH RECURSIVE detras AS (
         SELECT id FROM alertas_meteo_publicaciones WHERE en_fila_de = $1 AND vigente_hasta > now()
         UNION SELECT a.id FROM alertas_meteo_publicaciones a JOIN detras d ON a.en_fila_de = d.id WHERE a.vigente_hasta > now()
       )
       UPDATE alertas_meteo_publicaciones SET vigente_hasta = vigente_hasta + ($2::timestamptz - $3::timestamptz) WHERE id IN (SELECT id FROM detras)
       RETURNING id, vigente_hasta`,
      [id, new Date(vigenteHasta), rows[0].vigente_hasta]
    );
    await client.query(`UPDATE alertas_meteo_publicaciones SET vigente_hasta = $2, actualizada_en = now() WHERE id = $1`, [id, new Date(vigenteHasta)]);
    await registrarEvento(client, { publicacionId: id, evento: "vigencia_cambiada", usuarioId,
      detalle: { antes: rows[0].vigente_hasta.toISOString(), despues: new Date(vigenteHasta).toISOString(), corridas: corridas.map((r) => ({ id: Number(r.id), hasta: r.vigente_hasta.toISOString() })) } });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Cambia la leyenda («periodo») que se lee en el mapa público de una publicada (o en fila); no toca el mapa ni la vigencia. */
async function cambiarLeyenda(id, periodo, usuarioId = null) {
  if (typeof periodo !== "string" || !periodo.trim() || periodo.length > MAX_PERIODO_PUBLICACION) throw Object.assign(new Error(`Escribí la leyenda (hasta ${MAX_PERIODO_PUBLICACION} caracteres).`), { status: 400 });
  await init();
  const p = store.getPool();
  if (!p) {
    const x = await actual();
    if (!x || x.id !== id || Date.parse(x.vigenteHasta) <= Date.now()) throw Object.assign(new Error("La alerta no está publicada."), { status: 404 });
    fs.writeFileSync(FILE, JSON.stringify({ ...paraArchivo(x), periodo: periodo.trim() }));
    return;
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT periodo FROM alertas_meteo_publicaciones WHERE id = $1 AND vigente_hasta > now() FOR UPDATE`, [id]);
    if (!rows.length) throw Object.assign(new Error("La alerta no está publicada."), { status: 404 });
    await client.query(`UPDATE alertas_meteo_publicaciones SET periodo = $2, actualizada_en = now() WHERE id = $1`, [id, periodo.trim()]);
    await registrarEvento(client, { publicacionId: id, evento: "leyenda_cambiada", usuarioId, detalle: { antes: rows[0].periodo, despues: periodo.trim() } });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

const NIVELES_LEYENDA = ["Amarillo", "Naranja", "Rojo"];
/** Cambia lo que se lee al tocar un departamento en el mapa público, según su nivel: { Naranja: "…", Amarillo: "…" }. Vacío = vuelve a lo de antes. */
async function cambiarLeyendas(id, leyendas, usuarioId = null) {
  if (!leyendas || typeof leyendas !== "object" || Array.isArray(leyendas)) throw Object.assign(new Error("Leyendas inválidas."), { status: 400 });
  const limpias = {};
  for (const [nivel, texto] of Object.entries(leyendas)) {
    if (!NIVELES_LEYENDA.includes(nivel) || typeof texto !== "string" || texto.length > MAX_PERIODO_PUBLICACION) throw Object.assign(new Error(`Cada leyenda admite hasta ${MAX_PERIODO_PUBLICACION} caracteres.`), { status: 400 });
    if (texto.trim()) limpias[nivel] = texto.trim();
  }
  await init();
  const p = store.getPool();
  if (!p) {
    const x = await actual();
    if (!x || x.id !== id || Date.parse(x.vigenteHasta) <= Date.now()) throw Object.assign(new Error("La alerta no está publicada."), { status: 404 });
    fs.writeFileSync(FILE, JSON.stringify({ ...paraArchivo(x), leyendas: limpias }));
    return;
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT leyendas FROM alertas_meteo_publicaciones WHERE id = $1 AND vigente_hasta > now() FOR UPDATE`, [id]);
    if (!rows.length) throw Object.assign(new Error("La alerta no está publicada."), { status: 404 });
    await client.query(`UPDATE alertas_meteo_publicaciones SET leyendas = $2::jsonb, actualizada_en = now() WHERE id = $1`, [id, JSON.stringify(limpias)]);
    await registrarEvento(client, { publicacionId: id, evento: "leyendas_cambiadas", usuarioId, detalle: { antes: rows[0].leyendas || {}, despues: limpias } });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Guarda las vigencias individuales (ver tramosAlerta.js) de una publicada o en fila. `{}` las borra. */
async function cambiarTramos(id, tramos, usuarioId = null) {
  await init();
  const p = store.getPool();
  const ids = new Set(require("./departamentos").loadDepartamentos().map((d) => String(d.id)));
  if (!p) {
    const x = await actual();
    if (!x || x.id !== id || Date.parse(x.vigenteHasta) <= Date.now()) throw Object.assign(new Error("La alerta no está publicada."), { status: 404 });
    const error = errorDeTramos(tramos, ids, x.vigenteHasta);
    if (error) throw Object.assign(new Error(error), { status: 400 });
    fs.writeFileSync(FILE, JSON.stringify({ ...paraArchivo(x), tramos: normalizarTramos(tramos) }));
    return;
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT vigente_hasta, tramos FROM alertas_meteo_publicaciones WHERE id = $1 AND vigente_hasta > now() FOR UPDATE`, [id]);
    if (!rows.length) throw Object.assign(new Error("La alerta no está publicada."), { status: 404 });
    const error = errorDeTramos(tramos, ids, rows[0].vigente_hasta);
    if (error) throw Object.assign(new Error(error), { status: 400 });
    const limpios = normalizarTramos(tramos);
    await client.query(`UPDATE alertas_meteo_publicaciones SET tramos = $2::jsonb, actualizada_en = now() WHERE id = $1`, [id, JSON.stringify(limpios)]);
    await registrarEvento(client, { publicacionId: id, evento: "vigencias_individuales_cambiadas", usuarioId, detalle: { antes: rows[0].tramos || {}, despues: limpios } });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { init, publicar, actual, pendientes, vigentes, despublicar, cambiarVigencia, cambiarLeyenda, cambiarLeyendas, cambiarTramos, fijar, registrarEvento, eventos, errorDePublicacion, errorDeCambioVigencia, MAX_PERIODO_PUBLICACION, MAX_DIAS_EN_FILA };
