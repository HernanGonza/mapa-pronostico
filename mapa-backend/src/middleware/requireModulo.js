const { tiene } = require("../lib/modulos");

/** Exige que el usuario (colgado por `requireAuth`, correr siempre después) tenga habilitado el módulo, o sea superadmin. */
function requireModulo(id) {
  return (req, res, next) => {
    if (!tiene(req.usuario, id)) return res.status(403).json({ error: "No tenés habilitado este módulo" });
    next();
  };
}

module.exports = requireModulo;
