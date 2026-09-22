import { opciones, leerOpciones, asistente, htmlAreaConIconos, activarAreaConIconos, pasoVistaPrevia, htmlPlacaLista } from "./pasos";
import { publicarEnRedes } from "./publicarEnRedes";

/**
 * Crear la placa de un aviso a muy corto plazo, paso a paso y todo dentro de un modal:
 * elegir aviso del SMN (o "dibujar a mano") → fondo → texto (con íconos) → vista previa
 * (pantalla completa) → confirmar y generar → placa lista. El título es siempre "Aviso a
 * muy corto plazo" (ya viene impreso en el fondo), no es un paso del asistente.
 * La página aporta:
 *   avisos: [{ id, titulo, zona, fin, poligono, texto }]  candidatos vigentes del RSS/CAP del SMN
 *   puntosDibujados: puntos ya dibujados a mano en el mapa de la página (fallback sin RSS)
 *   onSeleccionarPoligono(poligono) → refleja la elección en el mapa de la página (para la captura)
 *   vistaPrevia(valores) → { token, feedUrl, historiasUrl }   (genera sin guardar)
 *   guardar(valores, token) → la placa guardada
 */
const MAX_TEXTO = 2400;
const FONDOS = { tormenta: ["Tormenta", "Cielo oscuro, para alertas de tormenta"], nubes: ["Nubes", "Fondo claro con nubes"] };
export const TITULO = "Aviso a muy corto plazo";
const valoresDe = (s) => ({ texto: s.texto, fondo: s.fondo, poligono: s.poligono });

const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function pasoElegirAviso({ avisos, puntosDibujados, onSeleccionarPoligono }) {
  const hayDibujo = puntosDibujados.length >= 3;
  const items = [
    ...avisos.map((a) => ({ valor: a.id, titulo: a.titulo, detalle: `${a.zona} · vigente hasta ${fechaHora(a.fin)}` })),
    { valor: "manual", titulo: "Dibujar el área a mano", detalle: hayDibujo ? "Se usa lo que ya dibujaste en el mapa." : "Todavía no dibujaste nada — cerrá este asistente y dibujá el área en el mapa primero.", deshabilitada: !hayDibujo },
  ];
  return {
    pregunta: "¿Qué aviso del SMN publicamos?",
    ayuda: "Llegan por RSS del SMN; a veces hay más de uno vigente al mismo tiempo. Elegí cuál se convierte en placa.",
    omitir: () => avisos.length === 0,
    html: (s) => opciones({ nombre: "aviso", tipo: "radio", items: items.map((it) => ({ ...it, marcada: s.avisoId === it.valor })) }),
    leer: (popup) => {
      const elegido = leerOpciones(popup, "aviso")[0];
      if (elegido === "manual") return { avisoId: "manual", poligono: puntosDibujados };
      const aviso = avisos.find((a) => a.id === elegido);
      if (!aviso) return { avisoId: null, poligono: [] };
      onSeleccionarPoligono(aviso.poligono);
      return { avisoId: aviso.id, poligono: aviso.poligono, texto: aviso.texto };
    },
    validar: (s) => (Array.isArray(s.poligono) && s.poligono.length >= 3 ? null : "Elegí un aviso o dibujá el área a mano."),
  };
}

export function crearAvisoPorPasos({ inicial, avisos, puntosDibujados, onSeleccionarPoligono, vistaPrevia, guardar }) {
  const pasos = [
    pasoElegirAviso({ avisos, puntosDibujados, onSeleccionarPoligono }),
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
    const placa = await guardar(valoresDe(s), s.vista.token);
    return {
      tipo: "ok", titulo: "¡La placa está lista!", datos: placa, html: htmlPlacaLista(placa),
      accion: { texto: "Publicar en redes", alHacer: () => ({ cerrar: true, luego: () => publicarEnRedes({ feedUrl: placa.feedUrl, historiasUrl: placa.historiasUrl, epigrafe: `${TITULO}\n\n${s.texto}` }) }) },
    };
  };

  return asistente({ pasos, enviar, textoEnviar: "Confirmar y generar", estado: inicial, ancho: 760 });
}
