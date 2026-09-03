const crypto = require("crypto");
const { hash: argon2Hash, verify: argon2Verify } = require("@node-rs/argon2");
const store = require("./store");

/**
 * Login por sesión en base (no JWT): el cookie solo lleva un token opaco
 * random; lo que se guarda en `sesiones` es el HASH de ese token, nunca el
 * token en sí — así un dump de la tabla no alcanza para robar sesiones.
 * Mismo patrón que usan Auth.js/Lucia con "database sessions".
 *
 * Contraseñas con Argon2id (`@node-rs/argon2`, binario precompilado vía
 * napi-rs — no hace falta toolchain de compilación ni en local ni en el
 * Docker de producción), el ganador de la Password Hashing Competition y
 * la recomendación #1 de OWASP.
 */

const COOKIE_SESION = "sesion";
const SESION_DIAS = 30;

let listo = null;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Crea las tablas la primera vez. Requiere DATABASE_URL (no hay fallback
 * a disco para usuarios/sesiones — es el único módulo sensible del back). */
async function init() {
  if (listo) return listo;
  await store.init();
  const pool = store.getPool();
  if (!pool) {
    console.warn("[auth] Falta DATABASE_URL — el login no va a funcionar");
    return;
  }
  listo = pool
    .query(
      `CREATE TABLE IF NOT EXISTS usuarios (
         id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         email         text NOT NULL UNIQUE,
         password_hash text NOT NULL,
         creado_en     timestamptz NOT NULL DEFAULT now()
       );
       CREATE TABLE IF NOT EXISTS sesiones (
         id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         token_hash    text NOT NULL UNIQUE,
         usuario_id    bigint NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
         expira_en     timestamptz NOT NULL,
         creado_en     timestamptz NOT NULL DEFAULT now()
       )`
    )
    .then(() => console.log("[auth] Postgres listo (tablas usuarios/sesiones)"));
  return listo;
}

/** Alta o cambio de contraseña de un usuario. Sin registro público — se usa
 * desde `scripts/crear-usuario.js`. */
async function crearUsuario(email, password) {
  await init();
  const pool = store.getPool();
  if (!pool) throw new Error("Falta DATABASE_URL");
  const hash = await argon2Hash(password);
  const { rows } = await pool.query(
    `INSERT INTO usuarios (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, email`,
    [String(email).trim().toLowerCase(), hash]
  );
  return rows[0];
}

async function verificarCredenciales(email, password) {
  await init();
  const pool = store.getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT id, email, password_hash FROM usuarios WHERE email = $1`,
    [String(email || "").trim().toLowerCase()]
  );
  if (!rows.length) {
    // Corremos un hash "señuelo" igual para que el tiempo de respuesta no
    // delate si el email existe o no (mitiga user enumeration por timing).
    await argon2Hash("señuelo-" + crypto.randomBytes(8).toString("hex")).catch(() => {});
    return null;
  }
  const usuario = rows[0];
  const ok = await argon2Verify(usuario.password_hash, password).catch(() => false);
  if (!ok) return null;
  return { id: usuario.id, email: usuario.email };
}

async function crearSesion(usuarioId) {
  await init();
  const pool = store.getPool();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiraEn = new Date(Date.now() + SESION_DIAS * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO sesiones (token_hash, usuario_id, expira_en) VALUES ($1, $2, $3)`,
    [hashToken(token), usuarioId, expiraEn]
  );
  return { token, expiraEn };
}

async function obtenerSesion(token) {
  if (!token) return null;
  await init();
  const pool = store.getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT s.usuario_id, u.email
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.expira_en > now()`,
    [hashToken(token)]
  );
  if (!rows.length) return null;
  return { usuarioId: rows[0].usuario_id, email: rows[0].email };
}

async function borrarSesion(token) {
  if (!token) return;
  await init();
  const pool = store.getPool();
  if (!pool) return;
  await pool.query(`DELETE FROM sesiones WHERE token_hash = $1`, [hashToken(token)]);
}

module.exports = {
  init,
  crearUsuario,
  verificarCredenciales,
  crearSesion,
  obtenerSesion,
  borrarSesion,
  COOKIE_SESION,
  SESION_DIAS,
};
