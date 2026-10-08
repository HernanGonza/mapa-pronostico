import { opciones, leerOpciones, asistente, pasoVistaPrevia, htmlPlacaLista } from "./pasos";
import { esc } from "./ui";

/**
 * Crear la placa de un aviso a muy corto plazo, paso a paso y todo dentro de un modal:
 * elegir aviso del SMN (o "dibujar a mano") → fondo → fenómeno → emisión → validez → zonas → vista previa
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
const FONDOS = { tormenta: ["Tormenta", "Cielo oscuro, para alertas de tormenta"], nubes: ["Nubes", "Fondo claro con nubes"] };
export const TITULO = "Aviso a muy corto plazo";
const valoresDe = (s) => ({ partes: partesDe(s), fondo: s.fondo, poligono: s.poligono, smnId: s.avisoId && s.avisoId !== "manual" ? s.avisoId : null });
const partesDe = (s) => ({ fenomeno: s.fenomeno, emision: s.emision, validez: s.validez, zonas: s.zonas });
/** El texto completo del aviso por partes, igual al que arma el backend (textoDePartes). */
export function textoDePartes({ fenomeno, emision, validez, zonas }) {
  const [f, h] = emision.split("T"), [a, m, d] = f.split("-");
  return [fenomeno.toLocaleUpperCase("es-AR"), `${d}/${m}/${a} a las ${h}hs`, `Validez hasta: ${validez}`, zonas].filter(Boolean).join("\n");
}

// --- Textos del aviso por partes (cada una en su paso), sugeridos desde el aviso del SMN ---

const NUMEROS = ["", "Una", "Dos", "Tres", "Cuatro", "Cinco", "Seis"];
/** "Una (1) hora desde la emisión", "Dos (2) horas desde la emisión"… */
export const validezEnHoras = (h) => `${NUMEROS[h] || h} (${h}) ${h === 1 ? "hora" : "horas"} desde la emisión`;
// El SMN escribe en mayúsculas y sin tildes: se corrigen las palabras de siempre.
const TILDES = { RAFAGA: "RÁFAGA", RAFAGAS: "RÁFAGAS", CAIDA: "CAÍDA", ELECTRICA: "ELÉCTRICA", ELECTRICAS: "ELÉCTRICAS", PRECIPITACION: "PRECIPITACIÓN", PRECIPITACIONES: "PRECIPITACIONES", AREA: "ÁREA", AREAS: "ÁREAS", RAPIDA: "RÁPIDA", RAPIDAS: "RÁPIDAS", ACUMULACION: "ACUMULACIÓN" };
export const conTildes = (t) => String(t || "").replace(/[A-ZÑ]+/g, (w) => TILDES[w] || w);
const normalizar = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\bgral\b\.?/g, "general").replace(/[.\s]+/g, " ").trim();
const tituloPropio = (t) => t.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/\bDe\b/g, "de");
/**
 * Departamentos de Misiones de un área del SMN ("CORRIENTES: ITUZAINGO - SANTO TOME. MISIONES:
 * APOSTOLES - CANDELARIA - LEANDRO N.  ALEM"), con el nombre bien escrito si está en `departamentos`.
 */
export function zonasDeMisiones(area, departamentos = []) {
  const partes = String(area || "").split(/(?:^|\.\s+)([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]+):\s*/);
  let lista = null;
  for (let i = 1; i < partes.length; i += 2) if (/misiones/i.test(partes[i])) lista = partes[i + 1];
  if (lista == null) lista = partes.length === 1 ? partes[0] : "";
  const porNombre = new Map(departamentos.map((d) => [normalizar(d.nombre), d.nombre]));
  return lista.replace(/\.\s*$/, "").split(/\s+-\s+/).map((n) => n.trim()).filter(Boolean)
    .map((n) => porNombre.get(normalizar(n)) || tituloPropio(n)).join(" - ");
}
/** Partes sugeridas para un aviso del SMN (o en blanco si se dibuja a mano). */
export function partesSugeridas(aviso, departamentos) {
  const emision = aviso?.emitidoEn ? new Date(aviso.emitidoEn) : new Date();
  const horas = aviso?.fin ? Math.max(1, Math.round((Date.parse(aviso.fin) - emision.getTime()) / HORA)) : 1;
  return {
    fenomeno: conTildes(aviso?.fenomeno || ""), emision: valorLocal(emision), validez: validezEnHoras(horas),
    zonas: aviso ? zonasDeMisiones(aviso.zona, departamentos) : "",
  };
}

function pasosDeTextos() {
  return [
    { pregunta: "¿Qué fenómeno?", ayuda: "Va primero, en mayúsculas y del color del nivel. Se sugiere el del SMN: revisalo.",
      html: (s) => `<textarea class="paso-texto" id="paso-fenomeno" maxlength="300" rows="3" placeholder="Tormentas fuertes con lluvias intensas, ráfagas y caída de granizo" data-foco>${esc(s.fenomeno || "")}</textarea>`,
      leer: (popup) => ({ fenomeno: popup.querySelector("#paso-fenomeno").value.trim() }),
      validar: (s) => (s.fenomeno ? null : "Escribí el fenómeno.") },
    { pregunta: "¿Cuándo se emitió?", ayuda: "Sale como «03/10/2026 a las 18:04hs». Se sugiere la hora del aviso del SMN.",
      html: (s) => `<label class="paso-etiqueta">Fecha y hora de emisión<input type="datetime-local" class="paso-input" id="paso-emision" value="${esc(s.emision || "")}" data-foco></label>
        <div class="paso-vigencia__rapidas"><button type="button" class="btn" data-ahora>Ahora</button></div>`,
      alMostrar: (popup) => popup.querySelector("[data-ahora]").addEventListener("click", () => { popup.querySelector("#paso-emision").value = valorLocal(new Date()); }),
      leer: (popup) => ({ emision: popup.querySelector("#paso-emision").value }),
      validar: (s) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.emision || "") ? null : "Elegí la fecha y la hora.") },
    { pregunta: "¿Hasta cuándo es válido?", ayuda: "Sale como «Validez hasta: …».",
      html: (s) => `<label class="paso-etiqueta">Validez hasta<input class="paso-input" id="paso-validez" maxlength="120" value="${esc(s.validez || "")}" data-foco></label>
        <div class="paso-vigencia__rapidas" role="group" aria-label="Atajos">${[1, 2, 3].map((h) => `<button type="button" class="btn" data-validez="${h}">${validezEnHoras(h).replace(" desde la emisión", "")}</button>`).join("")}</div>`,
      alMostrar: (popup) => popup.querySelectorAll("[data-validez]").forEach((b) => b.addEventListener("click", () => { popup.querySelector("#paso-validez").value = validezEnHoras(Number(b.dataset.validez)); })),
      leer: (popup) => ({ validez: popup.querySelector("#paso-validez").value.trim() }),
      validar: (s) => (s.validez ? null : "Escribí la validez.") },
    { pregunta: "¿Qué zonas?", ayuda: "Los departamentos afectados, separados con « - ». Se sugieren los del aviso del SMN. Si lo dejás vacío, no sale.",
      html: (s) => `<textarea class="paso-texto" id="paso-zonas" maxlength="400" rows="3" placeholder="25 de Mayo - Cainguás - Guaraní" data-foco>${esc(s.zonas || "")}</textarea>`,
      leer: (popup) => ({ zonas: popup.querySelector("#paso-zonas").value.trim() }) },
  ];
}

const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** El publicado que corresponde a este aviso del SMN, si lo hay. Los publicados antes de guardar
 * `smnId` se reconocen por el polígono, que se guarda tal cual vino del SMN. */
function publicadoDe(aviso, publicados) {
  const poligono = JSON.stringify(aviso.poligono);
  return publicados.find((p) => (p.smnId ? p.smnId === aviso.id : JSON.stringify(p.poligono) === poligono));
}

function pasoElegirAviso({ avisos, puntosDibujados, onSeleccionarPoligono, publicados, departamentos }) {
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
    leer: (popup, s) => {
      const elegido = leerOpciones(popup, "aviso")[0];
      // Al cambiar de aviso se vuelven a sugerir los textos (si es el mismo, quedan los editados).
      if (elegido === "manual") return { avisoId: "manual", poligono: puntosDibujados, finSmn: null, ...(s.avisoId !== "manual" ? partesSugeridas(null) : {}) };
      const aviso = avisos.find((a) => a.id === elegido);
      if (!aviso) return { avisoId: null, poligono: [] };
      onSeleccionarPoligono(aviso.poligono, aviso);
      return { avisoId: aviso.id, poligono: aviso.poligono, finSmn: aviso.fin, ...(s.avisoId !== aviso.id ? partesSugeridas(aviso, departamentos) : {}) };
    },
    validar: (s) => (Array.isArray(s.poligono) && s.poligono.length >= 3 ? null : "Elegí un aviso o dibujá el área a mano."),
  };
}

export function crearAvisoPorPasos({ inicial, avisos, puntosDibujados, onSeleccionarPoligono, publicados = [], departamentos = [], vistaPrevia, guardar, publicar }) {
  const pasos = [
    pasoElegirAviso({ avisos, puntosDibujados, onSeleccionarPoligono, publicados, departamentos }),
    { pregunta: "¿Qué fondo le ponemos?",
      html: (s) => opciones({ nombre: "fondo", tipo: "radio", items: Object.entries(FONDOS).map(([valor, [titulo, detalle]]) => ({ valor, titulo, detalle, marcada: s.fondo === valor })) }),
      leer: (popup) => ({ fondo: leerOpciones(popup, "fondo")[0] || "tormenta" }) },
    ...pasosDeTextos(),
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

  // Si llega con un aviso ya elegido (desde una notificación), se completan sus textos y su polígono
  // como si se lo hubiera elegido en el primer paso; si no, quedarían en blanco.
  const elegido = inicial?.avisoId && avisos.find((a) => a.id === inicial.avisoId);
  const delAviso = elegido ? (onSeleccionarPoligono(elegido.poligono, elegido), { ...partesSugeridas(elegido, departamentos), poligono: elegido.poligono, finSmn: elegido.fin }) : {};
  // Sin avisos del SMN (se dibuja a mano) el paso de elegir se salta: los textos arrancan en blanco.
  return asistente({ pasos, enviar, textoEnviar: "Confirmar y generar", estado: { ...partesSugeridas(null), ...inicial, ...delAviso }, ancho: 760 });
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
