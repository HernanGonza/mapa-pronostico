import { lazy } from "react";

/**
 * Como `lazy()` de React, pero aguanta que falle la descarga de la parte de la página.
 *
 * Cada pantalla se baja recién cuando se abre (un archivo de /assets por página). Si esa
 * descarga falla, React no tiene qué mostrar y la página queda EN BLANCO. Pasa sobre todo con
 * varios iframes del sitio a la vez (la página de Demostración, el sitio del ministerio, /tv):
 * Chrome a veces no puede leer su propia caché (net::ERR_CACHE_READ_FAILURE). También después
 * de un deploy, si quedó abierta una página vieja que pide archivos que ya no existen.
 *
 * Qué hace: reintenta 2 veces (con una espera distinta en cada iframe, para no pedir todos a
 * la vez) y, si sigue fallando, recarga la página UNA vez (no más de una por minuto, para no
 * quedar recargando en loop si el servidor está caído).
 */
const CLAVE = "alertaTemprana.recargaPorCarga";
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function recargarUnaVez() {
  try {
    const ultima = Number(sessionStorage.getItem(CLAVE) || 0);
    if (Date.now() - ultima < 60_000) return false;
    sessionStorage.setItem(CLAVE, String(Date.now()));
  } catch {
    return false; // sin almacenamiento no se puede evitar el loop: mejor no recargar
  }
  window.location.reload();
  return true;
}

export default function lazyConReintento(importar) {
  return lazy(async () => {
    for (let intento = 0; ; intento += 1) {
      try {
        return await importar();
      } catch (error) {
        if (intento < 2) { await esperar(600 + intento * 900 + Math.random() * 600); continue; }
        if (recargarUnaVez()) return new Promise(() => {}); // se está recargando: que no muestre el error
        throw error;
      }
    }
  });
}
