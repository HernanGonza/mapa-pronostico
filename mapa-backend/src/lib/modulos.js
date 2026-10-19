/**
 * Módulos del panel que se habilitan usuario por usuario (pantalla «Usuarios»). El superadmin los tiene
 * todos; el resto, sólo los que se le asignaron (columna `usuarios.modulos`). Lo que no figura acá
 * (generador de mapas, histórico…) lo ve cualquier usuario con sesión, como siempre.
 * El front tiene el espejo con título, ícono y ruta: mapa-frontend/src/lib/modulos.js. Para sumar un
 * módulo: agregar su id en las dos listas y proteger su ruta (front: RutaProtegida modulo=…;
 * back: requireModulo(…) si tiene endpoints propios).
 */
const MODULOS = [
  "focos-de-calor",
  "inundaciones",
  "cuencas",
  "tabla-precipitaciones",
  "ensamble",
];

/** Módulos que ya no existen: si un usuario todavía los tiene asignados se ignoran en vez de dar error. */
const RETIRADOS = ["generador-pronosticos", "informes-diarios", "alertas-automaticas"];

/** Lista saneada para guardar: sólo ids conocidos, sin repetir. `null` si no es una lista de ids válidos. */
function normalizar(modulos) {
  if (modulos == null) return [];
  if (!Array.isArray(modulos) || modulos.some((m) => !MODULOS.includes(m) && !RETIRADOS.includes(m))) return null;
  return MODULOS.filter((m) => modulos.includes(m));
}

/** ¿Este usuario de sesión (rol + modulos) puede usar el módulo? */
// «informes-diarios» (retirado) valía para el informe de precipitaciones: quien lo tenía conserva el acceso a «tabla-precipitaciones».
const ALIAS = { "tabla-precipitaciones": "informes-diarios" };
const tiene = (usuario, id) => !!usuario && (usuario.rol === "superadmin" || (usuario.modulos || []).includes(id) || (!!ALIAS[id] && (usuario.modulos || []).includes(ALIAS[id])));

module.exports = { MODULOS, normalizar, tiene };
