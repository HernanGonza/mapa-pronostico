import { asistente, opciones, leerOpciones, pasoVistaPrevia, htmlPlacaLista } from "./pasos";
import { esc } from "./ui";
import * as api from "../api";

/**
 * Crear la placa de un aviso especial, paso a paso dentro de un modal: título (dos líneas) →
 * nivel → texto → fecha y hora de emisión → fondo → captura de radar/satélite (opcional) → vista previa →
 * confirmar y guardar → placa lista. Mismo estilo que las placas de las alertas: la 2.ª línea
 * del título va del color del nivel (sin nivel, blanca) y los íconos los pone la placa.
 * La página aporta:
 *   vistaPrevia(valores) → { token, feedUrl, historiasUrl }   (genera sin guardar)
 *   guardar(valores, token) → la placa guardada
 * valores = { titulo, subtitulo, nivel, texto, emitidoEn: "AAAA-MM-DDTHH:mm", imagen: File | null, fondo: "rayos" | id de una foto del pronóstico }
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
const valoresDe = (s) => ({ titulo: s.titulo, subtitulo: s.subtitulo, nivel: s.nivel, texto: s.texto, emitidoEn: s.emitidoEn, fondo: s.fondo, imagen: s.imagen });
// El File no se puede serializar: para saber si cambió alcanza con nombre + tamaño + fecha.
const claveDe = (s) => JSON.stringify([s.titulo, s.subtitulo, s.nivel, s.texto, s.emitidoEn, s.fondo, s.imagen && [s.imagen.name, s.imagen.size, s.imagen.lastModified]]);

// Los fondos: los rayos de siempre y las 33 fotos de las placas del pronóstico, agrupadas por condición (como vienen numeradas).
const GRUPOS_FOTOS = [["tormenta", "Tormenta", 1, 5], ["lluvia", "Lluvia", 6, 11], ["algo-nublado", "Algo nublado", 12, 17], ["parcialmente-nublado", "Parcialmente nublado", 18, 22], ["nublado", "Nublado", 23, 27], ["despejado", "Despejado", 28, 33]];
const GRUPO_DE = (id) => GRUPOS_FOTOS.find(([, , d, h]) => id >= d && id <= h)?.[0];

function pasoFondo() {
  return {
    pregunta: "¿Qué fondo lleva?", ayuda: "Los rayos de siempre o cualquiera de las fotos de las placas del pronóstico.",
    html: (s) => `<div class="paso-fondos">
        <div class="paso-fondos__tabs" role="group" aria-label="Tipo de fondo">${[["rayos", "Rayos"], ...GRUPOS_FOTOS.map(([g, n]) => [g, n])].map(([g, n]) => `<button type="button" class="btn" data-tab="${g}" aria-pressed="${g === s.pestanaFondo}">${n}</button>`).join("")}</div>
        <div class="paso-fondos__grid">
          <label class="paso-fondo" data-grupo="rayos" ${s.pestanaFondo === "rayos" ? "" : "hidden"}><input type="radio" name="fondo" value="rayos" ${s.fondo === "rayos" ? "checked" : ""}><img src="${esc(api.urlFondoRayos)}" alt="Rayos (el de siempre)" loading="lazy"></label>
          ${GRUPOS_FOTOS.flatMap(([g, n, d, h]) => Array.from({ length: h - d + 1 }, (_, i) => d + i).map((id) => `<label class="paso-fondo" data-grupo="${g}" ${g === s.pestanaFondo ? "" : "hidden"}>
            <input type="radio" name="fondo" value="${id}" ${String(s.fondo) === String(id) ? "checked" : ""}><img src="${esc(api.urlFondoPronostico(id))}" alt="Foto ${id} · ${n}" loading="lazy"></label>`)).join("")}
        </div></div>`,
    alMostrar: (popup, s) => popup.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      s.pestanaFondo = b.dataset.tab;
      popup.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      popup.querySelectorAll(".paso-fondo").forEach((el) => { el.hidden = el.dataset.grupo !== s.pestanaFondo; });
    })),
    leer: (popup) => ({ fondo: leerOpciones(popup, "fondo")[0] || "rayos" }),
  };
}

function pasoImagen() {
  let miniatura = null; // object URL de la miniatura: se libera al cambiar de archivo
  return {
    pregunta: "¿Querés sumar una captura de radar o satélite?",
    ayuda: "Es opcional: sin captura el texto ocupa toda la placa, con letra más grande. JPG o PNG, de cualquier tamaño: se ajusta sola, sin recortarse.",
    html: (s) => `<div class="paso-captura">
        <input type="file" id="paso-imagen" class="paso-input" accept="image/png,image/jpeg" data-foco>
        <p class="paso-captura__nombre" id="paso-imagen-nombre">${s.imagen ? `Elegida: ${esc(s.imagen.name)}` : "Sin captura: la placa lleva sólo el texto."}</p>
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
        nombre.textContent = archivo ? `Elegida: ${archivo.name}` : "Sin captura: la placa lleva sólo el texto.";
        ver(archivo);
      });
    },
    // Si no se eligió otra, queda la que ya estaba (volver atrás no la pierde).
    leer: (popup) => { const archivo = popup.querySelector("#paso-imagen").files[0]; return archivo ? { imagen: archivo } : {}; },
    validar: (s) => {
      if (!s.imagen) return null; // la captura es opcional
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
    pasoFondo(),
    pasoImagen(),
    pasoVistaPrevia({ clave: claveDe, generar: (s) => vistaPrevia(valoresDe(s)) }),
  ];

  const enviar = async (s) => {
    const placa = await guardar(valoresDe(s), s.vista.token);
    return { tipo: "ok", titulo: "¡La placa está lista!", datos: placa,
      html: `${htmlPlacaLista(placa)}<p>Quedó guardada. Para redes, usá «Publicar en redes» en la vista de la placa.</p>` };
  };

  return asistente({ pasos, enviar, textoEnviar: "Confirmar y generar", estado: { titulo: TITULO, subtitulo: "", nivel: "", texto: "", emitidoEn: valorLocal(new Date()), imagen: null, fondo: "rayos", ...inicial, pestanaFondo: GRUPO_DE(Number(inicial.fondo)) || "rayos" }, ancho: 760 });
}
