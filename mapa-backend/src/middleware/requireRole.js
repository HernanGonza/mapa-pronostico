/** Exige que `req.usuario` (colgado por `requireAuth`, correr siempre
 * después de ese) tenga uno de los roles permitidos. Usar después de
 * `requireAuth` en la cadena de middlewares de la ruta. */
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario || !rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: "No tenés permiso para hacer esto" });
    }
    next();
  };
}

module.exports = requireRole;
