import { esc } from "./ui";
import { asistente, opciones, leerOpciones, pasoVistaPrevia, htmlPlacaLista } from "./pasos";
import { pasoNiveles, pasoFenomenos, htmlCambios } from "./pasosMapa";
import { publicarEnRedes } from "./publicarEnRedes";

/**
 * Asistentes de "Alertas meteorológicas" (todo dentro de un modal, paso a paso):
 *  - editarMapaAlertas:        nivel de cada departamento → fenómenos → se aplica al mapa (borrador).
 *  - crearPlacaMapaAlertas:    niveles → fenómenos (con 1 o 2 colores) → título → período → tamaño → fondo → vista previa → confirmar.
 *  - publicarAlertasPorPasos:  revisar los cambios → para cuándo + vigencia → publicar en el mapa público.
 */
const FONDOS = [{ valor: "tormenta", titulo: "Tormenta", detalle: "Cielo oscuro" }, { valor: "nubes", titulo: "Nubes", detalle: "Fondo claro con nubes" }];
const MAX_TITULO = 60;

const pasoTitulo = (aviso) => ({
  pregunta: "¿Qué título lleva la placa?", ayuda: aviso || "Hasta 60 caracteres, en una línea.",
  html: (s) => `<input class="paso-input" id="paso-titulo" maxlength="${MAX_TITULO}" value="${esc(s.titulo)}" data-foco autocomplete="off">`,
  leer: (popup) => ({ titulo: popup.querySelector("#paso-titulo").value.trim() }),
  validar: (s) => (s.titulo ? null : "Escribí un título."),
});
const pasoFondo = {
  pregunta: "¿Qué fondo le ponemos?",
  html: (s) => opciones({ nombre: "fondo", tipo: "radio", items: FONDOS.map((f) => ({ ...f, marcada: s.fondo === f.valor })) }),
  leer: (popup) => ({ fondo: leerOpciones(popup, "fondo")[0] || "tormenta" }),
};
const resultadoPlaca = (placa, epigrafe) => ({
  tipo: "ok", titulo: "¡La placa está lista!", datos: placa, html: htmlPlacaLista(placa),
  accion: { texto: "Publicar en redes", alHacer: () => ({ cerrar: true, luego: () => publicarEnRedes({ feedUrl: placa.feedUrl, historiasUrl: placa.historiasUrl, epigrafe }) }) },
});

export function editarMapaAlertas({ catalogo, zonas, iconos, aplicar }) {
  return asistente({
    estado: { zonas, iconos }, textoEnviar: "Aplicar al mapa",
    pasos: [
      pasoNiveles({ catalogo, idComoTexto: true, permitirVacio: false, etiqueta: (c) => `${c.nombre} · ${c.accion}`, ayuda: "Asigná el color de alerta a cada departamento. Podés usar «Poner todos en…»." }),
      pasoFenomenos({ catalogo }),
    ],
    enviar: async (s) => { aplicar(s.zonas, s.iconos); return { tipo: "ok", titulo: "Mapa actualizado", datos: true, html: "<p>El mapa ya muestra el borrador. Cuando esté listo, tocá «Revisar y publicar».</p>" }; },
  });
}

export function crearPlacaMapaAlertas({ catalogo, inicial, vistaPrevia, guardar }) {
  const rango = catalogo.tamanoPeriodo || { min: 30, max: 100, predeterminado: 64 };
  const maxPeriodo = catalogo.maxPeriodo ?? 600;
  const cuerpo = (s) => ({ zonas: s.zonas, iconos: s.iconos, periodo: s.periodo, fondo: s.fondo, titulo: s.titulo, tamanoPeriodo: s.tamanoPeriodo });
  const pasos = [
    pasoNiveles({ catalogo, idComoTexto: true, permitirVacio: false, etiqueta: (c) => `${c.nombre} · ${c.accion}`, ayuda: "El color de alerta de cada departamento en la placa." }),
    pasoFenomenos({ catalogo }),
    pasoTitulo("Se aplica a la placa del mapa. Hasta 60 caracteres."),
    { pregunta: "¿Qué período cubre?", ayuda: "Por ejemplo: «Próximas 24 horas». La letra se achica sola si el texto es largo.",
      html: (s) => `<textarea class="paso-texto" id="paso-periodo" maxlength="${maxPeriodo}" rows="4" data-foco>${esc(s.periodo)}</textarea>`,
      leer: (popup) => ({ periodo: popup.querySelector("#paso-periodo").value }),
      validar: (s) => (s.periodo.trim() ? null : "Escribí el período.") },
    { pregunta: "¿Qué tamaño de letra?", ayuda: "Del texto del período en la placa.",
      html: (s) => `<input class="paso-rango" id="paso-tamano" type="range" min="${rango.min}" max="${rango.max}" value="${s.tamanoPeriodo}"><p class="paso-rango-valor" id="paso-tamano-valor">${s.tamanoPeriodo} px</p>`,
      alMostrar: (popup) => { const r = popup.querySelector("#paso-tamano"), v = popup.querySelector("#paso-tamano-valor"); r.addEventListener("input", () => { v.textContent = `${r.value} px`; }); },
      leer: (popup) => ({ tamanoPeriodo: Number(popup.querySelector("#paso-tamano").value) }) },
    pasoFondo,
    pasoVistaPrevia({ clave: (s) => JSON.stringify(cuerpo(s)), generar: (s) => vistaPrevia(cuerpo(s)) }),
  ];
  const enviar = async (s) => resultadoPlaca(await guardar(cuerpo(s), s.vista.token), `${s.titulo}\n\n${s.periodo}`);
  return asistente({ pasos, enviar, textoEnviar: "Confirmar y generar", estado: inicial, ancho: 760 });
}

const HORA = 3600 * 1000;
const z2 = (n) => String(n).padStart(2, "0");
/** Date → "AAAA-MM-DDTHH:mm" en hora local (formato de <input type="datetime-local">). */
const valorLocal = (d) => `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}T${z2(d.getHours())}:${z2(d.getMinutes())}`;
/** 23:59 de hoy (dias = 0) o de dentro de `dias` días. */
const finDelDia = (dias = 0) => { const d = new Date(); d.setDate(d.getDate() + dias); d.setHours(23, 59, 0, 0); return d; };
const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const MAX_PERIODO_PUBLICACION = 120;

/**
 * Publicar el mapa en el embebido, como los avisos a muy corto plazo: revisar cambios →
 * para cuándo es + hasta cuándo se muestra (después se saca sola) → publicar.
 *   vigentes: publicaciones que se ven ahora ({ id, periodo, vigenteHasta }); se ofrecen para reemplazar.
 *   periodoSugerido: el período de la última placa.
 *   publicar({ periodo, vigenteHasta, reemplazar }) → la publicación.
 */
export function publicarAlertasPorPasos({ cambios, sinPublicar, iconosCambiaron, republicar, vigentes = [], periodoSugerido = "", publicar }) {
  const pasoCuando = {
    pregunta: "¿Para cuándo es y hasta cuándo se muestra?",
    ayuda: "Pasada esa hora, la alerta deja de mostrarse sola en el mapa público. Puede haber varias a la vez (por ejemplo, hoy y mañana).",
    html: (s) => `<label class="paso-etiqueta">Para cuándo es (se lee en el mapa público)
        <input class="paso-input" id="paso-periodo" maxlength="${MAX_PERIODO_PUBLICACION}" value="${esc(s.periodo)}" placeholder="Ej.: Jueves 01/10 · tarde y noche" data-foco autocomplete="off"></label>
      <label class="paso-etiqueta" style="margin-top:12px">Se muestra hasta
        <input type="datetime-local" class="paso-input" id="paso-vigencia" value="${esc(s.vigencia)}" min="${esc(valorLocal(new Date()))}"></label>
      <div class="paso-vigencia__rapidas" role="group" aria-label="Atajos">
        <button type="button" class="btn" data-fin="0">Fin de hoy</button><button type="button" class="btn" data-fin="1">Fin de mañana</button>
        ${[6, 12, 24].map((h) => `<button type="button" class="btn" data-horas="${h}">+${h} h</button>`).join("")}</div>
      ${vigentes.length ? `<p class="paso-etiqueta" style="margin-top:14px">Al publicar, sacar del mapa público:</p>${opciones({ nombre: "reemplazar", items: vigentes.map((v) => ({ valor: String(v.id), titulo: v.periodo || "Alerta publicada", detalle: `Vigente hasta el ${fechaHora(v.vigenteHasta)}`, marcada: s.reemplazar.includes(v.id) })) })}` : ""}`,
    alMostrar: (popup) => {
      const campo = popup.querySelector("#paso-vigencia");
      popup.querySelectorAll("[data-fin]").forEach((b) => b.addEventListener("click", () => { campo.value = valorLocal(finDelDia(Number(b.dataset.fin))); }));
      popup.querySelectorAll("[data-horas]").forEach((b) => b.addEventListener("click", () => { campo.value = valorLocal(new Date(Date.now() + Number(b.dataset.horas) * HORA)); }));
    },
    leer: (popup) => ({ periodo: popup.querySelector("#paso-periodo").value.trim(), vigencia: popup.querySelector("#paso-vigencia").value,
      reemplazar: vigentes.length ? leerOpciones(popup, "reemplazar").map(Number) : [] }),
    validar: (s) => {
      if (!s.periodo) return "Escribí para cuándo es la alerta.";
      const t = new Date(s.vigencia).getTime();
      if (!s.vigencia || Number.isNaN(t)) return "Elegí hasta cuándo se muestra.";
      if (t <= Date.now()) return "Tiene que ser una fecha y hora futura.";
      if (t > Date.now() + 72 * HORA) return "No puede superar las 72 horas.";
      return null;
    },
  };
  return asistente({
    // Por defecto reemplaza a las vigentes: lo común es corregir la de hoy, no sumar otra.
    estado: { periodo: periodoSugerido, vigencia: valorLocal(finDelDia()), reemplazar: vigentes.map((v) => v.id) },
    textoEnviar: "Publicar en el mapa público",
    pasos: [
      republicar
        ? { pregunta: "¿Volvemos a publicar el mismo mapa?", ayuda: "No hay cambios respecto de lo último publicado.", html: () => "<p>Se publica de nuevo, con el período y la vigencia que elijas en el paso siguiente.</p>" }
        : { pregunta: "Revisá los cambios", ayuda: "Al confirmar, el mapa público muestra este mapa.",
          html: () => `${htmlCambios({ cambios, sinPublicar })}${iconosCambiaron ? "<p>Cambiaron los fenómenos de la placa.</p>" : ""}` },
      pasoCuando,
    ],
    enviar: async (s) => {
      const pub = await publicar({ periodo: s.periodo, vigenteHasta: new Date(s.vigencia).toISOString(), reemplazar: s.reemplazar });
      return { tipo: "ok", titulo: "¡Publicado!", datos: pub, html: `<p>El mapa público muestra «${esc(pub.periodo)}» hasta el ${esc(fechaHora(pub.vigenteHasta))}. Después se saca sola.</p>` };
    },
  });
}
