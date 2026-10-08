/**
 * Avisos y confirmaciones del sistema. Ambas librerías se cargan recién
 * cuando se usan por primera vez (import dinámico): no pesan en la carga
 * inicial de ninguna pantalla.
 *
 *  - notificar(): toast no bloqueante (Notyf, ~3 kB).
 *  - confirmar(): diálogo de confirmación accesible (SweetAlert2), para
 *    acciones que no se pueden deshacer desde el sistema.
 */
let notyf;
async function obtenerNotyf() {
  if (!notyf) {
    const [{ Notyf }] = await Promise.all([import("notyf"), import("notyf/notyf.min.css")]);
    notyf = new Notyf({
      duration: 4500,
      dismissible: true,
      ripple: false,
      position: { x: "right", y: "bottom" },
      types: [
        { type: "success", className: "toast-eco toast-eco--ok", icon: false },
        { type: "error", className: "toast-eco toast-eco--error", icon: false, duration: 8000 },
        { type: "info", className: "toast-eco toast-eco--info", icon: false },
      ],
    });
  }
  return notyf;
}

/** tipo: "success" | "error" | "info" */
export async function notificar(tipo, mensaje) {
  if (!mensaje) return;
  try { (await obtenerNotyf())[tipo === "info" ? "open" : tipo](tipo === "info" ? { type: "info", message: mensaje } : mensaje); }
  catch { /* un toast que falla nunca debe romper la pantalla */ }
}

/** Devuelve true si la persona confirma. `peligro` marca una acción destructiva o irreversible. */
// `target`: elemento donde montar el diálogo. Hace falta si se llama desde adentro de un <dialog> modal
// (queda en la capa superior del navegador y taparía cualquier cosa fuera de él).
export async function confirmar({ titulo, texto, html, confirmar = "Confirmar", cancelar = "Cancelar", peligro = false, target }) {
  const { default: Swal } = await import("sweetalert2");
  const r = await Swal.fire({
    title: titulo, text: html ? undefined : texto, html,
    icon: peligro ? "warning" : "question", target: target || undefined,
    showCancelButton: true, confirmButtonText: confirmar, cancelButtonText: cancelar,
    reverseButtons: true, focusCancel: peligro, buttonsStyling: false,
    customClass: { popup: "swal-eco", title: "swal-eco__titulo", confirmButton: "btn btn--primary", cancelButton: "btn btn--ghost", actions: "swal-eco__acciones" },
  });
  return r.isConfirmed;
}

/** Pide una línea de texto. Devuelve el texto (recortado) o null si cancela. */
export async function pedirTexto({ titulo, texto, valor = "", maxlength = 160, confirmar = "Guardar", cancelar = "Cancelar" }) {
  const { default: Swal } = await import("sweetalert2");
  const r = await Swal.fire({
    title: titulo, text: texto, input: "text", inputValue: valor, inputAttributes: { maxlength, autocomplete: "off" },
    inputValidator: (v) => (v.trim() ? null : "Escribí algo."),
    showCancelButton: true, confirmButtonText: confirmar, cancelButtonText: cancelar,
    reverseButtons: true, buttonsStyling: false,
    customClass: { popup: "swal-eco", title: "swal-eco__titulo", input: "paso-input", confirmButton: "btn btn--primary", cancelButton: "btn btn--ghost", actions: "swal-eco__acciones" },
  });
  return r.isConfirmed ? r.value.trim() : null;
}

/** Pide varios textos a la vez. `campos`: [{ clave, etiqueta, valor }]. Devuelve { clave: texto } o null si cancela. */
export async function pedirCampos({ titulo, texto, campos, maxlength = 160, confirmar = "Guardar", cancelar = "Cancelar" }) {
  const { default: Swal } = await import("sweetalert2");
  const r = await Swal.fire({
    title: titulo, buttonsStyling: false, reverseButtons: true, showCancelButton: true, confirmButtonText: confirmar, cancelButtonText: cancelar,
    html: `${texto ? `<p>${esc(texto)}</p>` : ""}${campos.map((c, i) => `<label class="paso-etiqueta" style="display:block;text-align:left;margin-top:10px">${esc(c.etiqueta)}<input class="paso-input" data-campo="${i}" maxlength="${maxlength}" value="${esc(c.valor)}" autocomplete="off"></label>`).join("")}`,
    preConfirm: () => Object.fromEntries(campos.map((c, i) => [c.clave, document.querySelector(`.swal2-html-container [data-campo="${i}"]`).value.trim()])),
    customClass: { popup: "swal-eco", title: "swal-eco__titulo", confirmButton: "btn btn--primary", cancelButton: "btn btn--ghost", actions: "swal-eco__acciones" },
  });
  return r.isConfirmed ? r.value : null;
}

// --- Utilidades compartidas por los modales ---
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const lista = (items) => new Intl.ListFormat("es", { style: "long", type: "conjunction" }).format(items);
