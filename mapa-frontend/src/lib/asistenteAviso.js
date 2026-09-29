import { opciones, leerOpciones, asistente, htmlAreaConIconos, activarAreaConIconos, pasoVistaPrevia, htmlPlacaLista } from "./pasos";
import { esc } from "./ui";

/**
 * Crear la placa de un aviso a muy corto plazo, paso a paso y todo dentro de un modal:
 * elegir aviso del SMN (o "dibujar a mano") → fondo → texto (con íconos) → vista previa
 * (pantalla completa) → confirmar y generar → placa lista. El título es siempre "Aviso a
 * muy corto plazo" (ya viene impreso en el fondo), no es un paso del asistente.
 * La página aporta:
 *   avisos: [{ id, titulo, zona, fin, poligono, texto }]  candidatos vigentes del RSS/CAP del SMN
 *   puntosDibujados: puntos ya dibujados a mano en el mapa de la página (fallback sin RSS)
 *   publicados: avisos vigentes en el mapa público ({ smnId, poligono, vigenteHasta }): los del SMN
 *               que ya están publicados salen desactivados, para reconocerlos a simple vista
 *   onSeleccionarPoligono(poligono) → refleja la elección en el mapa de la página (para la captura)
 *   vistaPrevia(valores) → { token, feedUrl, historiasUrl }   (genera sin guardar)
 *   guardar(valores, token, { finSmn }) → la placa guardada (finSmn: hasta cuándo rige el aviso del SMN elegido)
 *   publicar(placa, finSmn) → abre publicarAvisoPorPasos (desde la placa lista, «Publicar en el mapa público»)
 */
const MAX_TEXTO = 2400;
const FONDOS = { tormenta: ["Tormenta", "Cielo oscuro, para alertas de tormenta"], nubes: ["Nubes", "Fondo claro con nubes"] };
export const TITULO = "Aviso a muy corto plazo";
const valoresDe = (s) => ({ texto: s.texto, fondo: s.fondo, poligono: s.poligono, smnId: s.avisoId && s.avisoId !== "manual" ? s.avisoId : null });

const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** El publicado que corresponde a este aviso del SMN, si lo hay. Los publicados antes de guardar
 * `smnId` se reconocen por el polígono, que se guarda tal cual vino del SMN. */
function publicadoDe(aviso, publicados) {
  const poligono = JSON.stringify(aviso.poligono);
  return publicados.find((p) => (p.smnId ? p.smnId === aviso.id : JSON.stringify(p.poligono) === poligono));
}

function pasoElegirAviso({ avisos, puntosDibujados, onSeleccionarPoligono, publicados }) {
  const hayDibujo = puntosDibujados.length >= 3;
  const items = [
    ...avisos.map((a) => {
      const pub = publicadoDe(a, publicados);
      return pub
        ? { valor: a.id, titulo: a.titulo, detalle: `${a.zona} · Ya publicado en el mapa público, vigente hasta ${fechaHora(pub.vigenteHasta)}`, deshabilitada: true }
        : { valor: a.id, titulo: a.titulo, detalle: `${a.zona} · vigente hasta ${fechaHora(a.fin)}` };
    }),
    { valor: "manual", titulo: "Dibujar el área a mano", detalle: hayDibujo ? "Se usa lo que ya dibujaste en el mapa." : "Todavía no dibujaste nada — cerrá este asistente y dibujá el área en el mapa primero.", deshabilitada: !hayDibujo },
  ];
  return {
    pregunta: "¿Qué aviso del SMN publicamos?",
    ayuda: "Llegan por RSS del SMN; a veces hay más de uno vigente al mismo tiempo. Elegí cuál se convierte en placa.",
    omitir: () => avisos.length === 0,
    html: (s) => opciones({ nombre: "aviso", tipo: "radio", items: items.map((it) => ({ ...it, marcada: !it.deshabilitada && s.avisoId === it.valor })) }),
    leer: (popup) => {
      const elegido = leerOpciones(popup, "aviso")[0];
      if (elegido === "manual") return { avisoId: "manual", poligono: puntosDibujados, finSmn: null };
      const aviso = avisos.find((a) => a.id === elegido);
      if (!aviso) return { avisoId: null, poligono: [] };
      onSeleccionarPoligono(aviso.poligono);
      return { avisoId: aviso.id, poligono: aviso.poligono, texto: aviso.texto, finSmn: aviso.fin };
    },
    validar: (s) => (Array.isArray(s.poligono) && s.poligono.length >= 3 ? null : "Elegí un aviso o dibujá el área a mano."),
  };
}

export function crearAvisoPorPasos({ inicial, avisos, puntosDibujados, onSeleccionarPoligono, publicados = [], vistaPrevia, guardar, publicar }) {
  const pasos = [
    pasoElegirAviso({ avisos, puntosDibujados, onSeleccionarPoligono, publicados }),
    { pregunta: "¿Qué fondo le ponemos?",
      html: (s) => opciones({ nombre: "fondo", tipo: "radio", items: Object.entries(FONDOS).map(([valor, [titulo, detalle]]) => ({ valor, titulo, detalle, marcada: s.fondo === valor })) }),
      leer: (popup) => ({ fondo: leerOpciones(popup, "fondo")[0] || "tormenta" }) },
    { pregunta: "Escribí el aviso", ayuda: `Se sugiere el texto del SMN — revisalo y ajustalo si hace falta. Hasta ${MAX_TEXTO} caracteres. Podés sumar íconos.`,
      html: (s) => htmlAreaConIconos({ id: "paso-texto", valor: s.texto, max: MAX_TEXTO, placeholder: "Escribí acá el aviso a muy corto plazo…" }),
      alMostrar: (popup) => activarAreaConIconos(popup, "paso-texto", MAX_TEXTO),
      leer: (popup) => ({ texto: popup.querySelector("#paso-texto").value }),
      validar: (s) => (s.texto.trim() ? null : "Escribí el texto del aviso.") },
    pasoVistaPrevia({ clave: (s) => JSON.stringify(valoresDe(s)), generar: (s) => vistaPrevia(valoresDe(s)) }),
  ];

  const enviar = async (s) => {
    const placa = await guardar(valoresDe(s), s.vista.token, { finSmn: s.finSmn || null });
    return {
      tipo: "ok", titulo: "¡La placa está lista!", datos: placa,
      html: `${htmlPlacaLista(placa)}<p>Todavía no está en el mapa público. Para redes, usá «Publicar en redes» en la vista de la placa.</p>`,
      accion: placa.id != null ? { texto: "Publicar en el mapa público", alHacer: () => ({ cerrar: true, luego: () => publicar(placa, s.finSmn || null) }) } : null,
    };
  };

  return asistente({ pasos, enviar, textoEnviar: "Confirmar y generar", estado: inicial, ancho: 760 });
}

// --- Publicar en el mapa público, con vigencia ---

const HORA = 3600 * 1000;
const RAPIDAS = [1, 2, 3, 6];
/** Date → "AAAA-MM-DDTHH:mm" en hora local, el formato de <input type="datetime-local">. */
function valorLocal(d) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}
/** Redondea hacia arriba a los 5 minutos, para que la sugerencia no quede en 14:37. */
const redondear = (ms) => Math.ceil(ms / (5 * 60 * 1000)) * 5 * 60 * 1000;

/**
 * Publicar un aviso ya generado en el mapa público, con hasta cuándo rige: pasada esa hora se
 * despublica solo. Sugiere el fin del aviso del SMN si lo hay; si no, dentro de 2 horas.
 *   aviso: { id, feedUrl }   finSmn: ISO o null   vigenteHasta: ISO actual (republicar) o null
 *   publicar(id, vigenteHastaIso) → el aviso publicado
 */
export function publicarAvisoPorPasos({ aviso, finSmn = null, vigenteHasta = null, publicar }) {
  const ahora = Date.now();
  const sugerida = [vigenteHasta, finSmn].map((f) => Date.parse(f)).find((t) => t > ahora) || redondear(ahora + 2 * HORA);
  const pasos = [{
    pregunta: "¿Hasta cuándo está vigente?",
    ayuda: `Pasada esa hora, el aviso deja de mostrarse solo en el mapa público.${finSmn ? " Se sugiere la hora de fin del aviso del SMN." : ""}`,
    html: (s) => `<div class="paso-vigencia">
        ${aviso.feedUrl ? `<img class="paso-vigencia__placa" src="${esc(aviso.feedUrl)}" alt="Placa del aviso">` : ""}
        <div>
          <label class="paso-etiqueta">Vigente hasta<input type="datetime-local" class="paso-input" id="paso-vigencia" value="${esc(s.vigencia)}" min="${esc(valorLocal(new Date()))}" data-foco></label>
          <div class="paso-vigencia__rapidas" role="group" aria-label="Atajos">${RAPIDAS.map((h) => `<button type="button" class="btn" data-horas="${h}">+${h} h</button>`).join("")}${finSmn ? `<button type="button" class="btn" data-smn>Fin del SMN</button>` : ""}</div>
        </div>
      </div>`,
    alMostrar: (popup) => {
      const campo = popup.querySelector("#paso-vigencia");
      popup.querySelectorAll("[data-horas]").forEach((b) => b.addEventListener("click", () => { campo.value = valorLocal(new Date(redondear(Date.now() + Number(b.dataset.horas) * HORA))); }));
      popup.querySelector("[data-smn]")?.addEventListener("click", () => { campo.value = valorLocal(new Date(finSmn)); });
    },
    leer: (popup) => ({ vigencia: popup.querySelector("#paso-vigencia").value }),
    validar: (s) => {
      const t = new Date(s.vigencia).getTime();
      if (!s.vigencia || Number.isNaN(t)) return "Elegí la fecha y la hora.";
      if (t <= Date.now()) return "Tiene que ser una fecha y hora futura.";
      if (t > Date.now() + 72 * HORA) return "La vigencia no puede superar las 72 horas.";
      return null;
    },
  }];
  const enviar = async (s) => {
    const publicado = await publicar(aviso.id, new Date(s.vigencia).toISOString());
    return { tipo: "ok", titulo: "¡Publicado!", datos: publicado, html: `<p>El mapa público muestra el aviso hasta el ${esc(fechaHora(publicado.vigenteHasta))}. Después se saca solo.</p>` };
  };
  return asistente({ pasos, enviar, textoEnviar: "Publicar en el mapa público", estado: { vigencia: valorLocal(new Date(sugerida)) } });
}
