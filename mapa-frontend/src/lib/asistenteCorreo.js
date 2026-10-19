import { asistente, opciones, leerOpciones } from "./pasos";
import { esc } from "./ui";

/**
 * Asistentes del envío del pronóstico por correo (todo en un modal, paso a paso):
 *  - enviarPronosticoPorCorreo: destinatarios → asunto y mensaje → revisar → enviar (con el PDF del informe de la tarjeta).
 *  - editarDestinatariosPorPasos: editar la lista fija (agregar, cambiar, quitar) → revisar cambios → guardar.
 * El correo sale desde la casilla configurada en el servidor (Gmail o Microsoft 365), con los destinatarios en copia oculta.
 */
const MAX_ASUNTO = 200, MAX_CUERPO = 5000;
const RE_EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;
const CLAVE_MENSAJE = "correoPronostico.cuerpo"; // último mensaje usado, para no reescribirlo cada día

const fechaDMA = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const tamano = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const nombreDe = (d) => (d.nombre ? `${d.nombre} <${d.email}>` : d.email);

function leerGuardado(clave) {
  try { return localStorage.getItem(clave); } catch { return null; }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento: no pasa nada */ }
}

const cuerpoPorDefecto = (fecha, formato = "PDF") => `Buen día.

Les compartimos el pronóstico del tiempo para la provincia de Misiones del ${fechaDMA(fecha)}, en formato ${formato}.

Saludos cordiales,
Dirección General de Alerta Temprana
Ministerio de Ecología y Recursos Naturales Renovables de Misiones`;

// --- Enviar el pronóstico (el PDF lo arma el servidor con el informe de la tarjeta) -------------------------------

function pasoDestinatarios(lista) {
  return {
    pregunta: "¿A quiénes se manda?",
    ayuda: `Están marcados todos los de la lista (${lista.length}). Destildá a quien no quieras mandarle esta vez. Reciben el correo en copia oculta: nadie ve las direcciones de los demás. Para agregar o quitar direcciones de la lista, usá «Destinatarios del email».`,
    html: (s) => `<div class="paso-vigencia__rapidas" role="group" aria-label="Selección rápida" style="margin:0 0 10px">
        <button type="button" class="btn" data-todos="1">Marcar todos</button><button type="button" class="btn" data-todos="0">Ninguno</button></div>
      <div class="paso-lista-correo">${opciones({ nombre: "destinatario", items: lista.map((d) => ({ valor: String(d.id), titulo: d.nombre || d.email, detalle: d.nombre ? d.email : "", marcada: s.ids.includes(d.id) })) })}</div>`,
    alMostrar: (popup) => popup.querySelectorAll("[data-todos]").forEach((b) => b.addEventListener("click", () => {
      popup.querySelectorAll('input[name="destinatario"]').forEach((i) => { i.checked = b.dataset.todos === "1"; });
    })),
    leer: (popup) => ({ ids: leerOpciones(popup, "destinatario").map(Number) }),
    validar: (s) => (s.ids.length ? null : "Elegí al menos un destinatario."),
  };
}

const pasoMensaje = {
  pregunta: "Asunto y mensaje",
  ayuda: "Revisalos y cambiá lo que haga falta. El mensaje se recuerda para el próximo envío.",
  html: (s) => `<label class="paso-etiqueta">Asunto
      <input class="paso-input" id="paso-asunto" maxlength="${MAX_ASUNTO}" value="${esc(s.asunto)}" autocomplete="off" data-foco></label>
    <label class="paso-etiqueta" style="margin-top:12px">Mensaje
      <textarea class="paso-texto" id="paso-cuerpo" maxlength="${MAX_CUERPO}" rows="10">${esc(s.cuerpo)}</textarea></label>`,
  leer: (popup) => ({ asunto: popup.querySelector("#paso-asunto").value.trim(), cuerpo: popup.querySelector("#paso-cuerpo").value.trim() }),
  validar: (s) => (!s.asunto ? "Escribí el asunto." : !s.cuerpo ? "Escribí el mensaje." : null),
};

function pasoRevision(lista, estado) {
  return {
    pregunta: "Revisá antes de enviar",
    ayuda: estado.configurado ? "Al confirmar, el correo sale en el momento." : "",
    html: (s) => {
      const elegidos = lista.filter((d) => s.ids.includes(d.id));
      return `${estado.configurado ? "" : `<p class="paso__error" role="alert">El servidor todavía no tiene configurada la casilla de envío (GMAIL_USER y GMAIL_APP_PASSWORD, o los datos de Microsoft 365), así que no se puede enviar. Podés revisar todo igual.</p>`}
        <dl class="paso-resumen">
          <div><dt>De</dt><dd>${esc(estado.remitente || "alertatemprana@ecologia.misiones.gob.ar")}</dd></div>
          <div><dt>Para</dt><dd>${elegidos.length} destinatario${elegidos.length === 1 ? "" : "s"}, en copia oculta
            <details><summary>Ver lista</summary><p class="paso-resumen__texto">${elegidos.map((d) => esc(nombreDe(d))).join("<br>")}</p></details></dd></div>
          <div><dt>Asunto</dt><dd>${esc(s.asunto)}</dd></div>
          <div><dt>Adjunto</dt><dd>${esc(s.adjunto)} <small>(se arma con este informe)</small></dd></div>
          <div><dt>Mensaje</dt><dd class="paso-resumen__texto">${esc(s.cuerpo)}</dd></div>
        </dl>`;
    },
    validar: () => (estado.configurado ? null : "Falta configurar la casilla de envío en el servidor (Gmail o Microsoft 365): todavía no se puede enviar."),
  };
}

/**
 * fecha: "AAAA-MM-DD" del informe; estado: { configurado, remitente }; destinatarios: la lista fija [{ id, nombre, email }].
 * enviar({ asunto, cuerpo, ids }) → { enviados, remitente }. El PDF lo arma el servidor con el informe de la tarjeta.
 */
export function enviarPronosticoPorCorreo({ fecha, estado, destinatarios, enviar, word = false }) {
  const pasos = [pasoDestinatarios(destinatarios), pasoMensaje, pasoRevision(destinatarios, estado)];
  const inicial = {
    adjunto: `PREVISION DEL TIEMPO ${fecha}.${word ? "docx" : "pdf"}`,
    ids: destinatarios.map((d) => d.id),
    asunto: `Pronóstico del tiempo — ${fechaDMA(fecha)}`,
    // El mensaje recordado puede traer la fecha de otro día: se reemplaza por la de este informe.
    cuerpo: (leerGuardado(CLAVE_MENSAJE) || cuerpoPorDefecto(fecha, word ? "Word" : "PDF")).replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, fechaDMA(fecha)).replace(/en formato (PDF|Word)\./, `en formato ${word ? "Word" : "PDF"}.`),
  };
  return asistente({
    pasos, estado: inicial, textoEnviar: "Enviar", ancho: 760,
    enviar: async (s) => {
      const r = await enviar({ asunto: s.asunto, cuerpo: s.cuerpo, ids: s.ids });
      guardar(CLAVE_MENSAJE, s.cuerpo);
      return { tipo: "ok", titulo: "¡Enviado!", datos: r, html: `<p>El pronóstico salió desde ${esc(r.remitente || "la casilla de envío")} a ${r.enviados} destinatario${r.enviados === 1 ? "" : "s"}.</p>` };
    },
  });
}

// --- Editar la lista de destinatarios -----------------------------------------------------------

const filaHtml = (d = { nombre: "", email: "" }) => `<div class="correo-fila">
    <input class="paso-input" data-campo="nombre" placeholder="Nombre (opcional)" value="${esc(d.nombre)}" maxlength="120" autocomplete="off" aria-label="Nombre">
    <input class="paso-input" data-campo="email" type="email" placeholder="correo@ejemplo.com" value="${esc(d.email)}" maxlength="254" autocomplete="off" aria-label="Correo">
    <button type="button" class="btn btn--ghost" data-quitar aria-label="Quitar">✕</button>
  </div>`;

function leerFilas(popup) {
  return [...popup.querySelectorAll(".correo-fila")]
    .map((f) => ({ nombre: f.querySelector('[data-campo="nombre"]').value.trim(), email: f.querySelector('[data-campo="email"]').value.trim().toLowerCase() }))
    .filter((d) => d.nombre || d.email);
}

/** Direcciones sueltas pegadas de un mail: «Nombre <correo>, otro@correo, ...». */
function leerPegado(texto) {
  return texto.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean).map((t) => {
    const m = /^(.*?)\s*<([^>]+)>$/.exec(t);
    return m ? { nombre: m[1].replace(/^"|"$/g, "").trim(), email: m[2].trim().toLowerCase() } : { nombre: "", email: t.toLowerCase() };
  });
}

function diferencias(antes, despues) {
  const a = new Map(antes.map((d) => [d.email, d])), b = new Map(despues.map((d) => [d.email, d]));
  return {
    agregados: despues.filter((d) => !a.has(d.email)),
    quitados: antes.filter((d) => !b.has(d.email)),
    cambiados: despues.filter((d) => a.has(d.email) && a.get(d.email).nombre !== d.nombre),
  };
}

/** destinatarios: la lista actual; guardar(lista) → la lista guardada. */
export function editarDestinatariosPorPasos({ destinatarios, guardar: guardarLista }) {
  const original = destinatarios.map(({ nombre, email }) => ({ nombre, email }));
  const pasos = [
    {
      pregunta: "Destinatarios del email",
      ayuda: "Cambiá nombres o direcciones, quitá con ✕ o agregá nuevos. También podés pegar varias direcciones juntas, como vienen en un mail («Nombre <correo>, otro@correo»).",
      html: (s) => `<div class="correo-filas" id="correo-filas">${s.lista.map(filaHtml).join("")}</div>
        <div class="paso-vigencia__rapidas"><button type="button" class="btn" data-agregar>+ Agregar destinatario</button></div>
        <details class="correo-pegar"><summary>Pegar varias direcciones</summary>
          <textarea class="paso-texto" id="correo-pegado" rows="4" placeholder="Nombre <correo@ejemplo.com>, otro@ejemplo.com"></textarea>
          <button type="button" class="btn" data-pegar>Agregar a la lista</button></details>`,
      alMostrar: (popup) => {
        const cont = popup.querySelector("#correo-filas");
        cont.addEventListener("click", (e) => { if (e.target.closest("[data-quitar]")) e.target.closest(".correo-fila").remove(); });
        popup.querySelector("[data-agregar]").addEventListener("click", () => {
          cont.insertAdjacentHTML("beforeend", filaHtml());
          cont.lastElementChild.querySelector("input").focus();
        });
        popup.querySelector("[data-pegar]").addEventListener("click", () => {
          const area = popup.querySelector("#correo-pegado");
          const ya = new Set(leerFilas(popup).map((d) => d.email));
          leerPegado(area.value).filter((d) => !ya.has(d.email)).forEach((d) => cont.insertAdjacentHTML("beforeend", filaHtml(d)));
          area.value = "";
        });
      },
      leer: (popup) => ({ lista: leerFilas(popup) }),
      validar: (s) => {
        if (!s.lista.length) return "La lista no puede quedar vacía.";
        const vistos = new Set();
        for (const d of s.lista) {
          if (!RE_EMAIL.test(d.email)) return `«${d.email || d.nombre}» no es una dirección de correo válida.`;
          if (vistos.has(d.email)) return `«${d.email}» está repetida.`;
          vistos.add(d.email);
        }
        return null;
      },
    },
    {
      pregunta: "Revisá los cambios",
      html: (s) => {
        const { agregados, quitados, cambiados } = diferencias(original, s.lista);
        if (!agregados.length && !quitados.length && !cambiados.length) return "<p>No hay cambios en la lista.</p>";
        const bloque = (titulo, items) => (items.length ? `<p><strong>${titulo} (${items.length})</strong><br>${items.map((d) => esc(nombreDe(d))).join("<br>")}</p>` : "");
        return `${bloque("Se agregan", agregados)}${bloque("Se quitan", quitados)}${bloque("Cambia el nombre", cambiados)}<p>La lista queda con ${s.lista.length} destinatarios.</p>`;
      },
    },
  ];
  return asistente({
    pasos, estado: { lista: original }, textoEnviar: "Guardar la lista", ancho: 760,
    enviar: async (s) => {
      const lista = await guardarLista(s.lista);
      return { tipo: "ok", titulo: "Lista guardada", datos: lista, html: `<p>Quedaron ${lista.length} destinatarios.</p>` };
    },
  });
}
