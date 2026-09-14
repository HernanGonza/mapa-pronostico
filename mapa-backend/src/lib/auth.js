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
 *
 * Sin alta pública: los usuarios se crean desde la pantalla "Usuarios" del
 * panel (solo visible para `admin`/`superadmin`, ver `routes/auth.js`), o
 * desde `scripts/crear-usuario.js` para el arranque en frío (el primer
 * usuario no puede crearse solo, hace falta estar logueado para usar la
 * pantalla).
 */

const COOKIE_SESION = "sesion";
const SESION_DIAS = 30;

// Orden de jerarquía, de mayor a menor privilegio.
const ROLES = ["superadmin", "admin", "usuario"];

/** ¿Quien tiene `rolCreador` puede dar de alta un usuario con `rolNuevo`?
 * Solo `superadmin` accede a la pantalla "Usuarios" (front y back), así
 * que es el único que crea usuarios — de cualquier rol. */
function puedeCrearRol(rolCreador, rolNuevo) {
  if (!ROLES.includes(rolNuevo)) return false;
  return rolCreador === "superadmin";
}

/** Reglas de contraseña — el checklist del front (`PasswordChecklist.jsx`)
 * replica estas mismas 4 reglas para el tilde en vivo; si se cambia acá,
 * cambiar también ahí. Se revalida siempre acá (nunca confiar solo en el
 * front). */
const REGLAS_PASSWORD = [
  { id: "longitud", label: "Al menos 8 caracteres", test: (p) => p.length >= 8 },
  { id: "mayuscula", label: "Una letra mayúscula", test: (p) => /[A-Z]/.test(p) },
  { id: "numero", label: "Un número", test: (p) => /[0-9]/.test(p) },
  { id: "especial", label: "Un carácter especial", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

function validarPassword(password) {
  const p = String(password || "");
  return REGLAS_PASSWORD.every((r) => r.test(p));
}

/** DNI argentino: solo dígitos, 7 u 8 caracteres. */
function validarDni(dni) {
  return /^\d{7,8}$/.test(String(dni || "").trim());
}

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
  // `roles` es tabla propia (no un CHECK ni un enum) para que sea una
  // relación real: `usuarios.rol_id` referencia `roles(id)`. Solo maneja
  // los 3 roles fijos que pidió el usuario — se siembra desde `ROLES`
  // (única fuente de verdad, ver más abajo) así no hay dos listas
  // desincronizables.
  const placeholdersRoles = ROLES.map((_, i) => `($${i + 1})`).join(",");
  listo = pool
    .query(
      `CREATE TABLE IF NOT EXISTS roles (
         id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         nombre text NOT NULL UNIQUE
       )`
    )
    .then(() =>
      pool.query(`INSERT INTO roles (nombre) VALUES ${placeholdersRoles} ON CONFLICT (nombre) DO NOTHING`, ROLES)
    )
    .then(() =>
      pool.query(
        `CREATE TABLE IF NOT EXISTS usuarios (
         id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         email         text NOT NULL UNIQUE,
         password_hash text NOT NULL,
         nombre        text,
         apellido      text,
         telefono      text,
         dni           text,
         puesto        text,
         dependencia   text,
         rol_id        bigint NOT NULL REFERENCES roles(id),
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
    )
    // Migración para instalaciones que ya tenían `usuarios` de antes: con
    // el esquema mínimo original (sin ninguna de estas columnas) o con la
    // versión intermedia que tenía `rol` como texto suelto. Se agrega
    // `rol_id`, se migra el valor de `rol` si existía (el `DO` atrapa
    // "undefined_column" para cuando esa columna nunca existió), se
    // completa con 'usuario' lo que quede sin resolver, recién ahí se
    // exige NOT NULL, y se borra la columna vieja.
    .then(() =>
      pool.query(
        `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nombre text;
         ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS apellido text;
         ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefono text;
         ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS dni text;
         ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS puesto text;
         ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS dependencia text;
         ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol_id bigint REFERENCES roles(id);
         DO $$
         BEGIN
           UPDATE usuarios u SET rol_id = r.id FROM roles r WHERE u.rol_id IS NULL AND u.rol = r.nombre;
         EXCEPTION WHEN undefined_column THEN
           NULL;
         END $$;
         UPDATE usuarios SET rol_id = (SELECT id FROM roles WHERE nombre = 'usuario') WHERE rol_id IS NULL;
         ALTER TABLE usuarios ALTER COLUMN rol_id SET NOT NULL;
         ALTER TABLE usuarios DROP COLUMN IF EXISTS rol`
      )
    )
    .then(() => console.log("[auth] Postgres listo (tablas roles/usuarios/sesiones)"));
  return listo;
}

// `r.nombre AS rol` mantiene el mismo contrato hacia afuera (rutas y
// frontend siguen viendo `rol` como string) aunque adentro ya sea una FK.
const CAMPOS_USUARIO = "u.id, u.email, u.nombre, u.apellido, u.telefono, u.dni, u.puesto, u.dependencia, r.nombre AS rol, u.creado_en";

/**
 * Alta (o reset de contraseña) de un usuario.
 * `permitirActualizar`: si el email ya existe, pisa sus datos en vez de
 * fallar — solo lo usa `scripts/crear-usuario.js` (bootstrap/reset a
 * mano); la pantalla del panel lo deja en `false` para no pisar una
 * cuenta existente por error.
 */
async function crearUsuario({
  email,
  password,
  nombre = null,
  apellido = null,
  telefono = null,
  dni = null,
  puesto = null,
  dependencia = null,
  rol = "usuario",
  permitirActualizar = false,
}) {
  await init();
  const pool = store.getPool();
  if (!pool) throw new Error("Falta DATABASE_URL");
  if (!ROLES.includes(rol)) throw new Error(`Rol inválido: ${rol}`);
  const hash = await argon2Hash(password);
  const valores = [
    String(email).trim().toLowerCase(),
    hash,
    nombre,
    apellido,
    telefono,
    dni,
    puesto,
    dependencia,
    rol,
  ];
  // `rol_id` se resuelve con una subconsulta a `roles` (ya se validó arriba
  // que `rol` es uno de los 3 válidos). El `INSERT` va en un CTE nombrado
  // `u` porque `RETURNING` no puede hacer el `JOIN` a `roles` directo —
  // así, `CAMPOS_USUARIO` (que espera alias `u`/`r`) se puede reusar igual
  // que en el resto de las consultas.
  const sql = permitirActualizar
    ? `WITH u AS (
         INSERT INTO usuarios (email, password_hash, nombre, apellido, telefono, dni, puesto, dependencia, rol_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT id FROM roles WHERE nombre = $9))
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash, nombre = EXCLUDED.nombre, apellido = EXCLUDED.apellido,
           telefono = EXCLUDED.telefono, dni = EXCLUDED.dni, puesto = EXCLUDED.puesto,
           dependencia = EXCLUDED.dependencia, rol_id = EXCLUDED.rol_id
         RETURNING *
       )
       SELECT ${CAMPOS_USUARIO} FROM u JOIN roles r ON r.id = u.rol_id`
    : `WITH u AS (
         INSERT INTO usuarios (email, password_hash, nombre, apellido, telefono, dni, puesto, dependencia, rol_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT id FROM roles WHERE nombre = $9))
         RETURNING *
       )
       SELECT ${CAMPOS_USUARIO} FROM u JOIN roles r ON r.id = u.rol_id`;
  try {
    const { rows } = await pool.query(sql, valores);
    return rows[0];
  } catch (err) {
    if (err.code === "23505") throw new Error("Ya existe un usuario con ese email");
    throw err;
  }
}

/** Usuarios dados de alta, para la tabla de la pantalla "Usuarios". */
async function listarUsuarios() {
  await init();
  const pool = store.getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT ${CAMPOS_USUARIO} FROM usuarios u JOIN roles r ON r.id = u.rol_id ORDER BY u.creado_en DESC`
  );
  return rows;
}

async function verificarCredenciales(email, password) {
  await init();
  const pool = store.getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.password_hash, r.nombre AS rol, u.nombre
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.email = $1`,
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
  return { id: usuario.id, email: usuario.email, rol: usuario.rol, nombre: usuario.nombre, passwordHash: usuario.password_hash };
}

async function crearSesion(usuarioId, passwordHash) {
  await init();
  const pool = store.getPool();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiraEn = new Date(Date.now() + SESION_DIAS * 24 * 60 * 60 * 1000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT password_hash FROM usuarios WHERE id = $1 FOR UPDATE', [usuarioId]);
    if (!rows.length || (passwordHash && rows[0].password_hash !== passwordHash)) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(`INSERT INTO sesiones (token_hash, usuario_id, expira_en) VALUES ($1, $2, $3)`,
      [hashToken(token), usuarioId, expiraEn]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  return { token, expiraEn };
}

async function obtenerSesion(token) {
  if (!token) return null;
  await init();
  const pool = store.getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT s.usuario_id, u.email, r.nombre AS rol, u.nombre
       FROM sesiones s
       JOIN usuarios u ON u.id = s.usuario_id
       JOIN roles r ON r.id = u.rol_id
      WHERE s.token_hash = $1 AND s.expira_en > now()`,
    [hashToken(token)]
  );
  if (!rows.length) return null;
  return { usuarioId: rows[0].usuario_id, email: rows[0].email, rol: rows[0].rol, nombre: rows[0].nombre };
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
  listarUsuarios,
  verificarCredenciales,
  crearSesion,
  obtenerSesion,
  borrarSesion,
  COOKIE_SESION,
  SESION_DIAS,
  ROLES,
  puedeCrearRol,
  validarPassword,
  validarDni,
  REGLAS_PASSWORD,
};
