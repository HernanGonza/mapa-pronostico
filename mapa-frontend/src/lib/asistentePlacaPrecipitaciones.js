import { asistente, leerOpciones, pasoVistaPrevia, htmlPlacaLista } from "./pasos";
import { esc } from "./ui";
import * as api from "../api";

/**
 * Placa «Monitoreo de precipitaciones» paso a paso (en un modal): período → datos de cada estación → foto de fondo →
 * vista previa → confirmar y guardar. Es editable el período, la 2.ª línea del título, los datos y la foto. NO se puede
 * sacar ni apagar la marca de agua ni la leyenda «Datos recopilados por la Dirección General de Alerta Temprana»: las
 * pone siempre el servidor.
 * La pantalla aporta:
 *   vistaPrevia(valores) → { token, feedUrl, historiasUrl }   (genera sin guardar)
 *   guardar(valores, token) → la placa guardada
 * valores = { subtitulo, periodo, fondo, columnas: { media, anomalia }, filas: [{ nombre, nota, periodo, mes, media, anomalia }] }
 */
const NOTAS = { "": "—", 1: "SMN", 2: "INTA", 3: "Automática", 4: "Red Matteo" };
const FONDOS = { lluvia: [6, 7, 8, 9, 10, 11], tormenta: [1, 2, 3, 4, 5] };
const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const dm = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

/**
 * «13/10» (un día), «8 AL 13/10» (mismo mes) o «28/09 AL 03/10». Con horas, «20/10 09:00hs a 21/10 09:00hs».
 */
export function periodoDe(desde, hasta, horaDesde = "", horaHasta = "") {
  if (!desde) return "";
  if (horaDesde && horaHasta && hasta) return `${dm(desde)} ${horaDesde}hs a ${dm(hasta)} ${horaHasta}hs`;
  if (!hasta || hasta === desde) return dm(desde);
  return desde.slice(5, 7) === hasta.slice(5, 7) ? `${Number(desde.slice(8, 10))} AL ${dm(hasta)}` : `${dm(desde)} AL ${dm(hasta)}`;
}
/** «PROVINCIA DE MISIONES · OCTUBRE 2026» con el mes del final del período. */
export const subtituloDe = (hasta) => (hasta ? `Provincia de Misiones · ${MESES[Number(hasta.slice(5, 7)) - 1].toLowerCase().replace(/^./, (c) => c.toUpperCase())} ${hasta.slice(0, 4)}` : "Provincia de Misiones");
const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return v === "" || v == null || !Number.isFinite(n) ? null : n; };
const columnasPorDefecto = { media: true, anomalia: true };
const columnasDe = (s) => ({ ...columnasPorDefecto, ...(s.columnas || {}) });
const claveDe = (s) => JSON.stringify([s.subtitulo, s.periodo, s.fondo, columnasDe(s), s.filas]);
const valoresDe = (s) => ({ subtitulo: s.subtitulo, periodo: s.periodo, fondo: s.fondo, columnas: columnasDe(s), filas: s.filas });

const filaHtml = (f = {}) => `<tr>
  <td><input class="paso-input" data-c="nombre" maxlength="40" value="${esc(f.nombre ?? "")}" placeholder="Estación" aria-label="Estación"></td>
  <td><select class="paso-input" data-c="nota" aria-label="Red">${Object.entries(NOTAS).map(([v, t]) => `<option value="${v}" ${String(f.nota ?? "") === v ? "selected" : ""}>${t}</option>`).join("")}</select></td>
  <td><input class="paso-input" data-c="periodo" inputmode="decimal" value="${esc(f.periodo ?? "")}" aria-label="Lluvia del período (mm)"></td>
  <td><input class="paso-input" data-c="mes" inputmode="decimal" value="${esc(f.mes ?? "")}" aria-label="Acumulado del mes (mm)"></td>
  <td><input class="paso-input" data-c="media" inputmode="decimal" value="${esc(f.media ?? "")}" aria-label="Media del mes (mm)"></td>
  <td><input class="paso-input" data-c="anomalia" inputmode="decimal" value="${esc(f.anomalia ?? "")}" placeholder="auto" aria-label="Anomalía (mm)"></td>
  <td><button type="button" class="btn btn--ghost" data-quitar aria-label="Quitar la estación" title="Quitar">✕</button></td></tr>`;
const leerFilas = (popup) => [...popup.querySelectorAll(".paso-estaciones tbody tr")].map((tr) => Object.fromEntries([...tr.querySelectorAll("[data-c]")].map((i) => [i.dataset.c, i.value.trim()])));

function pasoPeriodo() {
  return {
    pregunta: "¿Qué período cubre la placa?",
    ayuda: "Puede ser de un solo día: poné la misma fecha en las dos. Si la lluvia se midió entre dos horas (por ejemplo de hoy a las 9:00 a mañana a las 9:00), poné las dos horas; si no, dejalas vacías. El texto del encabezado de la columna se arma solo, pero lo podés corregir.",
    html: (s) => `<div class="paso-periodo">
        <label class="paso-etiqueta">Desde<input type="date" class="paso-input" id="p-desde" value="${esc(s.desde)}" data-foco></label>
        <label class="paso-etiqueta">Hora desde (opcional)<input type="time" class="paso-input" id="p-hdesde" value="${esc(s.horaDesde || "")}"></label>
        <label class="paso-etiqueta">Hasta<input type="date" class="paso-input" id="p-hasta" value="${esc(s.hasta)}"></label>
        <label class="paso-etiqueta">Hora hasta (opcional)<input type="time" class="paso-input" id="p-hhasta" value="${esc(s.horaHasta || "")}"></label>
        <label class="paso-etiqueta">Cómo se ve en la columna<input class="paso-input" id="p-periodo" maxlength="32" value="${esc(s.periodo)}" placeholder="8 AL 13/10"></label>
        <label class="paso-etiqueta">Segunda línea del título<input class="paso-input" id="p-sub" maxlength="48" value="${esc(s.subtitulo)}"></label></div>`,
    alMostrar: (popup, s) => {
      const d = popup.querySelector("#p-desde"), h = popup.querySelector("#p-hasta"), p = popup.querySelector("#p-periodo"), sub = popup.querySelector("#p-sub"), hd = popup.querySelector("#p-hdesde"), hh = popup.querySelector("#p-hhasta");
      let manual = !!s.periodo && s.periodo !== periodoDe(s.desde, s.hasta, s.horaDesde, s.horaHasta), subManual = !!s.subtitulo && s.subtitulo !== subtituloDe(s.hasta);
      p.addEventListener("input", () => { manual = true; }); sub.addEventListener("input", () => { subManual = true; });
      const auto = () => { if (h.value < d.value) h.value = d.value; if (!manual) p.value = periodoDe(d.value, h.value, hd.value, hh.value); if (!subManual) sub.value = subtituloDe(h.value); };
      d.addEventListener("change", auto); h.addEventListener("change", auto); hd.addEventListener("change", auto); hh.addEventListener("change", auto);
    },
    leer: (popup) => ({ desde: popup.querySelector("#p-desde").value, hasta: popup.querySelector("#p-hasta").value, horaDesde: popup.querySelector("#p-hdesde").value, horaHasta: popup.querySelector("#p-hhasta").value, periodo: popup.querySelector("#p-periodo").value.trim(), subtitulo: popup.querySelector("#p-sub").value.trim() }),
    validar: (s) => (!s.desde || !s.hasta ? "Elegí las fechas." : !s.horaDesde !== !s.horaHasta ? "Poné las dos horas o ninguna." : !s.periodo ? "Escribí el período." : !s.subtitulo ? "Escribí la segunda línea del título." : null),
  };
}

function pasoEstaciones() {
  return {
    pregunta: "Revisá los datos de cada estación",
    ayuda: "Vienen del informe: corregí lo que haga falta, sacá o sumá estaciones. En «Acumulados del mes» va lo acumulado hasta la fecha; la anomalía se calcula sola (acumulado − media) si la dejás vacía. Elegí si la placa incluye media y anomalía.",
    html: (s) => `<div class="paso-estaciones"><fieldset class="paso-columnas"><legend>Columnas de la placa</legend>
        <label><input type="checkbox" data-columna="media" ${columnasDe(s).media ? "checked" : ""}> Media</label>
        <label><input type="checkbox" data-columna="anomalia" ${columnasDe(s).anomalia ? "checked" : ""}> Anomalía</label>
      </fieldset><table class="paso-localidades"><thead><tr><th>Estación</th><th>Red</th><th>Período (mm)</th><th>Acumulados del mes</th><th>Media</th><th>Anomalía</th><th></th></tr></thead>
        <tbody>${s.filas.map(filaHtml).join("")}</tbody></table>
        <button type="button" class="btn" data-sumar>+ Agregar estación</button></div>`,
    alMostrar: (popup) => {
      const cuerpo = popup.querySelector(".paso-estaciones tbody");
      popup.querySelector("[data-sumar]").addEventListener("click", () => { cuerpo.insertAdjacentHTML("beforeend", filaHtml()); cuerpo.lastElementChild.querySelector("input").focus(); });
      cuerpo.addEventListener("click", (e) => { e.target.closest("[data-quitar]")?.closest("tr").remove(); });
    },
    leer: (popup) => ({ filas: leerFilas(popup), columnas: Object.fromEntries([...popup.querySelectorAll("[data-columna]")].map((i) => [i.dataset.columna, i.checked])) }),
    validar: (s) => {
      if (!s.filas.length) return "Dejá al menos una estación.";
      for (const f of s.filas) {
        if (!f.nombre) return "Falta el nombre de una estación.";
        for (const c of ["periodo", "mes", "media", "anomalia"]) if (f[c] !== "" && num(f[c]) == null) return `«${f.nombre}»: ${c === "periodo" ? "la lluvia del período" : c} no es un número.`;
        if (num(f.periodo) == null) return `Falta la lluvia del período de «${f.nombre}».`;
      }
      return s.filas.length > 24 ? "La placa admite hasta 24 estaciones." : null;
    },
  };
}

function pasoFondo() {
  const nombre = { lluvia: "Lluvia", tormenta: "Tormenta" };
  return {
    pregunta: "¿Qué foto va de fondo?", ayuda: "Son las fotos de lluvia y de tormenta de las placas del pronóstico.",
    html: (s) => `<div class="paso-fondos">
        <div class="paso-fondos__tabs" role="group" aria-label="Tipo de foto">${Object.keys(FONDOS).map((g) => `<button type="button" class="btn" data-tab="${g}" aria-pressed="${g === s.pestana}">${nombre[g]}</button>`).join("")}</div>
        <div class="paso-fondos__grid">${Object.entries(FONDOS).flatMap(([g, ids]) => ids.map((id) => `<label class="paso-fondo" data-grupo="${g}" ${g === s.pestana ? "" : "hidden"}>
          <input type="radio" name="fondo" value="${id}" ${Number(s.fondo) === id ? "checked" : ""}><img src="${esc(api.urlFondoPronostico(id))}" alt="Foto ${id} · ${nombre[g]}" loading="lazy"></label>`)).join("")}</div></div>`,
    alMostrar: (popup, s) => popup.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      s.pestana = b.dataset.tab;
      popup.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      popup.querySelectorAll(".paso-fondo").forEach((el) => { el.hidden = el.dataset.grupo !== s.pestana; });
    })),
    leer: (popup) => ({ fondo: Number(leerOpciones(popup, "fondo")[0]) || null }),
    validar: (s) => (s.fondo ? null : "Elegí una foto."),
  };
}

/** `inicial`: { desde, hasta, filas } (lo que sale del informe); el resto se arma solo. */
export function crearPlacaPrecipitacionesPorPasos({ inicial = {}, vistaPrevia, guardar }) {
  const estado = { desde: "", hasta: "", horaDesde: "", horaHasta: "", periodo: "", subtitulo: "", fondo: FONDOS.lluvia[0], pestana: "lluvia", filas: [], columnas: columnasPorDefecto, ...inicial };
  estado.columnas = columnasDe(estado);
  if (!estado.periodo) estado.periodo = periodoDe(estado.desde, estado.hasta);
  if (!estado.subtitulo) estado.subtitulo = subtituloDe(estado.hasta);
  const pasos = [
    pasoPeriodo(), pasoEstaciones(), pasoFondo(),
    pasoVistaPrevia({ ayuda: "Revisala. La marca de agua y la leyenda «Datos recopilados por la Dirección General de Alerta Temprana» van siempre: así se evita que se use la placa sin el origen.", clave: claveDe, generar: (s) => vistaPrevia(valoresDe(s)) }),
  ];
  const enviar = async (s) => {
    const placa = await guardar(valoresDe(s), s.vista.token);
    return { tipo: "ok", titulo: "¡La placa está lista!", datos: placa, html: `${htmlPlacaLista(placa)}<p>Quedó guardada. Para redes, usá «Publicar en redes» en el informe.</p>` };
  };
  return asistente({ pasos, enviar, textoEnviar: "Confirmar y generar", estado, ancho: 900 });
}
