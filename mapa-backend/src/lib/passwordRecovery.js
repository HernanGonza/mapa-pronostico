const crypto = require('node:crypto');
const { hash } = require('@node-rs/argon2');
const auth = require('./auth');
const store = require('./store');

const MINUTOS = 15;
const ERROR_CODIGO = 'El código no es válido o venció. Pedile un código nuevo al superadministrador.';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function normalizarCodigo(value) {
  return typeof value === 'string' && value.length <= 80 ? value.replace(/[\s-]/g, '').toLowerCase() : '';
}
let listo;
async function init() {
  await auth.init();
  const pool = store.getPool();
  if (!pool) throw new Error('Falta DATABASE_URL');
  // Mismo mecanismo de inicialización idempotente que usuarios/sesiones.
  if (!listo) listo = pool.query(`
    CREATE TABLE IF NOT EXISTS recuperaciones_password (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      usuario_id bigint NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      emitido_por bigint REFERENCES usuarios(id) ON DELETE SET NULL,
      codigo_hash text NOT NULL UNIQUE,
      creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
      expira_en timestamptz NOT NULL,
      usado_en timestamptz,
      revocado_en timestamptz
    );
    CREATE INDEX IF NOT EXISTS recuperaciones_password_usuario_idx ON recuperaciones_password(usuario_id);
    CREATE UNIQUE INDEX IF NOT EXISTS recuperaciones_password_activo_idx
      ON recuperaciones_password(usuario_id) WHERE usado_en IS NULL AND revocado_en IS NULL;
    ALTER TABLE recuperaciones_password ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON recuperaciones_password FROM PUBLIC;
  `).catch(error => { listo = null; throw error; });
  await listo;
  return pool;
}
function errorPublico(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
async function generar(usuarioId, actorId, telefonoConfirmado) {
  const pool = await init();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Un mismo orden de locks serializa emisión, uso y login para la cuenta.
    const { rows } = await client.query('SELECT id, telefono FROM usuarios WHERE id = $1 FOR UPDATE', [usuarioId]);
    const usuario = rows[0];
    if (!usuario) throw errorPublico('No se encontró el usuario.', 404);
    if (!usuario.telefono || usuario.telefono !== telefonoConfirmado) {
      throw errorPublico('Revisá el teléfono registrado antes de generar el código.');
    }
    const actor = await client.query(`SELECT 1 FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = $1 AND r.nombre = 'superadmin'`, [actorId]);
    if (!actor.rowCount) throw errorPublico('No tenés permiso para generar códigos.', 403);
    const codigo = crypto.randomBytes(16).toString('hex'); // 128 bits, apto para copiar por WhatsApp.
    await client.query('UPDATE recuperaciones_password SET revocado_en = clock_timestamp() WHERE usuario_id = $1 AND usado_en IS NULL AND revocado_en IS NULL', [usuarioId]);
    const result = await client.query(`INSERT INTO recuperaciones_password(usuario_id, emitido_por, codigo_hash, expira_en)
      VALUES ($1, $2, $3, clock_timestamp() + interval '15 minutes') RETURNING expira_en`, [usuarioId, actorId, digest(codigo)]);
    await client.query('COMMIT');
    return { codigo: codigo.toUpperCase().match(/.{1,4}/g).join('-'), expiraEn: result.rows[0].expira_en, minutos: MINUTOS };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function restablecer(codigoIngresado, password) {
  const codigo = normalizarCodigo(codigoIngresado);
  if (!/^[a-f0-9]{32}$/.test(codigo)) throw errorPublico(ERROR_CODIGO);
  if (typeof password !== 'string' || password.length > 256 || !auth.validarPassword(password)) {
    throw errorPublico('La contraseña no cumple los requisitos (máximo 256 caracteres).');
  }
  const pool = await init();
  const codigoHash = digest(codigo);
  const found = await pool.query(`SELECT usuario_id FROM recuperaciones_password
    WHERE codigo_hash = $1 AND usado_en IS NULL AND revocado_en IS NULL AND expira_en > clock_timestamp()`, [codigoHash]);
  if (!found.rowCount) throw errorPublico(ERROR_CODIGO);
  // Argon2 fuera de la transacción para no retener locks durante el cálculo.
  const passwordHash = await hash(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const usuarioId = found.rows[0].usuario_id;
    await client.query('SELECT id FROM usuarios WHERE id = $1 FOR UPDATE', [usuarioId]);
    const used = await client.query(`UPDATE recuperaciones_password SET usado_en = clock_timestamp()
      WHERE codigo_hash = $1 AND usado_en IS NULL AND revocado_en IS NULL AND expira_en > clock_timestamp() RETURNING id`, [codigoHash]);
    if (!used.rowCount) throw errorPublico(ERROR_CODIGO);
    await client.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [passwordHash, usuarioId]);
    await client.query('DELETE FROM sesiones WHERE usuario_id = $1', [usuarioId]);
    await client.query('UPDATE recuperaciones_password SET revocado_en = clock_timestamp() WHERE usuario_id = $1 AND usado_en IS NULL AND revocado_en IS NULL', [usuarioId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports = { init, generar, restablecer, normalizarCodigo, ERROR_CODIGO };
