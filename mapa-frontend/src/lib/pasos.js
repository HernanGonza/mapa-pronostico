import { esc } from "./ui";

/**
 * Asistente paso a paso ("tipo Typeform") sobre un único modal SweetAlert2: una pregunta por pantalla,
 * barra de progreso, "Atrás", Enter para avanzar y una animación de entrada en cada paso. Se carga
 * recién al usarlo. El modal no se cierra entre pasos: se actualiza su contenido (Swal.update), por
 * eso no parpadea. El último paso ejecuta `enviar(estado)` y muestra su resultado en el mismo modal.
 *
 *  pasos[]: { pregunta, ayuda?, html(estado), leer?(popup, estado) → {campos}, validar?(estado) → error|null,
 *             alMostrar?(popup, estado), omitir?(estado) → boolean }
 *  enviar(estado) → { tipo: "ok"|"aviso"|"error", titulo, html, datos?, accion?: { texto, alHacer(estado) } }
 *      alHacer devuelve otro resultado, `{ volver: nuevoEstado }` (vuelve a los pasos) o `{ cerrar: true, luego }`.
 * Devuelve `{ datos }` del último resultado (o null si se cerró antes de terminar).
 */
const CLASES = { popup: "swal-eco swal-eco--asistente", title: "swal-eco__titulo", confirmButton: "btn btn--primary", cancelButton: "btn btn--ghost", denyButton: "btn btn--ghost", actions: "swal-eco__acciones", closeButton: "swal-eco__cerrar" };

/** Opciones grandes elegibles (checkbox o radio), con detalle e imagen opcionales. */
export function opciones({ nombre, tipo = "checkbox", items }) {
  return `<div class="paso-opciones">${items.map((o) => `<label class="paso-opcion ${o.deshabilitada ? "paso-opcion--off" : ""}">
    <input type="${tipo}" name="${esc(nombre)}" value="${esc(o.valor)}" ${o.marcada ? "checked" : ""} ${o.deshabilitada ? "disabled" : ""}>
    <span class="paso-opcion__caja">${o.img ? `<img src="${esc(o.img)}" alt="">` : ""}<strong>${esc(o.titulo)}</strong>${o.detalle ? `<small>${esc(o.detalle)}</small>` : ""}</span></label>`).join("")}</div>`;
}
export function leerOpciones(popup, nombre) {
  return [...popup.querySelectorAll(`input[name="${nombre}"]:checked`)].map((i) => i.value);
}

export async function asistente({ pasos, estado: inicial = {}, enviar, textoEnviar = "Publicar", ancho = 680 }) {
  const { default: Swal } = await import("sweetalert2");
  let estado = { ...inicial }, idx = 0, fase = "pasos", accion = null, datos = null, luego = null, previo = 0;
  const visibles = () => pasos.filter((p) => !p.omitir?.(estado));

  function cuerpo(retroceso) {
    const L = visibles(), p = L[idx], n = idx + 1, pct = (n / L.length) * 100;
    const html = `<div class="paso-cabecera"><div class="paso-barra" role="progressbar" aria-label="Progreso" aria-valuemin="0" aria-valuemax="${L.length}" aria-valuenow="${n}"><i style="--desde:${previo}%;--p:${pct}%"></i></div><span class="paso-contador">Paso ${n} de ${L.length}</span></div>
      <div class="paso ${retroceso ? "paso--atras" : ""}">${p.ayuda ? `<p class="paso__ayuda">${p.ayuda}</p>` : ""}${p.html(estado)}</div>`;
    previo = pct;
    return { p, L, html };
  }
  const activar = (p) => {
    const popup = Swal.getPopup();
    p.alMostrar?.(popup, estado);
    (popup.querySelector("[data-foco]") || popup.querySelector("textarea, input:not([type=checkbox]):not([type=radio])") || popup.querySelector("input:checked, input:not([disabled])"))?.focus();
  };
  function mostrar(retroceso) {
    const { p, L, html } = cuerpo(retroceso);
    Swal.resetValidationMessage();
    Swal.update({ title: p.pregunta, html, confirmButtonText: idx === L.length - 1 ? textoEnviar : "Siguiente →", showDenyButton: idx > 0, denyButtonText: "← Atrás", showCloseButton: true });
    activar(p);
  }
  function mostrarResultado(r) {
    fase = "resultado"; accion = r.accion || null;
    if (r.datos !== undefined) datos = r.datos;
    Swal.update({ title: r.titulo, html: `<div class="paso paso--resultado paso--${r.tipo || "ok"}"><div class="paso__sello" aria-hidden="true">${{ ok: "✓", aviso: "!", error: "✗" }[r.tipo || "ok"]}</div>${r.html}</div>`,
      confirmButtonText: "Listo", showDenyButton: !!accion, denyButtonText: accion?.texto, showCloseButton: true });
  }
  async function ejecutar(fn) {
    Swal.update({ showDenyButton: false, showCloseButton: false });
    Swal.showLoading();
    let r;
    try { r = await fn(); } catch (e) { r = { tipo: "error", titulo: "No se pudo completar", html: `<p>${esc(e.message)}</p>`, accion: { texto: "← Volver", alHacer: (s) => ({ volver: s }) } }; }
    Swal.hideLoading();
    if (r?.volver) { estado = r.volver; fase = "pasos"; idx = visibles().length - 1; mostrar(true); return false; }
    // Cerrar desde un callback (preConfirm/preDeny) NO se hace con Swal.close(): deja la promesa colgada.
    // Se devuelve `true` y SweetAlert2 cierra solo.
    if (r?.cerrar) { luego = r.luego; return true; }
    mostrarResultado(r);
    return false;
  }

  const primero = cuerpo(false);
  // Encadenar otro modal (`luego`) recién cuando éste terminó de cerrarse: si no, SweetAlert2 barre el nuevo.
  let cerrado; const alCerrar = new Promise((r) => { cerrado = r; });
  await Swal.fire({
    didClose: () => cerrado(),
    title: primero.p.pregunta, html: primero.html, width: ancho, buttonsStyling: false, customClass: CLASES, reverseButtons: true, focusConfirm: false,
    confirmButtonText: primero.L.length === 1 ? textoEnviar : "Siguiente →", denyButtonText: "← Atrás", showDenyButton: false, showCloseButton: true,
    allowOutsideClick: false, allowEscapeKey: () => !Swal.isLoading(),
    didOpen: (popup) => {
      popup.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
        const t = e.target;
        if (t.tagName === "BUTTON" || t.tagName === "A" || (t.tagName === "TEXTAREA" && !(e.ctrlKey || e.metaKey))) return;
        e.preventDefault(); Swal.clickConfirm();
      });
      activar(primero.p);
    },
    preConfirm: async () => {
      if (fase === "resultado") return true;
      const L = visibles(), p = L[idx];
      const nuevo = { ...estado, ...(p.leer ? p.leer(Swal.getPopup(), estado) : {}) };
      const error = p.validar?.(nuevo);
      if (error) { Swal.showValidationMessage(error); return false; }
      estado = nuevo;
      if (idx < L.length - 1) { idx++; mostrar(false); return false; }
      return await ejecutar(() => enviar(estado));
    },
    preDeny: async () => {
      if (fase === "resultado" && accion) { const a = accion; return await ejecutar(() => a.alHacer(estado)); }
      if (idx > 0) { idx--; mostrar(true); }
      return false;
    },
  });
  await alCerrar;
  if (luego) await luego();
  return datos === null ? null : { datos };
}
