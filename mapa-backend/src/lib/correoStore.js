const store = require("./store");
const auth = require("./auth");

/**
 * Correo del pronóstico diario:
 *   correo_destinatarios  lista fija de a quién se manda (se edita desde el panel).
 *                         Arranca con la lista que se usaba desde el Gmail.
 *   correo_envios         registro de cada envío (quién, cuándo, asunto, a quiénes,
 *                         qué archivos y si salió bien).
 */

// Lista base (la que se usaba desde el Gmail, 30/09/2026). Sólo se carga si la tabla está vacía.
const LISTA_BASE = [
  ["Agro", "nuestroagromisiones@gmail.com"],
  ["Carlos Da Rosa", "carlosagarciadarosa@gmail.com"],
  ["", "vivianacristaldo33@gmail.com"],
  ["Raúl Puentes", "raulpuentes@gmail.com"],
  ["Mauro Kairiyama", "ma40kiyo97@gmail.com"],
  ["Matias Bareiro", "djmatiasbareiro@gmail.com"],
  ["", "artecanal12@gmail.com"],
  ["", "periodistascanal4posadas@gmail.com"],
  ["LUP", "laultimapalabratv12@gmail.com"],
  ["Leandro Saucedo", "leandrosaucedo.radc@gmail.com"],
  ["", "presidenciacanal4posadas@gmail.com"],
  ["Ingrid Fedorichak", "docereinaslocal@gmail.com"],
  ["Patricio Agulla", "agulla.patricio@outlook.es"],
  ["Flor Alvarez", "flooralvarez55@gmail.com"],
  ["Artística Canal 12", "artisticacanaldoce@gmail.com"],
  ["Romina Kujarchuk", "rominakujarchuk@gmail.com"],
  ["Noticiero 12", "elnoticiero12@gmail.com"],
  ["Marianela Brys", "marianela.brys@gmail.com"],
  ["Piro Benítez", "piro14@gmail.com"],
  ["GERMAN VOGLER EDIC", "edicionesgermanvogler@gmail.com"],
  ["", "tefyfaro@gmail.com"],
  ["Carlos Antunez", "carlosantunez116@gmail.com"],
];

const MAX_DESTINATARIOS = 200;
const RE_EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

let initPromise;
async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  await auth.init();
  const p = store.getPool();
  initPromise = (async () => {
    await p.query(
      `CREATE TABLE IF NOT EXISTS correo_destinatarios (
         id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         nombre    text NOT NULL DEFAULT '',
         email     text NOT NULL UNIQUE,
         creado_en timestamptz NOT NULL DEFAULT now()
       );
       CREATE TABLE IF NOT EXISTS correo_envios (
         id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         enviado_por    bigint REFERENCES usuarios(id),
         enviado_en     timestamptz NOT NULL DEFAULT now(),
         asunto         text NOT NULL,
         cuerpo         text NOT NULL,
         destinatarios  jsonb NOT NULL,
         adjuntos       jsonb NOT NULL,
         ok             boolean NOT NULL,
         error          text
       )`
    );
    const { rows } = await p.query(`SELECT count(*)::int AS n FROM correo_destinatarios`);
    if (rows[0].n === 0) {
      for (const [nombre, email] of LISTA_BASE) {
        await p.query(`INSERT INTO correo_destinatarios (nombre, email) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING`, [nombre, email]);
      }
    }
    console.log("[correoStore] Postgres listo (correo_destinatarios, correo_envios)");
  })().catch((e) => {
    initPromise = null;
    throw e;
  });
  return initPromise;
}

function sinBase() {
  return Object.assign(new Error("El correo necesita la base de datos."), { status: 503 });
}

/** Valida y normaliza la lista que manda el panel: [{ nombre, email }]. */
function normalizarLista(lista) {
  if (!Array.isArray(lista)) return { error: "Lista de destinatarios inválida." };
  if (lista.length > MAX_DESTINATARIOS) return { error: `Hasta ${MAX_DESTINATARIOS} destinatarios.` };
  const vistos = new Set(), salida = [];
  for (const [i, d] of lista.entries()) {
    const email = String(d?.email || "").trim().toLowerCase();
    const nombre = String(d?.nombre || "").trim().slice(0, 120);
    if (!RE_EMAIL.test(email) || email.length > 254) return { error: `Fila ${i + 1}: «${d?.email || ""}» no es una dirección de correo válida.` };
    if (vistos.has(email)) return { error: `«${email}» está repetida.` };
    vistos.add(email);
    salida.push({ nombre, email });
  }
  return { lista: salida };
}

async function destinatarios() {
  if (!store.usaPostgres()) return [];
  await init();
  const { rows } = await store.getPool().query(`SELECT id, nombre, email FROM correo_destinatarios ORDER BY lower(coalesce(nullif(nombre,''), email))`);
  return rows.map((r) => ({ id: Number(r.id), nombre: r.nombre, email: r.email }));
}

/** Reemplaza la lista completa (lo que se guarda desde el asistente de edición). */
async function guardarDestinatarios(lista) {
  if (!store.usaPostgres()) throw sinBase();
  await init();
  const client = await store.getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM correo_destinatarios WHERE NOT (email = ANY($1::text[]))`, [lista.map((d) => d.email)]);
    for (const d of lista) {
      await client.query(`INSERT INTO correo_destinatarios (nombre, email) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre`, [d.nombre, d.email]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return destinatarios();
}

async function registrarEnvio({ usuarioId, asunto, cuerpo, destinatarios: lista, adjuntos, ok, error }) {
  if (!store.usaPostgres()) return;
  await init();
  await store.getPool().query(
    `INSERT INTO correo_envios (enviado_por, asunto, cuerpo, destinatarios, adjuntos, ok, error) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,
    [usuarioId, asunto, cuerpo, JSON.stringify(lista), JSON.stringify(adjuntos), ok, error || null]
  );
}

async function envios(limite = 20) {
  if (!store.usaPostgres()) return [];
  await init();
  const { rows } = await store.getPool().query(
    `SELECT e.id, e.enviado_en, e.asunto, e.destinatarios, e.adjuntos, e.ok, e.error, u.email AS enviado_por_email
       FROM correo_envios e LEFT JOIN usuarios u ON u.id = e.enviado_por
      ORDER BY e.enviado_en DESC LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({ id: Number(r.id), enviadoEn: r.enviado_en.toISOString(), asunto: r.asunto, cantidad: r.destinatarios.length, adjuntos: r.adjuntos, ok: r.ok, error: r.error, enviadoPorEmail: r.enviado_por_email }));
}

module.exports = { init, destinatarios, guardarDestinatarios, normalizarLista, registrarEnvio, envios, LISTA_BASE, MAX_DESTINATARIOS };
