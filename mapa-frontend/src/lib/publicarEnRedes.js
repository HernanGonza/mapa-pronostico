import * as api from "../api";
import { esc, lista } from "./ui";
import { asistente, opciones, leerOpciones } from "./pasos";

/**
 * Publicar una placa en redes como asistente paso a paso (lib/pasos.js):
 * formatos → destinos → epígrafe → revisión → resultado, todo en un mismo modal.
 * WhatsApp es un destino más: abre WhatsApp Web con el mensaje armado (no se puede adjuntar una imagen
 * por enlace, va el epígrafe y las URLs públicas de las placas) y lo envía la persona.
 */
const NOMBRE = { facebook: "Facebook", instagram: "Instagram", telegram: "Telegram", whatsapp: "WhatsApp Web", feed: "Feed", historias: "Historias" };
const MAX_INSTAGRAM = 2200;
const cuando = (iso) => new Date(iso).toLocaleString("es-AR");

function htmlResultados(resultados) {
  if (!resultados.length) return "";
  return `<ul class="paso-lista">${resultados.map((r) => `<li class="${r.ok ? "ok" : "fallo"}"><strong>${r.ok ? "✓" : "✗"} ${NOMBRE[r.destino]} · ${NOMBRE[r.formato]}</strong> — ${
    r.ok ? (r.permalink ? `<a href="${esc(r.permalink)}" target="_blank" rel="noreferrer">ver publicación</a>` : "publicado") : esc(r.error)}</li>`).join("")}</ul>`;
}

export async function publicarEnRedes({ feedUrl, historiasUrl, epigrafe = "" }) {
  let estado, previas = [];
  try { estado = await api.getRedesEstado(); }
  catch (e) { const { notificar } = await import("./ui"); notificar("error", e.message); return; }
  try { previas = (await api.getRedesPublicaciones(feedUrl, historiasUrl)).publicaciones; } catch { /* el aviso de duplicados es un extra */ }

  const abrirWhatsApp = (s) => {
    const enlaces = [s.formatos.includes("feed") && feedUrl, s.formatos.includes("historias") && historiasUrl].filter(Boolean);
    const params = new URLSearchParams({ text: [s.epigrafe.trim(), ...enlaces].filter(Boolean).join("\n\n") });
    if (estado.whatsappNumero) params.set("phone", estado.whatsappNumero);
    window.open(`https://web.whatsapp.com/send?${params}`, "_blank", "noopener");
  };

  async function enviar(s, forzar = false) {
    const delServidor = s.destinos.filter((d) => d !== "whatsapp");
    let resultados = [];
    if (delServidor.length) {
      try { resultados = (await api.publicarEnRedes({ feedUrl, historiasUrl, epigrafe: s.epigrafe, destinos: delServidor, formatos: s.formatos, forzar })).resultados; }
      catch (e) {
        if (!e.yaPublicado) throw e;
        return { tipo: "aviso", titulo: "Esta placa ya se publicó",
          html: `<p>Ya salió en: ${esc(e.yaPublicado.map((p) => `${NOMBRE[p.destino]} ${NOMBRE[p.formato].toLowerCase()} (${cuando(p.creadoEn)}${p.usuarioEmail ? `, ${p.usuarioEmail}` : ""})`).join(" · "))}.</p><p>¿Querés publicarla de nuevo?</p>`,
          accion: { texto: "Publicar de nuevo igualmente", alHacer: (x) => enviar(x, true) } };
      }
    }
    const conWhatsApp = s.destinos.includes("whatsapp");
    if (conWhatsApp) abrirWhatsApp(s);
    const fallos = resultados.filter((r) => !r.ok);
    return {
      tipo: fallos.length === 0 ? "ok" : fallos.length === resultados.length && !conWhatsApp ? "error" : "aviso",
      titulo: fallos.length === 0 ? "¡Listo!" : fallos.length === resultados.length ? "No se pudo publicar" : "Salió a medias",
      html: `${htmlResultados(resultados)}${conWhatsApp ? "<p>Se abrió WhatsApp Web con el mensaje: elegí el contacto o grupo y enviá.</p>" : ""}`,
      datos: resultados,
      accion: fallos.length ? { texto: "Reintentar lo que falló", alHacer: (x) => ({ volver: { ...x, destinos: [...new Set(fallos.map((f) => f.destino))], formatos: [...new Set(fallos.map((f) => f.formato))] } }) } : null,
    };
  }

  const pasos = [
    { pregunta: "¿Qué querés publicar?", ayuda: "Podés elegir los dos formatos.",
      html: (s) => opciones({ nombre: "formato", items: [
        { valor: "feed", titulo: "Feed", detalle: "Publicación cuadrada", img: feedUrl, marcada: s.formatos.includes("feed") },
        { valor: "historias", titulo: "Historias", detalle: "Vertical, sin texto", img: historiasUrl, marcada: s.formatos.includes("historias") }] }),
      leer: (popup) => ({ formatos: leerOpciones(popup, "formato") }),
      validar: (s) => (s.formatos.length ? null : "Elegí al menos un formato.") },
    { pregunta: "¿Dónde lo publicamos?", ayuda: "Facebook, Instagram y Telegram se publican desde acá. WhatsApp abre WhatsApp Web.",
      html: (s) => opciones({ nombre: "destino", items: [
        ...["facebook", "instagram", "telegram"].map((id) => ({ valor: id, titulo: NOMBRE[id], detalle: estado[id] ? "" : "Sin configurar en el servidor", deshabilitada: !estado[id], marcada: estado[id] && s.destinos.includes(id) })),
        { valor: "whatsapp", titulo: "WhatsApp Web", detalle: "Se abre con el mensaje; lo enviás vos", marcada: s.destinos.includes("whatsapp") }] }),
      leer: (popup) => ({ destinos: leerOpciones(popup, "destino") }),
      validar: (s) => (s.destinos.length ? null : "Elegí al menos un destino.") },
    { pregunta: "Escribí el epígrafe", ayuda: "Va junto al feed. Las historias no llevan texto.",
      omitir: (s) => !s.formatos.includes("feed") && !s.destinos.includes("whatsapp"),
      html: (s) => `<textarea class="paso-texto" id="paso-epigrafe" rows="6" data-foco>${esc(s.epigrafe)}</textarea><p class="paso-contador-texto" id="paso-contador"></p>`,
      alMostrar: (popup, s) => {
        const area = popup.querySelector("#paso-epigrafe"), cont = popup.querySelector("#paso-contador");
        const act = () => { const solo = s.destinos.includes("instagram"); cont.textContent = `${area.value.length} caracteres${solo ? ` · Instagram admite ${MAX_INSTAGRAM}` : ""}`; cont.classList.toggle("paso-contador-texto--excede", solo && area.value.length > MAX_INSTAGRAM); };
        area.addEventListener("input", act); act();
      },
      leer: (popup) => ({ epigrafe: popup.querySelector("#paso-epigrafe").value }),
      validar: (s) => (s.destinos.includes("instagram") && s.formatos.includes("feed") && s.epigrafe.length > MAX_INSTAGRAM ? `Instagram admite hasta ${MAX_INSTAGRAM} caracteres (tiene ${s.epigrafe.length}).` : null) },
    { pregunta: "Revisá y confirmá",
      html: (s) => `<dl class="paso-resumen">
          <div><dt>Formato</dt><dd>${esc(lista(s.formatos.map((f) => NOMBRE[f])))}</dd></div>
          <div><dt>Destino</dt><dd>${esc(lista(s.destinos.map((d) => NOMBRE[d])))}</dd></div>
          ${s.formatos.includes("feed") || s.destinos.includes("whatsapp") ? `<div><dt>Epígrafe</dt><dd class="paso-resumen__texto">${esc(s.epigrafe) || "<em>(vacío)</em>"}</dd></div>` : ""}
        </dl>
        ${previas.length ? `<p class="paso-aviso">Ya se publicó antes: ${esc(previas.map((p) => `${NOMBRE[p.destino]} ${NOMBRE[p.formato].toLowerCase()} (${cuando(p.creadoEn)})`).join(" · "))}.</p>` : ""}
        <p class="paso-nota">Desde el sistema no se puede deshacer: para borrar una publicación hay que hacerlo a mano en cada red.</p>` },
  ];

  await asistente({ pasos, enviar, textoEnviar: "Publicar", estado: { formatos: ["feed", "historias"], destinos: ["facebook", "instagram", "telegram"].filter((id) => estado[id]), epigrafe } });
}
