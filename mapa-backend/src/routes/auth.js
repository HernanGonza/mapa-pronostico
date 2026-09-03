const express = require("express");
const { parseCookie, stringifySetCookie } = require("cookie");
const rateLimit = require("express-rate-limit");
const auth = require("../lib/auth");
const requireAuth = require("../middleware/requireAuth");

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
      secure: process.env.NODE_ENV === "production",
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
    const { token, expiraEn } = await auth.crearSesion(usuario.id);
    setCookieSesion(res, token, expiraEn);
    res.json({ email: usuario.email });
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
  res.json({ email: req.usuario.email });
});

module.exports = router;
