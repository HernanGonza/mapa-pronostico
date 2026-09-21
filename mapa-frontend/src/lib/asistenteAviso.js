import { esc } from "./ui";
import { asistente, opciones, leerOpciones } from "./pasos";
import { publicarEnRedes } from "./publicarEnRedes";

/**
 * "Crear la placa" de un aviso a muy corto plazo, paso a paso (lib/pasos.js): título → fondo → texto →
 * revisión → placa lista (con salida directa a "Publicar en redes"). La zona se dibuja antes en el mapa
 * de la página; acá se pide todo lo demás. `generar(valores)` lo aporta la página y devuelve la placa.
 */
const MAX_TEXTO = 2400;
const MAX_TITULO = 60;
const ICONOS = [["⚠️", "Advertencia"], ["⛈️", "Tormenta"], ["🌧️", "Lluvia"], ["💨", "Viento"], ["🏠", "Casa"], ["🚫", "Prohibido"], ["✅", "Recomendación"], ["📞", "Teléfono"]];
const FONDOS = { tormenta: ["Tormenta", "Cielo oscuro, para alertas de tormenta"], nubes: ["Nubes", "Fondo claro con nubes"] };

export function crearAvisoPorPasos({ inicial, puntos, generar }) {
  const pasos = [
    { pregunta: "¿Cómo se llama el aviso?", ayuda: "Es el título que va arriba de la placa. Hasta 60 caracteres, en una línea.",
      html: (s) => `<input class="paso-input" id="paso-titulo" maxlength="${MAX_TITULO}" value="${esc(s.titulo)}" data-foco autocomplete="off">`,
      leer: (popup) => ({ titulo: popup.querySelector("#paso-titulo").value.trim() }),
      validar: (s) => (s.titulo ? null : "Escribí un título.") },
    { pregunta: "¿Qué fondo le ponemos?",
      html: (s) => opciones({ nombre: "fondo", tipo: "radio", items: Object.entries(FONDOS).map(([valor, [titulo, detalle]]) => ({ valor, titulo, detalle, marcada: s.fondo === valor })) }),
      leer: (popup) => ({ fondo: leerOpciones(popup, "fondo")[0] || "tormenta" }) },
    { pregunta: "Escribí el aviso", ayuda: `Hasta ${MAX_TEXTO} caracteres. Podés sumar íconos.`,
      html: (s) => `<textarea class="paso-texto" id="paso-texto" maxlength="${MAX_TEXTO}" rows="7" placeholder="Escribí acá el aviso a muy corto plazo…" data-foco>${esc(s.texto)}</textarea>
        <p class="paso-contador-texto" id="paso-contador"></p>
        <div class="paso-iconos" role="group" aria-label="Insertar ícono en el texto">${ICONOS.map(([i, n]) => `<button type="button" data-icono="${i}" aria-label="Insertar ${n}" title="${n}">${i}</button>`).join("")}</div>`,
      alMostrar: (popup) => {
        const area = popup.querySelector("#paso-texto"), cont = popup.querySelector("#paso-contador");
        const act = () => { cont.textContent = `${area.value.length}/${MAX_TEXTO} caracteres`; };
        area.addEventListener("input", act); act();
        popup.querySelector(".paso-iconos").addEventListener("click", (e) => {
          const icono = e.target.closest("[data-icono]")?.dataset.icono;
          if (!icono) return;
          const ini = area.selectionStart ?? area.value.length, fin = area.selectionEnd ?? ini;
          const nuevo = area.value.slice(0, ini) + icono + area.value.slice(fin);
          if (nuevo.length > MAX_TEXTO) return;
          area.value = nuevo; area.focus(); area.setSelectionRange(ini + icono.length, ini + icono.length); act();
        });
      },
      leer: (popup) => ({ texto: popup.querySelector("#paso-texto").value }),
      validar: (s) => (s.texto.trim() ? null : "Escribí el texto del aviso.") },
    { pregunta: "Revisá y generá la placa",
      html: (s) => `<dl class="paso-resumen">
          <div><dt>Título</dt><dd>${esc(s.titulo)}</dd></div>
          <div><dt>Fondo</dt><dd>${esc(FONDOS[s.fondo]?.[0] || s.fondo)}</dd></div>
          <div><dt>Zona</dt><dd>Polígono de ${puntos} puntos dibujado en el mapa</dd></div>
          <div><dt>Texto</dt><dd class="paso-resumen__texto">${esc(s.texto)}</dd></div>
        </dl>
        <p class="paso-nota">Se generan el feed y las historias, y quedan guardados en el historial.</p>` },
  ];

  const enviar = async (s) => {
    const placa = await generar({ titulo: s.titulo, texto: s.texto, fondo: s.fondo });
    return {
      tipo: "ok", titulo: "¡La placa está lista!", datos: placa,
      html: `<div class="paso-miniaturas"><img src="${esc(placa.feedUrl)}" alt="Placa de feed"><img src="${esc(placa.historiasUrl)}" alt="Placa de historias"></div>`,
      accion: { texto: "Publicar en redes", alHacer: () => ({ cerrar: true, luego: () => publicarEnRedes({ feedUrl: placa.feedUrl, historiasUrl: placa.historiasUrl, epigrafe: `${s.titulo}\n\n${s.texto}` }) }) },
    };
  };

  return asistente({ pasos, enviar, textoEnviar: "Generar placa", estado: inicial });
}
