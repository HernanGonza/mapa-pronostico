import { esc } from "./ui";
import { API_URL } from "../config";

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
    Swal.getConfirmButton().disabled = false; // un paso anterior (vista previa) pudo dejarlo deshabilitado
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

// ===================================================================================================
// Piezas compartidas por los asistentes que crean placas
// ===================================================================================================

/** Las vistas previas vienen con una URL relativa del propio backend (/api/placas/pendientes/…). */
export const urlPlaca = (u) => (typeof u === "string" && u.startsWith("/api/") ? `${API_URL}${u}` : u);

export const ICONOS_TEXTO = [["⚠️", "Advertencia"], ["⛈️", "Tormenta"], ["🌧️", "Lluvia"], ["💨", "Viento"], ["🏠", "Casa"], ["🚫", "Prohibido"], ["✅", "Recomendación"], ["📞", "Teléfono"], ["🔌", "Electricidad"]];

/** Área de texto con contador y botones para insertar íconos donde está el cursor. */
export function htmlAreaConIconos({ id, valor = "", max = 2400, placeholder = "", filas = 7 }) {
  return `<textarea class="paso-texto" id="${id}" maxlength="${max}" rows="${filas}" placeholder="${esc(placeholder)}" data-foco>${esc(valor)}</textarea>
    <p class="paso-contador-texto" id="${id}-contador"></p>
    <div class="paso-iconos" role="group" aria-label="Insertar ícono en el texto">${ICONOS_TEXTO.map(([i, n]) => `<button type="button" data-icono="${i}" aria-label="Insertar ${n}" title="${n}">${i}</button>`).join("")}</div>`;
}
export function activarAreaConIconos(popup, id, max = 2400) {
  const area = popup.querySelector(`#${id}`), cont = popup.querySelector(`#${id}-contador`);
  const act = () => { cont.textContent = `${area.value.length}/${max} caracteres`; };
  area.addEventListener("input", act); act();
  popup.querySelector(".paso-iconos").addEventListener("click", (e) => {
    const icono = e.target.closest("[data-icono]")?.dataset.icono;
    if (!icono) return;
    const ini = area.selectionStart ?? area.value.length, fin = area.selectionEnd ?? ini;
    const nuevo = area.value.slice(0, ini) + icono + area.value.slice(fin);
    if (nuevo.length > max) return;
    area.value = nuevo; area.focus(); area.setSelectionRange(ini + icono.length, ini + icono.length); act();
  });
}

const ICONO_PANTALLA_COMPLETA = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
const nombreDe = { feed: "Feed", historias: "Historias" };

/**
 * Paso "vista previa": genera la placa (sin guardarla), la muestra con un cuadradito para verla en pantalla
 * completa (API Fullscreen del navegador) y deja confirmar. Si la persona vuelve y cambia algo, se regenera.
 *  clave(estado)   → texto que cambia cuando cambia lo que se ve en la placa.
 *  generar(estado) → Promise<{ token, feedUrl, historiasUrl }> (URLs de vista previa).
 * Deja en el estado: `vista` (lo devuelto por generar) y `vistaClave`.
 */
export function pasoVistaPrevia({ pregunta = "Así queda la placa", ayuda = "Revisala y, si está bien, confirmá para generarla.", clave, generar }) {
  return {
    pregunta, ayuda,
    html: () => `<div class="paso-previa"><p class="paso-previa__cargando" role="status"><span class="paso-previa__spinner" aria-hidden="true"></span>Generando la vista previa…</p><div class="paso-previa__grid" hidden></div></div>`,
    alMostrar: async (popup, estado) => {
      const caja = popup.querySelector(".paso-previa"), cargando = caja.querySelector(".paso-previa__cargando"), grid = caja.querySelector(".paso-previa__grid");
      const boton = Swal_getConfirm(popup);
      const mostrar = (vista) => {
        cargando.hidden = true; grid.hidden = false;
        grid.innerHTML = ["feed", "historias"].map((f) => `<figure><div class="paso-previa__marco"><img src="${esc(urlPlaca(vista[`${f}Url`]))}" alt="Vista previa ${nombreDe[f]}"><button type="button" class="paso-previa__pantalla" data-pantalla aria-label="Ver ${nombreDe[f].toLowerCase()} en pantalla completa" title="Pantalla completa">${ICONO_PANTALLA_COMPLETA}</button></div><figcaption>${nombreDe[f]}</figcaption></figure>`).join("");
        grid.addEventListener("click", (e) => { e.target.closest("[data-pantalla]")?.closest(".paso-previa__marco")?.querySelector("img")?.requestFullscreen?.().catch(() => {}); });
        if (boton) boton.disabled = false;
      };
      const k = clave(estado);
      if (estado.vista && estado.vistaClave === k) { mostrar(estado.vista); return; }
      if (boton) boton.disabled = true;
      estado.vista = null; estado.vistaClave = null;
      try {
        const vista = await generar(estado);
        if (!popup.contains(caja)) return; // la persona ya salió de este paso
        estado.vista = vista; estado.vistaClave = k; mostrar(vista);
      } catch (e) {
        if (!popup.contains(caja)) return;
        cargando.innerHTML = `<span class="paso-previa__error">✗ ${esc(e.message)}</span> Volvé al paso anterior y probá de nuevo.`;
      }
    },
    validar: (s) => (s.vista && s.vistaClave === clave(s) ? null : "Esperá a que termine la vista previa."),
  };
}
const Swal_getConfirm = (popup) => popup.querySelector(".swal2-confirm");

/** Resultado de crear una placa: miniaturas y descarga de cada formato. */
export function htmlPlacaLista(placa) {
  const descarga = (url, nombre, etiqueta) => `<a class="btn" href="${esc(url)}?download=${encodeURIComponent(nombre || "placa.png")}">${etiqueta}</a>`;
  return `<div class="paso-miniaturas"><img src="${esc(placa.feedUrl)}" alt="Placa de feed"><img src="${esc(placa.historiasUrl)}" alt="Placa de historias"></div>
    <div class="paso-descargas">${descarga(placa.feedUrl, placa.feedNombre, "Descargar feed")}${descarga(placa.historiasUrl, placa.historiasNombre, "Descargar historias")}</div>`;
}
