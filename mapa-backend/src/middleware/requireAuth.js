const { parseCookie } = require("cookie");
const auth = require("../lib/auth");

/** Protege una ruta: exige el cookie de sesión y cuelga `req.usuario`. */
async function requireAuth(req, res, next) {
  try {
    const cookies = parseCookie(req.headers.cookie || "");
    const sesion = await auth.obtenerSesion(cookies[auth.COOKIE_SESION]);
    if (!sesion) return res.status(401).json({ error: "No autenticado" });
    req.usuario = sesion;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error verificando la sesión" });
  }
}

module.exports = requireAuth;
