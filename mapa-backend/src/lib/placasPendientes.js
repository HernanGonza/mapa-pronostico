const crypto = require("crypto");

/**
 * Vistas previas de placas que todavía NO se guardaron. El asistente del panel genera la placa, la
 * muestra, y recién cuando la persona confirma se guarda (la misma imagen, sin volver a generarla).
 * Viven en memoria, con dueño (sólo quien la generó las ve o las confirma), vencen y hay un tope: son
 * PNG grandes. Si el servidor se reinicia se pierden, y el panel simplemente pide otra vista previa.
 */
const VENCE_MS = 30 * 60 * 1000;
const MAXIMO = 12;
const pendientes = new Map(); // token → { feedPng, historiasPng, usuarioId, expira }

function limpiar() {
  const ahora = Date.now();
  for (const [token, p] of pendientes) if (p.expira <= ahora) pendientes.delete(token);
  while (pendientes.size > MAXIMO) pendientes.delete(pendientes.keys().next().value); // el más viejo
}

function guardar({ feedPng, historiasPng }, usuarioId) {
  limpiar();
  const token = crypto.randomBytes(16).toString("hex");
  pendientes.set(token, { feedPng, historiasPng, usuarioId, expira: Date.now() + VENCE_MS });
  return { token, vistaPrevia: true, feedUrl: `/api/placas/pendientes/${token}/feed.png`, historiasUrl: `/api/placas/pendientes/${token}/historias.png` };
}

/** Devuelve la vista previa (sin quitarla) si existe, no venció y es de esta persona. */
function obtener(token, usuarioId) {
  limpiar();
  const p = pendientes.get(String(token));
  return p && p.usuarioId === usuarioId ? p : null;
}

/** Como obtener(), pero la consume: una vista previa se confirma una sola vez. */
function tomar(token, usuarioId) {
  const p = obtener(token, usuarioId);
  if (p) pendientes.delete(String(token));
  return p;
}

/**
 * Resuelve el pedido de una ruta que genera placas, en sus tres modos:
 *  - `vistaPrevia: true`   → genera y devuelve una vista previa temporal (no guarda nada).
 *  - `confirmarToken: "…"` → guarda la vista previa ya generada (no vuelve a generar).
 *  - ninguno               → genera y guarda directo (compatibilidad con el resto del sistema).
 * `generar()` → { feedPng, historiasPng }; `guardar({ feedPng, historiasPng })` → la placa guardada.
 */
async function resolver(req, res, { generar, guardar: persistir }) {
  const { vistaPrevia, confirmarToken } = req.body || {};
  const usuarioId = req.usuario.usuarioId;
  res.set("Cache-Control", "no-store");
  if (confirmarToken) {
    const p = tomar(confirmarToken, usuarioId);
    if (!p) return res.status(410).json({ error: "La vista previa venció. Generala de nuevo." });
    return res.json(await persistir(p));
  }
  const pngs = await generar();
  if (vistaPrevia) return res.json(guardar(pngs, usuarioId));
  return res.json(await persistir(pngs));
}

module.exports = { guardar, obtener, tomar, resolver, VENCE_MS, MAXIMO };
