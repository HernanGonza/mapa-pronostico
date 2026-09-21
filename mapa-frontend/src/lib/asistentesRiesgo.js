import { esc } from "./ui";
import { asistente, pasoVistaPrevia, htmlPlacaLista } from "./pasos";
import { pasoNiveles, htmlCambios } from "./pasosMapa";
import { publicarEnRedes } from "./publicarEnRedes";

/**
 * Asistentes de "Riesgo de incendios" (todo dentro de un modal, paso a paso):
 *  - editarNivelesRiesgo:    nivel de cada departamento → se aplica al mapa (borrador).
 *  - crearPlacaRiesgo:       fecha → niveles → vista previa (pantalla completa) → confirmar y generar.
 *  - publicarRiesgoPorPasos: revisar los cambios → publicar en el mapa público.
 */
const pasoFecha = {
  pregunta: "¿De qué fecha es el informe?", ayuda: "La fecha que va escrita en la imagen institucional.",
  html: (s) => `<input type="date" class="paso-input" id="paso-fecha" value="${esc(s.fecha)}" data-foco>`,
  leer: (popup) => ({ fecha: popup.querySelector("#paso-fecha").value }),
  validar: (s) => (s.fecha ? null : "Elegí una fecha."),
};

export function editarNivelesRiesgo({ catalogo, zonas, aplicar }) {
  return asistente({
    estado: { zonas }, textoEnviar: "Aplicar al mapa",
    pasos: [pasoNiveles({ catalogo, ayuda: "El mapa de la página muestra estos niveles como borrador; publicás cuando quieras." })],
    enviar: async (s) => { aplicar(s.zonas); return { tipo: "ok", titulo: "Niveles aplicados", datos: s.zonas, html: "<p>El mapa ya muestra el borrador. Cuando esté listo, tocá «Revisar y publicar».</p>" }; },
  });
}

export function crearPlacaRiesgo({ catalogo, zonas, fecha, vistaPrevia, guardar }) {
  const pasos = [
    pasoFecha,
    pasoNiveles({ catalogo, ayuda: "Elegí el nivel de riesgo de cada departamento para la placa." }),
    pasoVistaPrevia({ clave: (s) => JSON.stringify([s.fecha, s.zonas]), generar: (s) => vistaPrevia(s.zonas, s.fecha) }),
  ];
  const enviar = async (s) => {
    const placa = await guardar(s.zonas, s.fecha, s.vista.token);
    return { tipo: "ok", titulo: "¡La placa está lista!", datos: placa, html: htmlPlacaLista(placa),
      accion: { texto: "Publicar en redes", alHacer: () => ({ cerrar: true, luego: () => publicarEnRedes({ feedUrl: placa.feedUrl, historiasUrl: placa.historiasUrl, epigrafe: `Riesgo de incendios forestales · ${s.fecha.split("-").reverse().join("/")}` }) }) } };
  };
  return asistente({ pasos, enviar, textoEnviar: "Confirmar y generar", estado: { zonas, fecha }, ancho: 760 });
}

export function publicarRiesgoPorPasos({ cambios, sinPublicar, publicar }) {
  return asistente({
    estado: {}, textoEnviar: "Publicar en el mapa público",
    pasos: [{ pregunta: "Revisá los cambios", ayuda: "Al confirmar, el mapa público muestra estos niveles.", html: () => htmlCambios({ cambios, sinPublicar }) }],
    enviar: async () => { await publicar(); return { tipo: "ok", titulo: "¡Publicado!", datos: true, html: "<p>El mapa público ya muestra estas categorías.</p>" }; },
  });
}
