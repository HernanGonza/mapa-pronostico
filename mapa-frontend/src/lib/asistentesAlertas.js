import { esc } from "./ui";
import { asistente, opciones, leerOpciones, pasoVistaPrevia, htmlPlacaLista, htmlAreaConIconos, activarAreaConIconos } from "./pasos";
import { pasoNiveles, pasoFenomenos, htmlCambios } from "./pasosMapa";
import { publicarEnRedes } from "./publicarEnRedes";

/**
 * Asistentes de "Alertas meteorológicas" (todo dentro de un modal, paso a paso):
 *  - editarMapaAlertas:        nivel de cada departamento → fenómenos → se aplica al mapa (borrador).
 *  - crearPlacaMapaAlertas:    niveles → fenómenos (con 1 o 2 colores) → título → período → tamaño → fondo → vista previa → confirmar.
 *  - crearPlacaRecomendaciones: título → fondo → texto (íconos) → imagen opcional → vista previa → confirmar.
 *  - publicarAlertasPorPasos:  revisar los cambios → publicar en el mapa público.
 */
const FONDOS = [{ valor: "tormenta", titulo: "Tormenta", detalle: "Cielo oscuro" }, { valor: "nubes", titulo: "Nubes", detalle: "Fondo claro con nubes" }];
const MAX_TEXTO = 2400;
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

// Paso de imagen opcional: se lee en el navegador (data URL) y va en el estado.
const pasoImagen = {
  pregunta: "¿Querés sumar una imagen?", ayuda: "Opcional. PNG, JPG o WebP, hasta 5 MB y 25 megapíxeles. Va arriba del texto, sin recortarla.",
  html: (s) => `<div class="paso-imagen"><input type="file" id="paso-img" class="paso-input" accept="image/png,image/jpeg,image/webp"><div id="paso-img-vista">${s.imagen ? `<img src="${s.imagen}" alt="Imagen elegida"> <button type="button" class="btn" data-quitar>Quitar imagen</button>` : ""}</div></div>`,
  alMostrar: (popup, s) => {
    const vista = popup.querySelector("#paso-img-vista"), entrada = popup.querySelector("#paso-img");
    const pintar = () => { vista.innerHTML = s.imagen ? `<img src="${s.imagen}" alt="Imagen elegida"> <button type="button" class="btn" data-quitar>Quitar imagen</button>` : ""; };
    vista.addEventListener("click", (e) => { if (e.target.closest("[data-quitar]")) { s.imagen = null; entrada.value = ""; pintar(); } });
    entrada.addEventListener("change", async () => {
      const archivo = entrada.files?.[0];
      if (!archivo) return;
      const { default: Swal } = await import("sweetalert2");
      try {
        if (!["image/png", "image/jpeg", "image/webp"].includes(archivo.type) || archivo.size > 5 * 1024 * 1024) throw new Error("Elegí una imagen PNG, JPG o WebP de hasta 5 MB.");
        const data = await new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => mal(new Error("No se pudo leer la imagen.")); r.readAsDataURL(archivo); });
        const img = new Image(); img.src = data; await img.decode();
        if (img.naturalWidth * img.naturalHeight > 25000000) throw new Error("La imagen supera los 25 megapíxeles. Elegí una más pequeña.");
        Swal.resetValidationMessage(); s.imagen = data; pintar();
      } catch (e) { entrada.value = ""; Swal.showValidationMessage(e.message); }
    });
  },
};

export function crearPlacaRecomendaciones({ inicial, vistaPrevia, guardar }) {
  const cuerpo = (s) => ({ texto: s.texto, fondo: s.fondo, titulo: s.titulo, imagen: s.imagen || null });
  const marca = (s) => JSON.stringify({ ...cuerpo(s), imagen: s.imagen ? `${s.imagen.length}:${s.imagen.slice(-32)}` : null });
  const pasos = [
    pasoTitulo("Se aplica a la placa. Hasta 60 caracteres."),
    pasoFondo,
    { pregunta: "Escribí las recomendaciones", ayuda: `Para la población. Hasta ${MAX_TEXTO} caracteres; podés sumar íconos.`,
      html: (s) => htmlAreaConIconos({ id: "paso-texto", valor: s.texto, max: MAX_TEXTO, placeholder: "Escribí aquí las recomendaciones para la población…", filas: 8 }),
      alMostrar: (popup) => activarAreaConIconos(popup, "paso-texto", MAX_TEXTO),
      leer: (popup) => ({ texto: popup.querySelector("#paso-texto").value }),
      validar: (s) => (s.texto.trim() ? null : "Escribí las recomendaciones.") },
    pasoImagen,
    pasoVistaPrevia({ clave: marca, generar: (s) => vistaPrevia(cuerpo(s)) }),
  ];
  const enviar = async (s) => resultadoPlaca(await guardar({ texto: s.texto, fondo: s.fondo, titulo: s.titulo }, s.vista.token), `${s.titulo}\n\n${s.texto}`);
  return asistente({ pasos, enviar, textoEnviar: "Confirmar y generar", estado: inicial, ancho: 760 });
}

export function publicarAlertasPorPasos({ cambios, sinPublicar, iconosCambiaron, publicar }) {
  return asistente({
    estado: {}, textoEnviar: "Publicar en el mapa público",
    pasos: [{ pregunta: "Revisá los cambios", ayuda: "Al confirmar, el mapa público muestra este mapa.",
      html: () => `${htmlCambios({ cambios, sinPublicar })}${iconosCambiaron ? "<p>Cambiaron los fenómenos de la placa.</p>" : ""}` }],
    enviar: async () => { await publicar(); return { tipo: "ok", titulo: "¡Publicado!", datos: true, html: "<p>El mapa público ya muestra este mapa.</p>" }; },
  });
}
