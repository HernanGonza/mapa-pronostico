const express = require("express");
const { parseCookie, stringifySetCookie } = require("cookie");
const rateLimit = require("express-rate-limit");
const auth = require("../lib/auth");
const requireAuth = require("../middleware/requireAuth");
const requireRole = require("../middleware/requireRole");

const recovery = require("../lib/passwordRecovery");
const router = express.Router();

// Frena fuerza bruta contra /login sin bloquear el resto de la API.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Probá de nuevo en unos minutos." },
});

function setCookieSesion(res, token, expiraEn) {
  res.setHeader(
    "Set-Cookie",
    stringifySetCookie({
      name: auth.COOKIE_SESION,
      value: token,
      httpOnly: true,
      secure: process.env.SESSION_COOKIE_SECURE === "false"
        ? false
        : process.env.SESSION_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiraEn,
    })
  );
}

router.post("/auth/login", loginLimiter, express.json(), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Faltan email y/o contraseña" });
  }
  try {
    const usuario = await auth.verificarCredenciales(email, password);
    if (!usuario) {
      return res.status(401).json({ error: "Email o contraseña incorrectos" });
    }
    const sesion = await auth.crearSesion(usuario.id, usuario.passwordHash);
    if (!sesion) return res.status(401).json({ error: "Las credenciales cambiaron. Volvé a iniciar sesión." });
    const { token, expiraEn } = sesion;
    setCookieSesion(res, token, expiraEn);
    res.json({ email: usuario.email, rol: usuario.rol, nombre: usuario.nombre });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo iniciar sesión" });
  }
});

router.post("/auth/logout", async (req, res) => {
  const cookies = parseCookie(req.headers.cookie || "");
  await auth.borrarSesion(cookies[auth.COOKIE_SESION]).catch(() => {});
  res.setHeader(
    "Set-Cookie",
    stringifySetCookie({
      name: auth.COOKIE_SESION,
      value: "",
      httpOnly: true,
      path: "/",
      expires: new Date(0),
    })
  );
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth, (req, res) => {
  res.json({ email: req.usuario.email, rol: req.usuario.rol, nombre: req.usuario.nombre });
});

// --- Usuarios (alta desde el panel — no hay registro público) -------------
// Solo `superadmin` ve y usa esta pantalla — `admin` y `usuario` ni
// llegan (el front la oculta, y esto la respalda del lado del servidor).

router.get("/auth/usuarios", requireAuth, requireRole("superadmin"), async (req, res) => {
  try {
    const usuarios = await auth.listarUsuarios();
    res.json(usuarios);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo obtener la lista de usuarios" });
  }
});

router.post(
  "/auth/usuarios",
  requireAuth,
  requireRole("superadmin"),
  express.json(),
  async (req, res) => {
    const {
      email,
      password,
      repetirPassword,
      nombre,
      apellido,
      telefono,
      dni,
      puesto,
      dependencia,
      rol,
    } = req.body || {};

    if (!email || !password || !nombre || !apellido || !telefono || !dni || !rol) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }
    if (password !== repetirPassword) {
      return res.status(400).json({ error: "Las contraseñas no coinciden" });
    }
    if (!auth.validarPassword(password)) {
      return res.status(400).json({ error: "La contraseña no cumple los requisitos mínimos" });
    }
    if (!auth.validarDni(dni)) {
      return res.status(400).json({ error: "El DNI tiene que tener 7 u 8 dígitos, sin puntos" });
    }
    if (!auth.puedeCrearRol(req.usuario.rol, rol)) {
      return res.status(403).json({ error: "No tenés permiso para crear un usuario con ese rol" });
    }

    try {
      const usuario = await auth.crearUsuario({
        email,
        password,
        nombre,
        apellido,
        telefono,
        dni,
        puesto: puesto || null,
        dependencia: dependencia || null,
        rol,
      });
      res.status(201).json(usuario);
    } catch (err) {
      const conocido = /Ya existe un usuario/.test(err.message);
      if (!conocido) console.error(err);
      res.status(conocido ? 409 : 500).json({ error: conocido ? err.message : "No se pudo crear el usuario" });
    }
  }
);

const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: "Demasiados intentos. Probá de nuevo en 15 minutos." },
});
const issueLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => String(req.usuario.usuarioId),
  message: { error: "Se generaron demasiados códigos. Probá de nuevo en 15 minutos." },
});
const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => require('node:crypto').createHash('sha256').update(recovery.normalizarCodigo(req.body?.codigo)).digest('hex'),
  message: { error: "Demasiados intentos con este código. Esperá o pedí uno nuevo." },
});
function noCache(req, res, next) { res.setHeader("Cache-Control", "no-store"); next(); }
router.post('/auth/usuarios/:id/recuperacion', noCache, requireAuth, requireRole('superadmin'), issueLimiter, express.json({ limit: '4kb' }), async (req, res) => {
  if (!/^[1-9][0-9]{0,17}$/.test(req.params.id) || req.body?.identidadVerificada !== true || typeof req.body?.telefono !== 'string') {
    return res.status(400).json({ error: 'Confirmá la identidad y el teléfono registrado de la persona.' });
  }
  try {
    res.status(201).json(await recovery.generar(req.params.id, req.usuario.usuarioId, req.body.telefono));
  } catch (error) {
    if (!error.status) console.error('[recovery] No se pudo emitir el código:', error.code || 'error interno');
    res.status(error.status || 500).json({ error: error.status ? error.message : 'No se pudo generar el código. Intentá nuevamente.' });
  }
});
router.post('/auth/recuperacion', noCache, recoveryLimiter, express.json({ limit: '4kb' }), codeLimiter, async (req, res) => {
  const { codigo, password, repetirPassword } = req.body || {};
  if (typeof password !== 'string' || password !== repetirPassword || password.length > 256 || !auth.validarPassword(password)) {
    return res.status(400).json({ error: 'Las contraseñas deben coincidir y cumplir los requisitos (máximo 256 caracteres).' });
  }
  try {
    await recovery.restablecer(codigo, password);
    res.json({ ok: true });
  } catch (error) {
    if (!error.status) console.error('[recovery] No se pudo cambiar la contraseña:', error.code || 'error interno');
    res.status(error.status || 500).json({ error: error.status ? error.message : 'No se pudo cambiar la contraseña. Intentá nuevamente.' });
  }
});

module.exports = router;
