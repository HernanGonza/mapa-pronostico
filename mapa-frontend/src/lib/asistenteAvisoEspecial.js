import { asistente, opciones, leerOpciones, pasoVistaPrevia, htmlPlacaLista } from "./pasos";
import { esc } from "./ui";

/**
 * Crear la placa de un aviso especial, paso a paso dentro de un modal: título (dos líneas) →
 * nivel → texto → fecha y hora de emisión → captura de radar/satélite → vista previa →
 * confirmar y guardar → placa lista. Mismo estilo que las placas de las alertas: la 2.ª línea
 * del título va del color del nivel (sin nivel, blanca) y los íconos los pone la placa.
 * La página aporta:
 *   vistaPrevia(valores) → { token, feedUrl, historiasUrl }   (genera sin guardar)
 *   guardar(valores, token) → la placa guardada
 * valores = { titulo, subtitulo, nivel, texto, emitidoEn: "AAAA-MM-DDTHH:mm", imagen: File }
 */
export const MAX_TEXTO = 500;
const TIPOS = ["image/png", "image/jpeg"];
const MAX_BYTES = 15 * 1024 * 1024;

/** Date → "AAAA-MM-DDTHH:mm" en hora local, el formato de <input type="datetime-local">. */
export function valorLocal(d) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}
export const TITULO = "Aviso especial";
const MAX_TITULO = 40;
const NIVELES = [["", "Sin nivel", "Todo en blanco"], ["Amarillo", "Amarillo", ""], ["Naranja", "Naranja", ""], ["Rojo", "Rojo", ""]];
const COLOR_NIVEL = { Amarillo: "#FDE743", Naranja: "#F9881F", Rojo: "#F3162C" };
const valoresDe = (s) => ({ titulo: s.titulo, subtitulo: s.subtitulo, nivel: s.nivel, texto: s.texto, emitidoEn: s.emitidoEn, imagen: s.imagen });
// El File no se puede serializar: para saber si cambió alcanza con nombre + tamaño + fecha.
const claveDe = (s) => JSON.stringify([s.titulo, s.subtitulo, s.nivel, s.texto, s.emitidoEn, s.imagen && [s.imagen.name, s.imagen.size, s.imagen.lastModified]]);

function pasoImagen() {
  let miniatura = null; // object URL de la miniatura: se libera al cambiar de archivo
  return {
    pregunta: "Subí la captura de radar o satélite",
    ayuda: "JPG o PNG, de cualquier tamaño: se ajusta sola a la placa, sin recortarse.",
    html: (s) => `<div class="paso-captura">
        <input type="file" id="paso-imagen" class="paso-input" accept="image/png,image/jpeg" data-foco>
        <p class="paso-captura__nombre" id="paso-imagen-nombre">${s.imagen ? `Elegida: ${esc(s.imagen.name)}` : "Todavía no elegiste ninguna imagen."}</p>
        <img class="paso-captura__miniatura" id="paso-imagen-miniatura" alt="Captura elegida" hidden>
      </div>`,
    alMostrar: (popup, s) => {
      const input = popup.querySelector("#paso-imagen"), nombre = popup.querySelector("#paso-imagen-nombre"), img = popup.querySelector("#paso-imagen-miniatura");
      const ver = (archivo) => {
        if (miniatura) URL.revokeObjectURL(miniatura);
        miniatura = archivo ? URL.createObjectURL(archivo) : null;
        img.hidden = !miniatura; if (miniatura) img.src = miniatura;
      };
      ver(s.imagen);
      input.addEventListener("change", () => {
        const archivo = input.files[0];
        nombre.textContent = archivo ? `Elegida: ${archivo.name}` : "Todavía no elegiste ninguna imagen.";
        ver(archivo);
      });
    },
    // Si no se eligió otra, queda la que ya estaba (volver atrás no la pierde).
    leer: (popup) => { const archivo = popup.querySelector("#paso-imagen").files[0]; return archivo ? { imagen: archivo } : {}; },
    validar: (s) => {
      if (!s.imagen) return "Elegí la imagen de radar o satélite.";
      if (!TIPOS.includes(s.imagen.type)) return "La imagen tiene que ser JPG o PNG.";
      if (s.imagen.size > MAX_BYTES) return "La imagen supera los 15 MB.";
      return null;
    },
  };
}

export function crearAvisoEspecialPorPasos({ inicial = {}, vistaPrevia, guardar }) {
  const pasos = [
    { pregunta: "¿Qué dice el título?", ayuda: "Va arriba, en mayúsculas. La segunda línea es opcional y sale del color del nivel (paso siguiente).",
      html: (s) => `<label class="paso-etiqueta">Primera línea (blanca)<input class="paso-input" id="paso-titulo" maxlength="${MAX_TITULO}" value="${esc(s.titulo)}" placeholder="Aviso especial" data-foco></label>
        <label class="paso-etiqueta">Segunda línea (en color, opcional)<input class="paso-input" id="paso-subtitulo" maxlength="${MAX_TITULO}" value="${esc(s.subtitulo)}" placeholder="Por tormentas"></label>`,
      leer: (popup) => ({ titulo: popup.querySelector("#paso-titulo").value.trim(), subtitulo: popup.querySelector("#paso-subtitulo").value.trim() }),
      validar: (s) => (s.titulo ? null : "Escribí la primera línea del título.") },
    { pregunta: "¿De qué nivel es?", ayuda: "Pinta la segunda línea del título. Si el aviso no corresponde a una alerta, elegí «Sin nivel».",
      html: (s) => `<div class="paso-niveles">${opciones({ nombre: "nivel", tipo: "radio", items: NIVELES.map(([valor, titulo, detalle]) => ({ valor, titulo, detalle, marcada: s.nivel === valor })) })}</div>`,
      alMostrar: (popup) => popup.querySelectorAll(".paso-niveles .paso-opcion").forEach((el, i) => el.style.setProperty("--nivel", COLOR_NIVEL[NIVELES[i][0]] || "#ffffff")),
      leer: (popup) => ({ nivel: leerOpciones(popup, "nivel")[0] ?? "" }) },
    { pregunta: "Escribí el aviso", ayuda: `Texto libre, hasta ${MAX_TEXTO} caracteres: va con la nube de tormenta al lado. La letra se ajusta sola: cuanto más corto, más grande se lee.`,
      html: (s) => `<textarea class="paso-texto" id="paso-texto" maxlength="${MAX_TEXTO}" rows="6" placeholder="Ej.: Se están formando tormentas fuertes en Paraguay que avanzan en dirección a Misiones…" data-foco>${esc(s.texto)}</textarea><p class="paso-contador-texto" id="paso-texto-contador"></p>`,
      alMostrar: (popup) => { const a = popup.querySelector("#paso-texto"), c = popup.querySelector("#paso-texto-contador"); const act = () => { c.textContent = `${a.value.length}/${MAX_TEXTO} caracteres`; }; a.addEventListener("input", act); act(); },
      leer: (popup) => ({ texto: popup.querySelector("#paso-texto").value }),
      validar: (s) => (s.texto.trim() ? null : "Escribí el texto del aviso.") },
    { pregunta: "¿Cuándo se emite?", ayuda: "Sale con el reloj al lado: «Aviso emitido el DD/MM/AAAA a las HH:MMhs.».",
      html: (s) => `<label class="paso-etiqueta">Fecha y hora de emisión<input type="datetime-local" class="paso-input" id="paso-emitido" value="${esc(s.emitidoEn)}" data-foco></label>
        <div class="paso-vigencia__rapidas"><button type="button" class="btn" data-ahora>Ahora</button></div>`,
      alMostrar: (popup) => popup.querySelector("[data-ahora]").addEventListener("click", () => { popup.querySelector("#paso-emitido").value = valorLocal(new Date()); }),
      leer: (popup) => ({ emitidoEn: popup.querySelector("#paso-emitido").value }),
      validar: (s) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.emitidoEn || "") ? null : "Elegí la fecha y la hora.") },
    pasoImagen(),
    pasoVistaPrevia({ clave: claveDe, generar: (s) => vistaPrevia(valoresDe(s)) }),
  ];

  const enviar = async (s) => {
    const placa = await guardar(valoresDe(s), s.vista.token);
    return { tipo: "ok", titulo: "¡La placa está lista!", datos: placa,
      html: `${htmlPlacaLista(placa)}<p>Quedó guardada. Para redes, usá «Publicar en redes» en la vista de la placa.</p>` };
  };

  return asistente({ pasos, enviar, textoEnviar: "Confirmar y generar", estado: { titulo: TITULO, subtitulo: "", nivel: "", texto: "", emitidoEn: valorLocal(new Date()), imagen: null, ...inicial }, ancho: 760 });
}
