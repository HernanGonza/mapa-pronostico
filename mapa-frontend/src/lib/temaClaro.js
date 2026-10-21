/** Corre `fn` con el tema claro puesto y después restituye el del usuario: lo que se captura para publicar o descargar sale siempre en claro. */
export async function conTemaClaro(fn) {
  const raiz = document.documentElement, previo = raiz.dataset.theme;
  if (previo === "light" || !previo) return fn();
  raiz.dataset.theme = "light";
  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return await fn();
  } finally { raiz.dataset.theme = previo; }
}
