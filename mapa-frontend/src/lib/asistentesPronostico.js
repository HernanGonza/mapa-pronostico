import { esc } from "./ui";
import { asistente, pasoVistaPrevia, htmlPlacaLista } from "./pasos";
import { htmlCambios } from "./pasosMapa";
import { publicarEnRedes } from "./publicarEnRedes";
import { CONDICIONES_CANONICAS, condicionCanonica, esCondicionConocida } from "./condiciones";

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
        s.filas = filas; s.extendido = extendido || null;
        estado.textContent = `✓ ${filas.length} localidades leídas${extendido ? ", con pronóstico extendido" : ""}.`;
      } catch (e) { estado.textContent = `✗ ${e.message}`; entrada.value = ""; }
      finally { boton.disabled = false; }
    });
  },
  leer: (popup) => ({ fecha: popup.querySelector("#paso-fecha").value }),
  validar: (s) => (!s.fecha ? "Elegí la fecha del pronóstico." : !s.filas ? "Subí el archivo .docx del día." : null),
});

const pasoLocalidades = {
  pregunta: "Revisá y corregí las localidades", ayuda: "Son los puntos que reporta el .docx; el resto de los municipios toma el dato del más cercano. Mínima y máxima en °C.",
  html: (s) => `<div class="paso-tabla"><table class="paso-localidades"><thead><tr><th>Localidad</th><th>Mín</th><th>Máx</th><th>Condición</th></tr></thead><tbody>${s.filas.map((r, i) => `<tr>
      <td>${esc(r.LOCALIDAD)}</td>
      <td><input type="number" class="paso-celda" data-i="${i}" data-campo="TMIN" value="${esc(r.TMIN)}" aria-label="Mínima de ${esc(r.LOCALIDAD)}"></td>
      <td><input type="number" class="paso-celda" data-i="${i}" data-campo="TMAX" value="${esc(r.TMAX)}" aria-label="Máxima de ${esc(r.LOCALIDAD)}"></td>
      <td><select class="paso-select" data-i="${i}" data-campo="CONDICION" aria-label="Condición de ${esc(r.LOCALIDAD)}">${esCondicionConocida(r.CONDICION) ? "" : `<option value="">${esc(r.CONDICION || "(elegir)")} — sin reconocer</option>`}${CONDICIONES_CANONICAS.map((c) => `<option value="${esc(c)}" ${c === condicionCanonica(r.CONDICION) ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`,
  alMostrar: (popup) => {
    popup.querySelectorAll(".paso-celda").forEach((el) => el.addEventListener("input", () => el.classList.toggle("is-invalid", tempInvalida(el.value))));
  },
  leer: (popup, s) => ({ filas: s.filas.map((r, i) => {
    const v = (campo) => popup.querySelector(`[data-i="${i}"][data-campo="${campo}"]`).value;
    return { ...r, TMIN: v("TMIN"), TMAX: v("TMAX"), CONDICION: v("CONDICION") };
  }) }),
  validar: (s) => {
    const mala = s.filas.find(filaInvalida);
    return mala ? `Revisá ${mala.LOCALIDAD}: temperaturas fuera de rango (−15 a 55), mínima mayor que la máxima o condición sin reconocer.` : null;
  },
};

export function cargarPronostico({ filas, fecha, parse, aplicar }) {
  return asistente({
    estado: { filas, fecha, extendido: null }, textoEnviar: "Aplicar al mapa", ancho: 760,
    pasos: [pasoArchivo(parse), pasoLocalidades],
    enviar: async (s) => { aplicar({ filas: s.filas, fecha: s.fecha, extendido: s.extendido }); return { tipo: "ok", titulo: "Pronóstico cargado", datos: true,
      html: `<p>El mapa ya muestra el borrador con ${s.filas.length} localidades.${s.extendido ? " Este .docx también trae el pronóstico de 3 días: lo corregís en su pantalla." : ""} Cuando esté listo, tocá «Revisar y publicar».</p>` }; },
  });
}

export function crearPlacaPronostico({ vistaPrevia, guardar, epigrafe }) {
  const pasos = [pasoVistaPrevia({ pregunta: "Así queda la placa del pronóstico", clave: () => "unica", generar: vistaPrevia })];
  const enviar = async (s) => {
    const placa = await guardar(s.vista.token);
    return { tipo: "ok", titulo: "¡La placa está lista!", datos: placa, html: htmlPlacaLista(placa),
      accion: { texto: "Publicar en redes", alHacer: () => ({ cerrar: true, luego: () => publicarEnRedes({ feedUrl: placa.feedUrl, historiasUrl: placa.historiasUrl, epigrafe }) }) } };
  };
  return asistente({ pasos, enviar, textoEnviar: "Confirmar y generar", estado: {}, ancho: 760 });
}

export function publicarPronosticoPorPasos({ cantidad, sinPublicar, fecha, fechaCambiada, cambios, publicar }) {
  const lista = (cambios || []).length
    ? `<p>Se van a actualizar <strong>${cambios.length}</strong> ${cambios.length === 1 ? "dato" : "datos"} del mapa público:</p><ul class="paso-cambios">${cambios.map((c) => `<li><strong>${esc(c.localidad)}</strong> · ${esc(c.campo)}: ${esc(c.de)} <span aria-hidden="true">→</span> ${esc(c.a)}</li>`).join("")}</ul>` : "";
  return asistente({
    estado: {}, textoEnviar: "Publicar en el mapa público",
    pasos: [{ pregunta: "Revisá los cambios", ayuda: "Al confirmar, el mapa público muestra esta versión.",
      html: () => `${sinPublicar ? `<p>Se publicará el primer pronóstico con ${cantidad} localidades.</p>` : ""}${fechaCambiada ? `<p>Fecha del pronóstico: <strong>${esc(fecha)}</strong>.</p>` : ""}${lista}` }],
    enviar: async () => { await publicar(); return { tipo: "ok", titulo: "¡Publicado!", datos: true, html: "<p>El mapa público ya muestra esta versión.</p>" }; },
  });
}

export function publicarExtendidoPorPasos({ publicar }) {
  return asistente({
    estado: {}, textoEnviar: "Publicar en el mapa público",
    pasos: [{ pregunta: "¿Publicamos el pronóstico de 3 días?", ayuda: "Al confirmar, se actualiza el pronóstico de 3 días del mapa público con lo que ves en la vista previa.", html: () => "" }],
    enviar: async () => { await publicar(); return { tipo: "ok", titulo: "¡Publicado!", datos: true, html: "<p>El mapa público ya muestra esta versión.</p>" }; },
  });
}
