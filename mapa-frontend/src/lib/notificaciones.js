import { useSyncExternalStore } from "react";
import { getNotificaciones, marcarNotificacionesLeidas } from "../api";

/**
 * Notificaciones del panel, compartidas por la campanita de la cabecera y los números de las tarjetas: una sola
 * consulta cada CADA_MS mientras haya algo en pantalla que las use (ver mapa-backend/src/lib/notificacionesStore.js).
 */
const CADA_MS = 60 * 1000;
const VACIO = { notificaciones: [], nuevas: 0, nuevasPorTipo: {} };
let estado = VACIO, timer = null, enCurso = false;
const oyentes = new Set();
const emitir = () => oyentes.forEach((f) => f());

export async function recargar() {
  if (enCurso) return;
  enCurso = true;
  try { estado = await getNotificaciones(); emitir(); }
  catch { /* sin sesión o sin conexión: queda lo último */ }
  finally { enCurso = false; }
}

function suscribir(f) {
  oyentes.add(f);
  if (oyentes.size === 1) { recargar(); timer = setInterval(recargar, CADA_MS); }
  return () => { oyentes.delete(f); if (!oyentes.size) { clearInterval(timer); timer = null; } };
}

export const useNotificaciones = () => useSyncExternalStore(suscribir, () => estado);

/** Marca como leídas ({ ids } | { tipo } | { todas }) y actualiza al instante, sin esperar la próxima consulta. */
export async function marcarLeidas(cuerpo) {
  const esLeida = (n) => cuerpo.todas || (cuerpo.tipo && n.tipo === cuerpo.tipo) || cuerpo.ids?.includes(n.id);
  const notificaciones = estado.notificaciones.map((n) => (esLeida(n) ? { ...n, leida: true } : n));
  const sinLeer = notificaciones.filter((n) => !n.leida && !n.vencida && !n.resuelta);
  const nuevasPorTipo = {};
  for (const n of sinLeer) nuevasPorTipo[n.tipo] = (nuevasPorTipo[n.tipo] || 0) + 1;
  estado = { notificaciones, nuevas: sinLeer.length, nuevasPorTipo };
  emitir();
  try { await marcarNotificacionesLeidas(cuerpo); } finally { recargar(); }
}
