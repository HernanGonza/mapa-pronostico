import { esc } from "./ui";
import { asistente, pasoVistaPrevia, htmlPlacaLista, pasoRepublicar, opciones, leerOpciones } from "./pasos";
import { htmlCambios } from "./pasosMapa";
import { publicarEnRedes } from "./publicarEnRedes";
import * as api from "../api";
import { CONDICIONES_POR_GRUPO, colorPorCondicion, condicionCanonica, esCondicionConocida } from "./condiciones";

/**
 * Asistentes de "Previsión del tiempo" (todo dentro de un modal, paso a paso):
 *  - cargarPronostico:        fecha y .docx → revisar y corregir las localidades → se aplica al mapa (borrador).
 *  - crearPlacaPronostico:    vista previa (pantalla completa) → confirmar y generar.
 *  - publicarPronosticoPorPasos: revisar los cambios → publicar en el mapa público.
 */
export const tempInvalida = (v) => {
  if (v == null || String(v).trim() === "") return true;
  const n = Number(v);
  return !Number.isInteger(n) || n < -15 || n > 55;
};
const ZONAS = ["Norte", "Centro", "Sur"];
export const filaInvalida = (r) => tempInvalida(r.TMIN) || tempInvalida(r.TMAX) || Number(r.TMIN) > Number(r.TMAX) || !esCondicionConocida(r.CONDICION);

const pasoArchivo = (parse) => ({
  pregunta: "¿De qué día es el pronóstico?", ayuda: "Elegí la fecha y subí el .docx que manda Alerta Temprana. Si ya hay un pronóstico cargado, podés seguir sin subir uno nuevo.",
  html: (s) => `<div class="paso-imagen"><label class="paso-etiqueta">Fecha del pronóstico<input type="date" class="paso-input" id="paso-fecha" value="${esc(s.fecha)}"></label>
      <label class="paso-etiqueta">Archivo .docx<input type="file" class="paso-input" id="paso-docx" accept=".docx"></label>
      <p class="paso-docx-estado" id="paso-docx-estado" role="status">${s.filas ? `${s.filas.length} localidades cargadas.` : "Todavía no se subió ningún archivo."}</p></div>`,
  alMostrar: (popup, s) => {
    const entrada = popup.querySelector("#paso-docx"), estado = popup.querySelector("#paso-docx-estado");
    entrada.addEventListener("change", async () => {
      const archivo = entrada.files?.[0];
      if (!archivo) return;
      estado.textContent = "Leyendo el archivo…";
      const boton = popup.querySelector(".swal2-confirm"); boton.disabled = true;
      try {
        const { filas, extendido } = await parse(archivo);
        // La zona viene de la tabla del .docx; si una localidad ya tenía otra asignada a mano, se respeta.
        const zonaAnterior = new Map((s.filas || []).filter((r) => r.ZONA).map((r) => [r.LOCALIDAD, r.ZONA]));
        s.filas = filas.map((r) => ({ ...r, ZONA: zonaAnterior.get(r.LOCALIDAD) || r.ZONA }));
        s.extendido = extendido || null;
        estado.textContent = `✓ ${filas.length} localidades leídas${extendido ? ", con pronóstico extendido" : ""}.`;
      } catch (e) { estado.textContent = `✗ ${e.message}`; entrada.value = ""; }
      finally { boton.disabled = false; }
    });
  },
  leer: (popup) => ({ fecha: popup.querySelector("#paso-fecha").value }),
  validar: (s) => (!s.fecha ? "Elegí la fecha del pronóstico." : !s.filas ? "Subí el archivo .docx del día." : null),
});

/** Opciones del <select> de condición, agrupadas por el color del mapa (como la leyenda). */
const htmlOpcionesCondicion = (elegida) => CONDICIONES_POR_GRUPO.map((g) => `<optgroup label="${esc(g.label)}">${g.condiciones.map((c) =>
  `<option value="${esc(c.nombre)}" ${c.nombre === elegida ? "selected" : ""}>${esc(c.etiqueta)}</option>`).join("")}</optgroup>`).join("");

const pasoLocalidades = {
  pregunta: "Revisá y corregí las localidades", ayuda: "Son los puntos que reporta el .docx; el resto de los municipios toma el dato del más cercano. Mínima y máxima en °C. La zona decide qué pronóstico extendido muestra la tarjeta de cada municipio.",
  html: (s) => `<div class="paso-tabla"><table class="paso-localidades"><thead><tr><th>Localidad</th><th>Mín</th><th>Máx</th><th>Condición</th><th>Zona</th></tr></thead><tbody>${s.filas.map((r, i) => `<tr>
      <td>${esc(r.LOCALIDAD)}</td>
      <td><input type="number" class="paso-celda" data-i="${i}" data-campo="TMIN" value="${esc(r.TMIN)}" aria-label="Mínima de ${esc(r.LOCALIDAD)}"></td>
      <td><input type="number" class="paso-celda" data-i="${i}" data-campo="TMAX" value="${esc(r.TMAX)}" aria-label="Máxima de ${esc(r.LOCALIDAD)}"></td>
      <td><div class="cond-cell"><span class="cond-swatch" data-swatch="${i}" style="background:${colorPorCondicion(r.CONDICION)}" aria-hidden="true"></span><select class="paso-select" data-i="${i}" data-campo="CONDICION" aria-label="Condición de ${esc(r.LOCALIDAD)}">${esCondicionConocida(r.CONDICION) ? "" : `<option value="">${esc(r.CONDICION || "(elegir)")} — sin reconocer</option>`}${htmlOpcionesCondicion(condicionCanonica(r.CONDICION))}</select></div></td>
      <td><select class="paso-select" data-i="${i}" data-campo="ZONA" aria-label="Zona de ${esc(r.LOCALIDAD)}">${ZONAS.includes(r.ZONA) ? "" : `<option value="">(elegir)</option>`}${ZONAS.map((z) => `<option value="${z}" ${z === r.ZONA ? "selected" : ""}>${z}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`,
  alMostrar: (popup) => {
    popup.querySelectorAll(".paso-celda").forEach((el) => el.addEventListener("input", () => el.classList.toggle("is-invalid", tempInvalida(el.value))));
    // El cuadradito de al lado muestra el color con que queda en el mapa.
    popup.querySelectorAll('[data-campo="CONDICION"]').forEach((el) => el.addEventListener("change", () => { popup.querySelector(`[data-swatch="${el.dataset.i}"]`).style.background = colorPorCondicion(el.value); }));
  },
  leer: (popup, s) => ({ filas: s.filas.map((r, i) => {
    const v = (campo) => popup.querySelector(`[data-i="${i}"][data-campo="${campo}"]`).value;
    return { ...r, TMIN: v("TMIN"), TMAX: v("TMAX"), CONDICION: v("CONDICION"), ZONA: v("ZONA") };
  }) }),
  validar: (s) => {
    const mala = s.filas.find(filaInvalida);
    if (mala) return `Revisá ${mala.LOCALIDAD}: temperaturas fuera de rango (−15 a 55), mínima mayor que la máxima o condición sin reconocer.`;
    const sinZona = s.filas.find((r) => !ZONAS.includes(r.ZONA));
    return sinZona ? `Elegí la zona de ${sinZona.LOCALIDAD} (norte, centro o sur).` : null;
  },
};

export function cargarPronostico({ filas, fecha, parse, aplicar }) {
  return asistente({
    // Ancho: la tabla de localidades (mín, máx, condición y zona) tiene que entrar entera.
    estado: { filas, fecha, extendido: null }, textoEnviar: "Aplicar al mapa", ancho: 1100,
    pasos: [pasoArchivo(parse), pasoLocalidades],
    enviar: async (s) => { aplicar({ filas: s.filas, fecha: s.fecha, extendido: s.extendido }); return { tipo: "ok", titulo: "Pronóstico cargado", datos: true,
      html: `<p>El mapa ya muestra el borrador con ${s.filas.length} localidades.${s.extendido ? " Este .docx también trae el pronóstico de 3 días: lo corregís en su pantalla." : ""} Cuando esté listo, tocá «Revisar y publicar».</p>` }; },
  });
}

/** La etiqueta de las condiciones del día: la del grupo que más localidades tiene (igual que el backend). */
export function etiquetaSugerida(filas = []) {
  const de = (c) => {
    const t = String(c || "").toLowerCase();
    if (/tormenta/.test(t)) return "tormenta";
    if (/lluvi|llovizn|chaparr/.test(t)) return "lluvia";
    if (/algo nublado/.test(t)) return "algo-nublado";
    if (/parcial/.test(t)) return "parcialmente-nublado";
    if (/nublado|cubierto/.test(t)) return "nublado";
    if (/despejado/.test(t)) return "despejado";
    return null;
  };
  const cuenta = {};
  for (const f of filas) { const e = de(f.CONDICION); if (e) cuenta[e] = (cuenta[e] || 0) + 1; }
  return Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0]?.[0] || "despejado";
}

/** Galería de fotos de fondo, con pestañas por condición (arranca en la del día). */
function pasoFoto(catalogo) {
  const textoDe = (id) => catalogo.etiquetas.find((e) => e.id === id)?.texto || id;
  return {
    pregunta: "¿Qué foto va de fondo?", ayuda: "Son las fotos de las placas diarias. Arranca en la condición que más se repite hoy; podés mirar las otras.",
    html: (s) => `<div class="paso-fondos">
        <div class="paso-fondos__tabs" role="group" aria-label="Condición">${catalogo.etiquetas.map((e) => `<button type="button" class="btn" data-tab="${e.id}" aria-pressed="${e.id === s.pestana}">${esc(e.texto)}</button>`).join("")}</div>
        <div class="paso-fondos__grid">${catalogo.fondos.map((f) => `<label class="paso-fondo" data-etiqueta="${f.etiqueta}" ${f.etiqueta === s.pestana ? "" : "hidden"}>
          <input type="radio" name="fondo" value="${f.id}" ${Number(s.fondo) === f.id ? "checked" : ""}><img src="${esc(api.urlFondoPronostico(f.id))}" alt="Foto ${f.id} · ${esc(textoDe(f.etiqueta))}" loading="lazy"></label>`).join("")}</div>
      </div>`,
    alMostrar: (popup, s) => {
      popup.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
        s.pestana = b.dataset.tab;
        popup.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        popup.querySelectorAll(".paso-fondo").forEach((el) => { el.hidden = el.dataset.etiqueta !== s.pestana; });
      }));
    },
    leer: (popup, s) => {
      const fondo = Number(leerOpciones(popup, "fondo")[0]) || null;
      const deLaFoto = catalogo.fondos.find((f) => f.id === fondo)?.etiqueta;
      // La etiqueta sigue a la foto, salvo que ya se haya elegido otra a mano.
      return { fondo, etiqueta: s.etiquetaAMano ? s.etiqueta : deLaFoto || s.etiqueta };
    },
    validar: (s) => (s.fondo ? null : "Elegí una foto."),
  };
}

function pasoEtiquetaYFrase(catalogo) {
  return {
    pregunta: "Etiqueta y frase del día", ayuda: "Van abajo, como en las placas diarias: la etiqueta con su ícono y una frase corta (opcional).",
    html: (s) => `<label class="paso-etiqueta">Etiqueta<select class="paso-select" id="paso-etiqueta-cond">${catalogo.etiquetas.map((e) => `<option value="${e.id}" ${e.id === s.etiqueta ? "selected" : ""}>${esc(e.texto)}</option>`).join("")}</select></label>
      <label class="paso-etiqueta">Frase<textarea class="paso-texto" id="paso-frase" maxlength="${catalogo.maxFrase}" rows="3" placeholder="Jornada con lluvias y tormentas fuertes y ráfagas intensas" data-foco>${esc(s.frase || "")}</textarea></label>`,
    leer: (popup, s) => {
      const etiqueta = popup.querySelector("#paso-etiqueta-cond").value;
      return { etiqueta, etiquetaAMano: s.etiquetaAMano || etiqueta !== s.etiqueta, frase: popup.querySelector("#paso-frase").value.trim() };
    },
  };
}

// Cómo van las tarjetas de cada localidad sobre el mapa (con un recorte de muestra de cada una).
const ESTILOS_TARJETA = [
  { valor: "oscura", titulo: "Vidrio oscuro", detalle: "Caja oscura semitransparente, letras blancas: se lee sobre cualquier color." },
  { valor: "sinCaja", titulo: "Sin caja", detalle: "Sólo el texto, con sombra: lo más liviano." },
  { valor: "clara", titulo: "Vidrio claro", detalle: "Caja blanca semitransparente." },
];
const pasoEstiloTarjetas = {
  pregunta: "¿Cómo van las tarjetas de las localidades?", ayuda: "Las de cada localidad sobre el mapa (ícono, mínima, máxima y condición).",
  html: (s) => `<div class="paso-estilos-tarjeta">${opciones({ nombre: "estilo", tipo: "radio", items: ESTILOS_TARJETA.map((e) => ({ ...e, img: `/placas/estilo-tarjeta-${e.valor}.jpg`, marcada: s.estiloTarjeta === e.valor })) })}</div>`,
  leer: (popup) => ({ estiloTarjeta: leerOpciones(popup, "estilo")[0] || "oscura" }),
};

/**
 * Placa del pronóstico sobre foto (estilo nuevo): foto → etiqueta y frase → estilo de las tarjetas →
 * vista previa → confirmar. `vistaPrevia(valores)` y `guardar(token, valores)`, con
 * valores = { fondo, etiqueta, frase, estiloTarjeta }.
 */
export async function crearPlacaPronostico({ vistaPrevia, guardar, epigrafe, filas = [] }) {
  const catalogo = await api.getFondosPronostico();
  const sugerida = etiquetaSugerida(filas);
  const valoresDe = (s) => ({ fondo: s.fondo, etiqueta: s.etiqueta, frase: s.frase || "", estiloTarjeta: s.estiloTarjeta });
  const pasos = [
    pasoFoto(catalogo),
    pasoEtiquetaYFrase(catalogo),
    pasoEstiloTarjetas,
    pasoVistaPrevia({ pregunta: "Así queda la placa del pronóstico", clave: (s) => JSON.stringify(valoresDe(s)), generar: (s) => vistaPrevia(valoresDe(s)) }),
  ];
  const enviar = async (s) => {
    const placa = await guardar(s.vista.token, valoresDe(s));
    return { tipo: "ok", titulo: "¡La placa está lista!", datos: placa, html: htmlPlacaLista(placa),
      accion: { texto: "Publicar en redes", alHacer: () => ({ cerrar: true, luego: () => publicarEnRedes({ feedUrl: placa.feedUrl, historiasUrl: placa.historiasUrl, epigrafe }) }) } };
  };
  return asistente({ pasos, enviar, textoEnviar: "Confirmar y generar", estado: { pestana: sugerida, etiqueta: sugerida, fondo: null, frase: "", estiloTarjeta: "oscura" }, ancho: 980 });
}

export function publicarPronosticoPorPasos({ cantidad, sinPublicar, fecha, fechaCambiada, cambios, republicar, publicar }) {
  const lista = (cambios || []).length
    ? `<p>Se van a actualizar <strong>${cambios.length}</strong> ${cambios.length === 1 ? "dato" : "datos"} del mapa público:</p><ul class="paso-cambios">${cambios.map((c) => `<li><strong>${esc(c.localidad)}</strong> · ${esc(c.campo)}: ${esc(c.de)} <span aria-hidden="true">→</span> ${esc(c.a)}</li>`).join("")}</ul>` : "";
  return asistente({
    estado: {}, textoEnviar: republicar ? "Republicar" : "Publicar en el mapa público",
    pasos: [republicar ? pasoRepublicar("el mismo pronóstico") : { pregunta: "Revisá los cambios", ayuda: "Al confirmar, el mapa público muestra esta versión.",
      html: () => `${sinPublicar ? `<p>Se publicará el primer pronóstico con ${cantidad} localidades.</p>` : ""}${fechaCambiada ? `<p>Fecha del pronóstico: <strong>${esc(fecha)}</strong>.</p>` : ""}${lista}` }],
    enviar: async () => { await publicar(); return { tipo: "ok", titulo: "¡Publicado!", datos: true, html: "<p>El mapa público ya muestra esta versión.</p>" }; },
  });
}

export function publicarExtendidoPorPasos({ republicar, publicar }) {
  return asistente({
    estado: {}, textoEnviar: republicar ? "Republicar" : "Publicar en el mapa público",
    pasos: [republicar ? pasoRepublicar("el mismo pronóstico de 3 días") : { pregunta: "¿Publicamos el pronóstico de 3 días?", ayuda: "Al confirmar, se actualiza el pronóstico de 3 días del mapa público con lo que ves en la vista previa.", html: () => "" }],
    enviar: async () => { await publicar(); return { tipo: "ok", titulo: "¡Publicado!", datos: true, html: "<p>El mapa público ya muestra esta versión.</p>" }; },
  });
}
