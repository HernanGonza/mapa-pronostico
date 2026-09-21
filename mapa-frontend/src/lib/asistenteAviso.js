import { esc } from "./ui";
import { asistente, opciones, leerOpciones, htmlAreaConIconos, activarAreaConIconos, pasoVistaPrevia, htmlPlacaLista } from "./pasos";
import { publicarEnRedes } from "./publicarEnRedes";

/**
 * Crear la placa de un aviso a muy corto plazo, paso a paso y todo dentro de un modal:
 * título → fondo → texto (con íconos) → vista previa (pantalla completa) → confirmar y generar → placa lista.
 * La zona se dibuja antes en el mapa de la página. La página aporta:
 *   vistaPrevia(valores) → { token, feedUrl, historiasUrl }   (genera sin guardar)
 *   guardar(valores, token) → la placa guardada
 */
const MAX_TEXTO = 2400;
const MAX_TITULO = 60;
const FONDOS = { tormenta: ["Tormenta", "Cielo oscuro, para alertas de tormenta"], nubes: ["Nubes", "Fondo claro con nubes"] };
const valoresDe = (s) => ({ titulo: s.titulo, texto: s.texto, fondo: s.fondo });

export function crearAvisoPorPasos({ inicial, vistaPrevia, guardar }) {
  const pasos = [
    { pregunta: "¿Cómo se llama el aviso?", ayuda: "Es el título que va arriba de la placa. Hasta 60 caracteres, en una línea.",
      html: (s) => `<input class="paso-input" id="paso-titulo" maxlength="${MAX_TITULO}" value="${esc(s.titulo)}" data-foco autocomplete="off">`,
      leer: (popup) => ({ titulo: popup.querySelector("#paso-titulo").value.trim() }),
      validar: (s) => (s.titulo ? null : "Escribí un título.") },
    { pregunta: "¿Qué fondo le ponemos?",
      html: (s) => opciones({ nombre: "fondo", tipo: "radio", items: Object.entries(FONDOS).map(([valor, [titulo, detalle]]) => ({ valor, titulo, detalle, marcada: s.fondo === valor })) }),
      leer: (popup) => ({ fondo: leerOpciones(popup, "fondo")[0] || "tormenta" }) },
    { pregunta: "Escribí el aviso", ayuda: `Hasta ${MAX_TEXTO} caracteres. Podés sumar íconos.`,
      html: (s) => htmlAreaConIconos({ id: "paso-texto", valor: s.texto, max: MAX_TEXTO, placeholder: "Escribí acá el aviso a muy corto plazo…" }),
      alMostrar: (popup) => activarAreaConIconos(popup, "paso-texto", MAX_TEXTO),
      leer: (popup) => ({ texto: popup.querySelector("#paso-texto").value }),
      validar: (s) => (s.texto.trim() ? null : "Escribí el texto del aviso.") },
    pasoVistaPrevia({ clave: (s) => JSON.stringify(valoresDe(s)), generar: (s) => vistaPrevia(valoresDe(s)) }),
  ];

  const enviar = async (s) => {
    const placa = await guardar(valoresDe(s), s.vista.token);
    return {
      tipo: "ok", titulo: "¡La placa está lista!", datos: placa, html: htmlPlacaLista(placa),
      accion: { texto: "Publicar en redes", alHacer: () => ({ cerrar: true, luego: () => publicarEnRedes({ feedUrl: placa.feedUrl, historiasUrl: placa.historiasUrl, epigrafe: `${s.titulo}\n\n${s.texto}` }) }) },
    };
  };

  return asistente({ pasos, enviar, textoEnviar: "Confirmar y generar", estado: inicial, ancho: 760 });
}
