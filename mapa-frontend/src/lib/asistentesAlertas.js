import { pasosVigencias } from "./asistenteVigencias";
import { esc } from "./ui";
import { asistente, opciones, leerOpciones, pasoVistaPrevia, htmlPlacaLista } from "./pasos";
import { pasoNiveles, pasoFenomenos, htmlCambios } from "./pasosMapa";
import { publicarEnRedes } from "./publicarEnRedes";

/**
 * Asistentes de "Alertas meteorológicas" (todo dentro de un modal, paso a paso):
 *  - editarMapaAlertas:        nivel de cada departamento → fenómenos → se aplica al mapa (borrador).
 *  - crearPlacaMapaAlertas:    niveles → fenómenos (con 1 o 2 colores) → período → tamaño → fondo → vista previa → confirmar.
 *  - publicarAlertasPorPasos:  revisar los cambios → para cuándo + vigencia → publicar en el mapa público.
 */
const FONDOS = [{ valor: "tormenta", titulo: "Tormenta", detalle: "Cielo oscuro" }, { valor: "nubes", titulo: "Nubes", detalle: "Fondo claro con nubes" }];
const pasoFondo = {
  pregunta: "¿Qué fondo le ponemos?",
  html: (s) => opciones({ nombre: "fondo", tipo: "radio", items: FONDOS.map((f) => ({ ...f, marcada: s.fondo === f.valor })) }),
  leer: (popup) => ({ fondo: leerOpciones(popup, "fondo")[0] || "tormenta" }),
};
const resultadoPlaca = (placa, epigrafe) => ({
  tipo: "ok", titulo: "¡La placa está lista!", datos: placa, html: htmlPlacaLista(placa),
  accion: { texto: "Publicar en redes", alHacer: () => ({ cerrar: true, luego: () => publicarEnRedes({ feedUrl: placa.feedUrl, historiasUrl: placa.historiasUrl, epigrafe }) }) },
});

/**
 * Asistente de niveles y fenómenos. Sin `guardar`, deja el resultado como borrador (`aplicar`); con `guardar(zonas, iconos)`
 * (una alerta ya publicada) lo guarda directo en esa alerta, sin republicar.
 */
export function editarMapaAlertas({ catalogo, zonas, iconos, aplicar, guardar = null }) {
  return asistente({
    estado: { zonas, iconos }, textoEnviar: guardar ? "Guardar en la alerta" : "Aplicar al mapa",
    pasos: [
      pasoNiveles({ catalogo, idComoTexto: true, permitirVacio: false, etiqueta: (c) => `${c.nombre} · ${c.accion}`, ayuda: "Asigná el color de alerta a cada departamento. Podés usar «Poner todos en…»." }),
      pasoFenomenos({ catalogo }),
    ],
    enviar: async (s) => {
      if (guardar) {
        await guardar(s.zonas, s.iconos);
        return { tipo: "ok", titulo: "Mapa guardado", datos: true, html: "<p>La alerta ya tiene los colores nuevos y el mapa público los muestra. Si le habías puesto vigencias por nivel, revisalas con «Vigencias por nivel»: las de los departamentos que cambiaron de color se borraron.</p>" };
      }
      aplicar(s.zonas, s.iconos);
      return { tipo: "ok", titulo: "Mapa actualizado", datos: true, html: "<p>El mapa ya muestra el borrador. Cuando esté listo, tocá «Publicar en la página» en su tarjeta.</p>" };
    },
  });
}

export function crearPlacaMapaAlertas({ catalogo, inicial, vistaPrevia, guardar }) {
  const rango = catalogo.tamanoPeriodo || { min: 30, max: 100, predeterminado: 64 };
  const maxPeriodo = catalogo.maxPeriodo ?? 600;
  const cuerpo = (s) => ({ zonas: s.zonas, iconos: s.iconos, periodo: s.periodo, fondo: s.fondo, tamanoPeriodo: s.tamanoPeriodo });
  const pasos = [
    pasoNiveles({ catalogo, idComoTexto: true, permitirVacio: false, etiqueta: (c) => `${c.nombre} · ${c.accion}`, ayuda: "El color de alerta de cada departamento en la placa." }),
    pasoFenomenos({ catalogo }),
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
  const enviar = async (s) => resultadoPlaca(await guardar(cuerpo(s), s.vista.token), `Alerta meteorológica\n\n${s.periodo}`);
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

const DIAS_EN_FILA = 7;

/**
 * Publicar el mapa en el embebido, como los avisos a muy corto plazo: revisar cambios →
 * cuándo aparece (ahora o en fila detrás de otra) → qué vigentes saca → para cuándo es +
 * hasta cuándo se muestra (después se saca sola) → publicar.
 *   vigentes: publicaciones que se ven ahora ({ id, periodo, vigenteHasta }).
 *   enFila: las que esperan a que termine otra; con las vigentes, se ofrecen para ponerse detrás.
 *   nueva: es una alerta nueva (no la corrección de la publicada): por defecto no saca a nadie
 *     y va en fila detrás de la última.
 *   corrige: id de la alerta que se está corrigiendo: por defecto reemplaza sólo a ésa.
 *   periodoSugerido: el período de la última placa.
 *   publicar({ periodo, vigenteHasta, reemplazar, enFilaDe }) → la publicación.
 */
export function publicarAlertasPorPasos({ catalogo, zonas = [], cambios, sinPublicar, iconosCambiaron, republicar, vigentes = [], enFila = [], nueva = false, corrige = null, periodoSugerido = "", publicar }) {
  const todas = [...vigentes, ...enFila];
  const anterior = (s) => todas.find((v) => String(v.id) === s.aparece);
  // Para la que va en fila: fin del día siguiente al que termina la anterior.
  const vigenciaEnFila = (v) => { const d = new Date(v.vigenteHasta); d.setDate(d.getDate() + 1); d.setHours(23, 59, 0, 0); return valorLocal(d); };
  const ultima = todas.reduce((a, v) => (!a || Date.parse(v.vigenteHasta) > Date.parse(a.vigenteHasta) ? v : a), null);
  const pasoAparece = {
    omitir: () => !todas.length,
    pregunta: "¿Cuándo aparece en el mapa público?",
    ayuda: "En fila: se muestra sola apenas termine (o despublicás) la otra. Sirve para dejar cargada la de pasado mañana.",
    html: (s) => opciones({ nombre: "aparece", tipo: "radio", items: [
      { valor: "ahora", titulo: "Ahora", detalle: "Se ve desde ya (junto con las vigentes que no saques).", marcada: s.aparece === "ahora" },
      ...todas.map((v) => ({ valor: String(v.id), titulo: `Cuando termine «${v.periodo || "Alerta publicada"}»`,
        detalle: `${enFila.includes(v) ? "En fila" : "Vigente"} hasta el ${fechaHora(v.vigenteHasta)}`, marcada: s.aparece === String(v.id) })),
    ] }),
    // Al ponerla en fila, si la vigencia quedaba antes de que termine la anterior, se sugiere el día siguiente.
    leer: (popup, s) => {
      const aparece = leerOpciones(popup, "aparece")[0] || "ahora", v = anterior({ aparece });
      return { aparece, vigencia: v && Date.parse(s.vigencia) <= Date.parse(v.vigenteHasta) ? vigenciaEnFila(v) : s.vigencia };
    },
  };
  const pasoReemplazar = {
    omitir: (s) => !vigentes.length || s.aparece !== "ahora",
    pregunta: "¿Saca alguna de las vigentes?",
    ayuda: "Marcá las que esta alerta reemplaza (por ejemplo, si corregís la de hoy). Las que no marques siguen mostrándose.",
    html: (s) => opciones({ nombre: "reemplazar", items: vigentes.map((v) => ({ valor: String(v.id), titulo: v.periodo || "Alerta publicada", detalle: `Vigente hasta el ${fechaHora(v.vigenteHasta)}`, marcada: s.reemplazar.includes(v.id) })) }),
    leer: (popup) => ({ reemplazar: leerOpciones(popup, "reemplazar").map(Number) }),
  };
  const pasoCuando = {
    pregunta: "¿Para cuándo es y hasta cuándo se muestra?",
    ayuda: "Pasada esa hora, la alerta deja de mostrarse sola en el mapa público.",
    html: (s) => `${anterior(s) ? `<p>Aparece cuando termine «${esc(anterior(s).periodo || "Alerta publicada")}» (${esc(fechaHora(anterior(s).vigenteHasta))}) o cuando la despubliques.</p>` : ""}
      <label class="paso-etiqueta">Para cuándo es (se lee en el mapa público)
        <input class="paso-input" id="paso-periodo" maxlength="${MAX_PERIODO_PUBLICACION}" value="${esc(s.periodo)}" placeholder="Ej.: Jueves 01/10 · tarde y noche" data-foco autocomplete="off"></label>
      <label class="paso-etiqueta" style="margin-top:12px">Se muestra hasta
        <input type="datetime-local" class="paso-input" id="paso-vigencia" value="${esc(s.vigencia)}" min="${esc(valorLocal(new Date()))}"></label>
      ${anterior(s) ? "" : `<div class="paso-vigencia__rapidas" role="group" aria-label="Atajos">
        <button type="button" class="btn" data-fin="0">Fin de hoy</button><button type="button" class="btn" data-fin="1">Fin de mañana</button>
        ${[6, 12, 24].map((h) => `<button type="button" class="btn" data-horas="${h}">+${h} h</button>`).join("")}</div>`}`,
    alMostrar: (popup) => {
      const campo = popup.querySelector("#paso-vigencia");
      popup.querySelectorAll("[data-fin]").forEach((b) => b.addEventListener("click", () => { campo.value = valorLocal(finDelDia(Number(b.dataset.fin))); }));
      popup.querySelectorAll("[data-horas]").forEach((b) => b.addEventListener("click", () => { campo.value = valorLocal(new Date(Date.now() + Number(b.dataset.horas) * HORA)); }));
    },
    leer: (popup) => ({ periodo: popup.querySelector("#paso-periodo").value.trim(), vigencia: popup.querySelector("#paso-vigencia").value }),
    validar: (s) => {
      if (!s.periodo) return "Escribí para cuándo es la alerta.";
      const t = new Date(s.vigencia).getTime(), v = anterior(s);
      if (!s.vigencia || Number.isNaN(t)) return "Elegí hasta cuándo se muestra.";
      if (t <= Date.now()) return "Tiene que ser una fecha y hora futura.";
      if (v && t <= Date.parse(v.vigenteHasta)) return `Tiene que terminar después que la anterior (${fechaHora(v.vigenteHasta)}); si no, nunca aparece.`;
      if (v && t > Date.now() + DIAS_EN_FILA * 24 * HORA) return `No puede superar los ${DIAS_EN_FILA} días.`;
      if (!v && t > Date.now() + 72 * HORA) return "No puede superar las 72 horas.";
      return null;
    },
  };
  // Vigencias por nivel (si el mapa tiene 2 o más niveles): hasta cuándo vale cada uno y a qué pasa después.
  const vigencias = pasosVigencias({ catalogo, zonas: () => zonas, soloSiVarios: true,
    tope: (s) => ({ ms: Date.parse(s.vigencia), texto: fechaHora(new Date(s.vigencia)), local: s.vigencia }) });
  const enFilaInicial = nueva && ultima;
  return asistente({
    // Corrigiendo la publicada, por defecto reemplaza a las vigentes; una alerta nueva va en fila detrás de la última.
    estado: { periodo: periodoSugerido, aparece: enFilaInicial ? String(ultima.id) : "ahora",
      vigencia: enFilaInicial ? vigenciaEnFila(ultima) : valorLocal(finDelDia()),
      // Corrigiendo una alerta (`corrige`: su id), por defecto reemplaza sólo a ésa.
      reemplazar: nueva ? [] : corrige != null ? vigentes.filter((v) => v.id === corrige).map((v) => v.id) : vigentes.map((v) => v.id) },
    textoEnviar: "Publicar en el mapa público",
    pasos: [
      republicar
        ? { pregunta: "¿Volvemos a publicar el mismo mapa?", ayuda: "No hay cambios respecto de lo último publicado.", html: () => "<p>Se publica de nuevo, con el período y la vigencia que elijas en los pasos siguientes.</p>" }
        : { pregunta: "Revisá los cambios", ayuda: "Al confirmar, el mapa público muestra este mapa.",
          html: () => `${htmlCambios({ cambios, sinPublicar })}${iconosCambiaron ? "<p>Cambiaron los fenómenos de la placa.</p>" : ""}` },
      pasoAparece,
      pasoReemplazar,
      pasoCuando,
      ...vigencias.pasos,
    ],
    enviar: async (s) => {
      const v = anterior(s);
      const pub = await publicar({ periodo: s.periodo, vigenteHasta: new Date(s.vigencia).toISOString(), reemplazar: v ? [] : s.reemplazar, enFilaDe: v ? v.id : null, tramos: vigencias.paraEnviar(s) });
      return { tipo: "ok", titulo: v ? "¡Quedó en fila!" : "¡Publicado!", datos: pub,
        html: v ? `<p>«${esc(pub.periodo)}» aparece en el mapa público cuando termine «${esc(v.periodo || "Alerta publicada")}», y se saca sola el ${esc(fechaHora(pub.vigenteHasta))}.</p>`
          : `<p>El mapa público muestra «${esc(pub.periodo)}» hasta el ${esc(fechaHora(pub.vigenteHasta))}. Después se saca sola.</p>` };
    },
  });
}
