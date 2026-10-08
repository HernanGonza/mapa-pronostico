import { asistente, opciones, leerOpciones, pasoVistaPrevia, htmlPlacaLista } from "./pasos";
import { valorLocal } from "./asistenteAvisoEspecial";
import { crearPlacaMapaAlertas } from "./asistentesAlertas";
import { esc } from "./ui";
import * as api from "../api";
import { enFemenino } from "./nivelAlerta.js";

/**
 * Placas de una alerta ya publicada, desde su tarjeta en la pila del panel (ver
 * generatePlacasAlerta.js en el backend). Las tres arrancan eligiendo el nivel (viene el de la
 * alerta: el más alto de sus departamentos) y terminan con vista previa → confirmar:
 *  - cambiarVigenciaPorPasos: zonas con su horario → hasta cuándo se ve en el mapa → texto → nota.
 *      Al confirmar se corre la vigencia de la alerta (el mapa no se toca) y se guarda la placa
 *      «Actualización de vigencia».
 *  - recomendacionesPorPasos: fenómeno del título → lista de recomendaciones (+ para agregar, − para
 *      sacar, cada una con un ícono de los dibujados o uno subido).
 *  - avisoDeAlertaPorPasos: fenómeno, vigencia y zona → texto → nota.
 *  - actualizacionNivelPorPasos: de qué nivel venía → fenómeno y zona → día y horario → texto.
 * Cada asistente arranca con lo último que se usó en esa placa (de cualquier alerta).
 */
// `pub` puede ser una alerta automática del SMN (`pub.smn`, la arma SmnAlertas): los mismos asistentes, pero
// hablando con las rutas de esas alertas (`pub._api`) y arrancando con lo que trae el SMN.
const A = (pub) => pub?._api || api;
const NIVELES = ["Amarillo", "Naranja", "Rojo"];
const ORDEN = { Verde: 0, Gris: 0, Amarillo: 1, Naranja: 2, Rojo: 3 };
const NOMBRE_ICONO = { objetos: "Silla y viento", arroyos: "Auto y arroyo", resguardo: "Casa segura", informado: "Celular", emergencias: "Teléfono 911", reloj: "Reloj", ubicacion: "Ubicación", tormenta: "Tormenta", alerta: "Alerta (!)" };
// Fenómenos del mapa → cómo se leen en el título («ALERTA POR TORMENTA»).
const FENOMENO = { tormentas: "tormenta", "tormentas-severas": "tormentas severas", "vientos-fuertes": "vientos fuertes", granizo: "granizo", inundacion: "inundación", "lluvias-intensas": "lluvias intensas" };

/** Nivel del mapa de una publicación: el más alto de sus departamentos (Amarillo si están todos en verde). */
export function nivelDelMapa(pub) {
  if (pub?.smn && NIVELES.includes(pub.categoria)) return pub.categoria;
  const max = (pub?.zonasBase || pub?.zonas || []).map((z) => z.categoria).reduce((a, b) => ((ORDEN[b] || 0) > (ORDEN[a] || 0) ? b : a), "Amarillo");
  return NIVELES.includes(max) ? max : "Amarillo";
}

/** Inicio y fin (Date, hora de acá) de la vigencia de una «Actualización de nivel»; 24:00 = medianoche siguiente. */
function ventanaDeNivel({ fecha, desde, hasta }) {
  const [a, m, d] = fecha.split("-").map(Number), hora = (h) => h.split(":").map(Number);
  const [h1, m1] = hora(desde), [h2, m2] = hora(hasta);
  const inicio = new Date(a, m - 1, d, h1, m1);
  let fin = new Date(a, m - 1, d, h2, m2);
  if (fin <= inicio) fin = new Date(fin.getTime() + 24 * 3600e3); // ej. de 22:00 a 06:00
  return { inicio, fin };
}
/** Las «Actualización de nivel» de la alerta, con su ventana, la más nueva primero. */
const cambiosDeNivel = (pub) => (pub?.placas || []).filter((p) => p.tipo === "nivel" && p.datos?.vigencia)
  .map((p) => ({ nivel: p.nivel, ...ventanaDeNivel(p.datos.vigencia) }));

/**
 * Nivel de la alerta ahora: si una «Actualización de nivel» está en su horario, el de ésa (la más
 * nueva, si se pisan); si no, el del mapa.
 */
export function nivelDe(pub, ahora = Date.now()) {
  return cambiosDeNivel(pub).find((c) => c.inicio <= ahora && ahora < c.fin)?.nivel || nivelDelMapa(pub);
}
/** El próximo cambio de nivel que todavía no empezó ({ nivel, inicio }), o null. */
export function proximoCambioDeNivel(pub, ahora = Date.now()) {
  return cambiosDeNivel(pub).filter((c) => c.inicio > ahora).sort((x, y) => x.inicio - y.inicio)[0] || null;
}
const fenomenoDe = (pub) => (pub?.smn ? String(pub.evento || pub.titulo || "tormenta").toLowerCase() : FENOMENO[pub?.iconos?.[0]?.id] || "tormenta");
const notaVigencia = (nivel) => `Siguen vigentes las recomendaciones emitidas en la alerta ${enFemenino(nivel).toLowerCase()}.`;
const NOTA_AVISO = "Estar atentos a las indicaciones de Alertas a Corto Plazo (ACP).";
const mananaDe = (fecha) => { const [a, m, d] = fecha.split("-").map(Number); return valorLocal(new Date(a, m - 1, d + 1)).slice(0, 10); };
const hoy = () => valorLocal(new Date()).slice(0, 10);
const fechaHora = (d) => new Date(d).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const RE_HORA = /^([01]?\d|2[0-4]):[0-5]\d$/;

function pasoNivel(catalogo) {
  const color = (n) => catalogo.categorias.find((c) => c.nombre === n)?.color;
  return {
    pregunta: "¿De qué nivel es la alerta?",
    ayuda: "Lo que va en color en la placa (título, zonas, el «!») sale de este color.",
    html: (s) => `<div class="paso-niveles">${opciones({ nombre: "nivel", tipo: "radio", items: NIVELES.map((n) => ({ valor: n, titulo: n, marcada: s.nivel === n })) })}</div>`,
    alMostrar: (popup) => popup.querySelectorAll(".paso-niveles .paso-opcion").forEach((el, i) => el.style.setProperty("--nivel", color(NIVELES[i]))),
    leer: (popup) => ({ nivel: leerOpciones(popup, "nivel")[0] }),
    validar: (s) => (s.nivel ? null : "Elegí el nivel."),
  };
}

function pasoTexto({ pregunta, ayuda, campo, max, filas = 6, placeholder = "", opcional = false }) {
  return {
    pregunta, ayuda,
    html: (s) => `<textarea class="paso-texto" id="paso-${campo}" maxlength="${max}" rows="${filas}" placeholder="${esc(placeholder)}" data-foco>${esc(s[campo] || "")}</textarea>`,
    leer: (popup) => ({ [campo]: popup.querySelector(`#paso-${campo}`).value.trim() }),
    validar: (s) => (opcional || s[campo] ? null : "Completá el texto."),
  };
}

/**
 * Lista editable dentro de un paso: filas con − para sacar y «+ Agregar» abajo.
 * fila(item, i) → html de los campos; leerFila(el, item) → item actualizado con lo del DOM.
 */
function listaEditable({ popup, items, fila, leerFila, nuevo, min, max, textoAgregar, alCambiar }) {
  const caja = popup.querySelector("[data-lista]");
  const sincronizar = () => { caja.querySelectorAll("[data-fila]").forEach((el, i) => { items[i] = leerFila(el, items[i]); }); };
  const dibujar = () => {
    caja.innerHTML = `${items.map((it, i) => `<div class="paso-fila" data-fila="${i}">${fila(it, i)}<button type="button" class="btn btn--ghost paso-fila__quitar" data-quitar="${i}" aria-label="Sacar" title="Sacar" ${items.length <= min ? "disabled" : ""}>−</button></div>`).join("")}
      <button type="button" class="btn paso-fila__agregar" data-agregar ${items.length >= max ? "disabled" : ""}>+ ${textoAgregar}</button>`;
    alCambiar?.(caja);
  };
  caja.addEventListener("click", (e) => {
    const quitar = e.target.closest("[data-quitar]"), agregar = e.target.closest("[data-agregar]");
    if (!quitar && !agregar) return;
    sincronizar();
    if (quitar) items.splice(Number(quitar.dataset.quitar), 1);
    if (agregar) items.push(nuevo(items));
    dibujar();
  });
  dibujar();
  return { leer: () => { sincronizar(); return items.map((x) => ({ ...x })); } };
}

/** Lo que devuelve la vista previa y lo que se guarda. */
function generador(pub, tipo, datosDe, editada = null) {
  const payload = (s) => ({ tipo, nivel: s.nivel, datos: datosDe(s) });
  return {
    clave: (s) => JSON.stringify(payload(s)),
    vistaPrevia: (s) => A(pub).generarPlacaAlerta(pub.id, { ...payload(s), vistaPrevia: true }),
    // Al editar, la placa nueva reemplaza a `editada` en la tarjeta.
    guardar: (s) => A(pub).generarPlacaAlerta(pub.id, { ...payload(s), confirmarToken: s.vista.token, ...(editada ? { reemplaza: editada.id } : {}) }),
  };
}

const resultado = (placa, extra = "", editada = null) => ({ tipo: "ok", titulo: editada ? "¡Placa editada!" : "¡La placa está lista!", datos: placa,
  html: `${htmlPlacaLista(placa)}<p>${extra}${editada ? "Reemplazó a la anterior en la tarjeta de la alerta." : "Quedó guardada en la tarjeta de la alerta, con su botón para publicarla en redes."}${editada?.redes?.length ? " La versión anterior ya se había publicado en redes: esta nueva todavía no." : ""}</p>` });

// ---------------------------------------------------------------------------------------------
// Actualización de vigencia
// ---------------------------------------------------------------------------------------------

/** "AAAA-MM-DD" + "HH:MM" (24:00 = medianoche siguiente) → Date local. */
function finDeZona({ fecha, hasta, hasta2 }) {
  const [a, m, d] = fecha.split("-").map(Number);
  const fin = (h) => { const [hh, mm] = h.split(":").map(Number); return new Date(a, m - 1, d, hh, mm); };
  return hasta2 && fin(hasta2) > fin(hasta) ? fin(hasta2) : fin(hasta);
}

/**
 * Los renglones de «Actualización de vigencia» armados con los horarios por nivel de la alerta (`tramos`, ver
 * tramosAlerta.js): uno por tramo y por día, cada uno con su nivel («Naranja de 00:00 a 06:00», «Amarillo de 06:00 a 12:00»…).
 * Toma el departamento de mayor nivel (a igualdad, el de más tramos). null si la alerta no tiene horarios por nivel.
 */
function zonasDeTramos(pub, catalogo, limite) {
  const entradas = Object.entries(pub.tramos || {}).filter(([, l]) => l?.length);
  if (!entradas.length) return null;
  const tope = (l) => Math.max(...l.map((t) => ORDEN[t.categoria] || 0));
  const firma = (l) => JSON.stringify(l.map((t) => [t.categoria, t.hasta]));
  const [, elegido] = [...entradas].sort(([, a], [, b]) => tope(b) - tope(a) || b.length - a.length)[0];
  const mismos = entradas.filter(([, l]) => firma(l) === firma(elegido)).map(([id]) => id);
  const nombres = mismos.map((id) => catalogo.departamentos.find((d) => String(d.id) === id)?.nombre).filter(Boolean);
  const nombre = mismos.length >= 12 ? "Toda la provincia" : nombres.join(", ").length <= 60 ? nombres.join(", ") : "Varios departamentos";
  const z2 = (n) => String(n).padStart(2, "0"), dia = (d) => `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}`;
  const filas = [];
  let desde = new Date(pub.publicadoEn || Date.now()); desde.setMinutes(0, 0, 0);
  for (const t of elegido) {
    const hasta = new Date(t.hasta);
    // Un tramo que cruza la medianoche se parte en un renglón por día.
    for (let ini = new Date(desde); ini < hasta; ) {
      const finDia = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 1), fin = hasta < finDia ? hasta : finDia;
      filas.push({ nombre, nivel: NIVELES.includes(t.categoria) ? t.categoria : null, fecha: dia(ini), desde: `${z2(ini.getHours())}:${z2(ini.getMinutes())}`, hasta: fin.getTime() === finDia.getTime() ? "24:00" : `${z2(fin.getHours())}:${z2(fin.getMinutes())}` });
      ini = fin;
    }
    desde = hasta;
  }
  return filas.length ? filas.slice(0, limite) : null;
}

function pasoZonas(limite) {
  let lista;
  return {
    pregunta: "¿Qué zonas y con qué horario?",
    ayuda: "Cada renglón sale con su reloj y su vigencia («sábado 03/10/2026 de 12:00 a 24:00 horas»), con el nombre del color de su nivel. Para que el nivel cambie en el día (naranja de 00:00 a 06:00, amarillo de 06:00 a 12:00, naranja de 12:00 a 18:00…) agregá un renglón por tramo con «+ Agregar zona» y elegí el nivel de cada uno. Las horas, como 12:00 o 24:00.",
    html: () => `<div class="paso-filas" data-lista></div>`,
    alMostrar: (popup, s) => {
      lista = listaEditable({
        popup, items: s.zonas.map((z) => ({ ...z })), min: 1, max: limite, textoAgregar: "Agregar zona",
        // El renglón nuevo sigue al último: mismo nombre y día, desde donde terminó el anterior, y el otro nivel.
        nuevo: (items) => { const u = items[items.length - 1]; return { ...u, desde: u.hasta === "24:00" ? "00:00" : u.hasta, hasta: "24:00", desde2: "", hasta2: "", fecha: u.hasta === "24:00" ? mananaDe(u.fecha) : u.fecha, nivel: u.nivel === "Naranja" ? "Amarillo" : "Naranja" }; },
        fila: (z) => `<input class="paso-input paso-fila__nombre" data-campo="nombre" maxlength="60" placeholder="Ej.: Zona norte" value="${esc(z.nombre)}" aria-label="Zona">
          <select class="paso-select" data-campo="nivel" aria-label="Nivel">${NIVELES.map((n) => `<option value="${n}" ${n === z.nivel ? "selected" : ""}>${n}</option>`).join("")}</select>
          <input class="paso-input" type="date" data-campo="fecha" value="${esc(z.fecha)}" aria-label="Día">
          <input class="paso-input paso-fila__hora" data-campo="desde" inputmode="numeric" placeholder="12:00" value="${esc(z.desde)}" aria-label="Desde">
          <span class="paso-fila__a">a</span>
          <input class="paso-input paso-fila__hora" data-campo="hasta" inputmode="numeric" placeholder="24:00" value="${esc(z.hasta)}" aria-label="Hasta">
          <span class="paso-fila__a">y de</span>
          <input class="paso-input paso-fila__hora" data-campo="desde2" inputmode="numeric" placeholder="(opcional)" value="${esc(z.desde2 || "")}" aria-label="Segunda franja, desde">
          <span class="paso-fila__a">a</span>
          <input class="paso-input paso-fila__hora" data-campo="hasta2" inputmode="numeric" placeholder="(opcional)" value="${esc(z.hasta2 || "")}" aria-label="Segunda franja, hasta">`,
        leerFila: (el) => Object.fromEntries([...el.querySelectorAll("[data-campo]")].map((i) => [i.dataset.campo, i.value.trim()])),
      });
    },
    leer: () => ({ zonas: lista.leer() }),
    validar: (s) => {
      for (const z of s.zonas) {
        if (!z.nombre) return "Ponele nombre a cada zona.";
        if (!z.fecha || !RE_HORA.test(z.desde) || !RE_HORA.test(z.hasta)) return `Revisá el día y las horas de «${z.nombre}» (como 12:00 o 24:00).`;
        if ((z.desde2 || z.hasta2) && (!RE_HORA.test(z.desde2) || !RE_HORA.test(z.hasta2))) return `Revisá la segunda franja de «${z.nombre}» (desde y hasta, como 12:00 o 24:00).`;
      }
      return null;
    },
  };
}

function pasoVigenciaMapa(pub) {
  return {
    pregunta: "¿Hasta cuándo se ve la alerta en el mapa?",
    ayuda: `Ahora se saca sola el ${fechaHora(pub.vigenteHasta)} h. El mapa no cambia; si hay alertas en fila detrás, se corren lo mismo.`,
    html: (s) => `<label class="paso-etiqueta">Vigente hasta<input type="datetime-local" class="paso-input" id="paso-vigente" value="${esc(s.vigenteMapa || "")}" min="${esc(valorLocal(new Date()))}" data-foco></label>
      <div class="paso-vigencia__rapidas"><button type="button" class="btn" data-zonas>Fin de la última zona</button><button type="button" class="btn" data-igual>Dejarla como está</button></div>`,
    alMostrar: (popup, s) => {
      const campo = popup.querySelector("#paso-vigente");
      if (!campo.value) campo.value = valorLocal(new Date(Math.max(...s.zonas.map((z) => finDeZona(z).getTime()))));
      popup.querySelector("[data-zonas]").addEventListener("click", () => { campo.value = valorLocal(new Date(Math.max(...s.zonas.map((z) => finDeZona(z).getTime())))); });
      popup.querySelector("[data-igual]").addEventListener("click", () => { campo.value = valorLocal(new Date(pub.vigenteHasta)); });
    },
    leer: (popup) => ({ vigenteMapa: popup.querySelector("#paso-vigente").value }),
    validar: (s) => (s.vigenteMapa && new Date(s.vigenteMapa) > new Date() ? null : "Elegí una fecha y hora futura."),
  };
}

export async function cambiarVigenciaPorPasos({ pub, catalogo, placa: editada = null, alTerminar }) {
  const base = await A(pub).getUltimosPlacasAlerta().catch(() => ({ ultimos: {}, limites: {} }));
  const u = base.ultimos?.vigencia || {};
  const ahora = new Date(), desde = `${String(ahora.getHours()).padStart(2, "0")}:00`;
  const zonas = u.zonas?.length ? u.zonas.map((z) => ({ nombre: z.nombre, fecha: pub.smn ? z.fecha : hoy(), desde: z.desde, hasta: z.hasta, desde2: z.desde2 || "", hasta2: z.hasta2 || "" })) : [{ nombre: "Toda la provincia", fecha: hoy(), desde, hasta: "24:00" }];
  const nivel = nivelDe(pub);
  // Si la alerta tiene horarios por nivel, los renglones salen de ahí (uno por tramo); si no, lo último que se usó.
  const deTramos = pub.smn ? null : zonasDeTramos(pub, catalogo, base.limites?.zonas || 8);
  const zonasIniciales = (deTramos || zonas).map((z) => ({ ...z, nivel: z.nivel || nivel }));
  const g = generador(pub, "vigencia", (s) => ({ zonas: s.zonas, descripcion: s.descripcion, nota: s.nota }), editada);
  const pasos = [
    pasoNivel(catalogo),
    pasoZonas(base.limites?.zonas || 8),
    // La vigencia de una alerta del SMN es la del SMN: no se corre desde acá.
    ...(pub.smn ? [] : [pasoVigenciaMapa(pub)]),
    pasoTexto({ pregunta: "¿Qué se espera?", ayuda: "El texto del fenómeno, con la nube de tormenta al lado.", campo: "descripcion", max: base.limites?.descripcion || 700, filas: 8, placeholder: "El área será afectada por lluvias y tormentas fuertes…" }),
    { ...pasoTexto({ pregunta: "¿Nota al pie?", ayuda: "Va con el «!» del color de la alerta. Dejala vacía si no hace falta.", campo: "nota", max: base.limites?.nota || 220, filas: 3, opcional: true }),
      // Si quedó la nota automática de otro nivel, se actualiza al elegido.
      html: (s) => { if (s.nota == null || NIVELES.some((n) => s.nota === notaVigencia(n))) s.nota = notaVigencia(s.nivel); return `<textarea class="paso-texto" id="paso-nota" maxlength="220" rows="3" data-foco>${esc(s.nota)}</textarea>`; } },
    pasoVistaPrevia({ clave: g.clave, generar: g.vistaPrevia }),
  ];
  const enviar = async (s) => {
    const cambio = !pub.smn && s.vigenteMapa !== valorLocal(new Date(pub.vigenteHasta));
    if (cambio) await api.cambiarVigenciaAlerta(pub.id, new Date(s.vigenteMapa).toISOString());
    const placa = await g.guardar(s);
    alTerminar?.();
    return resultado(placa, cambio ? `La alerta ahora se ve hasta el ${fechaHora(s.vigenteMapa)} h. ` : "", editada);
  };
  // Editando: arranca con lo de esa placa, y la vigencia del mapa como está (no cambia si no la tocás).
  const estado = editada
    ? { nivel: editada.nivel, zonas: editada.datos.zonas.map((z) => ({ ...z, nivel: z.nivel || editada.nivel })), descripcion: editada.datos.descripcion, nota: editada.datos.nota, vigenteMapa: valorLocal(new Date(pub.vigenteHasta)) }
    : { nivel, zonas: zonasIniciales, descripcion: u.descripcion || base.ultimos?.aviso?.descripcion || "", nota: null };
  return asistente({ pasos, enviar, textoEnviar: "Confirmar", estado, ancho: 820 });
}

// ---------------------------------------------------------------------------------------------
// Recomendaciones
// ---------------------------------------------------------------------------------------------

/** Achica el ícono subido a 256 px (PNG): así viaja liviano y se guarda en la base. */
async function iconoSubido(archivo) {
  if (!["image/png", "image/jpeg"].includes(archivo.type)) throw new Error("El ícono tiene que ser PNG o JPG.");
  const bmp = await createImageBitmap(archivo);
  const k = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

function pasoRecomendaciones(iconos, limites) {
  let lista;
  const opcionesIcono = (sel) => iconos.map((n) => `<option value="${n}" ${n === sel ? "selected" : ""}>${esc(NOMBRE_ICONO[n] || n)}</option>`).join("");
  return {
    pregunta: "Recomendaciones",
    ayuda: "Con − sacás una, con «+ Agregar» sumás otra. Cada una lleva un ícono: elegí uno de la lista o subí el tuyo (PNG blanco con fondo transparente queda mejor).",
    html: () => `<div class="paso-filas" data-lista></div>`,
    alMostrar: (popup, s) => {
      const items = s.items.map((x) => ({ ...x }));
      lista = listaEditable({
        popup, items, min: 1, max: limites.items || 7, textoAgregar: "Agregar recomendación",
        nuevo: () => ({ icono: "alerta", texto: "" }),
        fila: (it, i) => `<img class="paso-fila__icono" src="${esc(it.imagen || api.urlIconoPlacaAlerta(it.icono))}" alt="">
          <div class="paso-fila__icono-elegir">
            <select class="paso-select" data-campo="icono" aria-label="Ícono">${it.imagen ? `<option value="" selected>Subido</option>` : ""}${opcionesIcono(it.imagen ? null : it.icono)}</select>
            <label class="btn btn--ghost paso-fila__subir">Subir<input type="file" accept="image/png,image/jpeg" data-subir="${i}" hidden></label>
          </div>
          <input class="paso-input paso-fila__texto" data-campo="texto" maxlength="${limites.item || 140}" value="${esc(it.texto)}" placeholder="Ej.: Asegurá objetos que puedan volarse" aria-label="Recomendación">`,
        leerFila: (el, it) => {
          const icono = el.querySelector("[data-campo=icono]").value, texto = el.querySelector("[data-campo=texto]").value.trim();
          return icono ? { icono, texto } : { ...it, texto }; // "" = sigue el subido
        },
        alCambiar: (caja) => {
          caja.querySelectorAll("[data-campo=icono]").forEach((sel) => sel.addEventListener("change", () => {
            if (sel.value) sel.closest("[data-fila]").querySelector(".paso-fila__icono").src = api.urlIconoPlacaAlerta(sel.value);
          }));
          caja.querySelectorAll("[data-subir]").forEach((input) => input.addEventListener("change", async () => {
            const archivo = input.files[0];
            if (!archivo) return;
            const el = input.closest("[data-fila]"), i = Number(input.dataset.subir);
            try {
              const imagen = await iconoSubido(archivo);
              items[i] = { texto: el.querySelector("[data-campo=texto]").value.trim(), imagen };
              el.querySelector(".paso-fila__icono").src = imagen;
              const sel = el.querySelector("[data-campo=icono]");
              if (!sel.querySelector('option[value=""]')) sel.insertAdjacentHTML("afterbegin", '<option value="">Subido</option>');
              sel.value = "";
            } catch (e) { (await import("./ui")).notificar("error", e.message); }
          }));
        },
      });
    },
    leer: () => ({ items: lista.leer() }),
    validar: (s) => (s.items.every((x) => x.texto) ? null : "Completá el texto de cada recomendación (o sacala con −)."),
  };
}

function pasoFenomeno(extra = "") {
  return {
    pregunta: "¿Por qué fenómeno es la alerta?",
    ayuda: `Va en el título, en color: «ALERTA POR TORMENTA».${extra}`,
    html: (s) => `<label class="paso-etiqueta">Alerta por…<input class="paso-input" id="paso-fenomeno" maxlength="40" value="${esc(s.fenomeno)}" placeholder="tormenta" data-foco></label>`,
    leer: (popup) => ({ fenomeno: popup.querySelector("#paso-fenomeno").value.trim() }),
    validar: (s) => (s.fenomeno ? null : "Escribí el fenómeno."),
  };
}

export async function recomendacionesPorPasos({ pub, catalogo, placa: editada = null, alTerminar }) {
  const base = await A(pub).getUltimosPlacasAlerta();
  const items = base.ultimos?.recomendaciones?.items?.length ? base.ultimos.recomendaciones.items : base.recomendaciones;
  const g = generador(pub, "recomendaciones", (s) => ({ fenomeno: s.fenomeno, items: s.items }), editada);
  const pasos = [pasoNivel(catalogo), pasoFenomeno(), pasoRecomendaciones(base.iconos, base.limites || {}), pasoVistaPrevia({ clave: g.clave, generar: g.vistaPrevia })];
  const enviar = async (s) => { const placa = await g.guardar(s); alTerminar?.(); return resultado(placa, "", editada); };
  const estado = editada ? { nivel: editada.nivel, ...editada.datos } : { nivel: nivelDe(pub), fenomeno: fenomenoDe(pub), items };
  return asistente({ pasos, enviar, textoEnviar: "Confirmar", estado, ancho: 860 });
}

// ---------------------------------------------------------------------------------------------
// Aviso de alerta
// ---------------------------------------------------------------------------------------------

export async function avisoDeAlertaPorPasos({ pub, catalogo, placa: editada = null, alTerminar }) {
  const base = await A(pub).getUltimosPlacasAlerta().catch(() => ({ ultimos: {}, limites: {} }));
  const u = base.ultimos?.aviso || {};
  const g = generador(pub, "aviso", (s) => ({ fenomeno: s.fenomeno, vigencia: s.vigencia, zona: s.zona, descripcion: s.descripcion, nota: s.nota }), editada);
  const pasos = [
    pasoNivel(catalogo),
    { pregunta: "Fenómeno, vigencia y zona",
      html: (s) => `<label class="paso-etiqueta">Alerta por… (va en el título, en color)<input class="paso-input" id="paso-fenomeno" maxlength="40" value="${esc(s.fenomeno)}" placeholder="tormenta" data-foco></label>
        <label class="paso-etiqueta">Vigencia (con el reloj: «Vigencia: …»)<input class="paso-input" id="paso-vigencia-texto" maxlength="160" value="${esc(s.vigencia)}" placeholder="próximas 3 horas"></label>
        <label class="paso-etiqueta">Zona (con el pin)<input class="paso-input" id="paso-zona" maxlength="160" value="${esc(s.zona)}" placeholder="Zona sur de la provincia de Misiones"></label>`,
      leer: (popup) => ({ fenomeno: popup.querySelector("#paso-fenomeno").value.trim(), vigencia: popup.querySelector("#paso-vigencia-texto").value.trim(), zona: popup.querySelector("#paso-zona").value.trim() }),
      validar: (s) => (!s.fenomeno ? "Escribí el fenómeno." : !s.vigencia ? "Escribí la vigencia." : !s.zona ? "Escribí la zona." : null) },
    pasoTexto({ pregunta: "¿Qué se espera?", ayuda: "Va con la nube de tormenta al lado.", campo: "descripcion", max: base.limites?.descripcion || 700, filas: 6, placeholder: "Ingresarán tormentas fuertes desde el sur de la provincia…" }),
    pasoTexto({ pregunta: "¿Nota al pie?", ayuda: "Va con el «!» del color de la alerta. Dejala vacía si no hace falta.", campo: "nota", max: base.limites?.nota || 220, filas: 3, opcional: true }),
    pasoVistaPrevia({ clave: g.clave, generar: g.vistaPrevia }),
  ];
  const enviar = async (s) => { const placa = await g.guardar(s); alTerminar?.(); return resultado(placa, "", editada); };
  return asistente({ pasos, enviar, textoEnviar: "Confirmar", ancho: 760,
    estado: editada ? { nivel: editada.nivel, ...editada.datos }
      : { nivel: nivelDe(pub), fenomeno: fenomenoDe(pub), vigencia: u.vigencia || "próximas 3 horas", zona: u.zona || "", descripcion: u.descripcion || "", nota: u.nota ?? NOTA_AVISO } });
}

// ---------------------------------------------------------------------------------------------
// Actualización de nivel ("El nivel de alerta pasa de AMARILLO a NARANJA.")
// ---------------------------------------------------------------------------------------------

const ANTERIORES = ["Verde", ...NIVELES];

export async function actualizacionNivelPorPasos({ pub, catalogo, placa: editada = null, alTerminar }) {
  const base = await A(pub).getUltimosPlacasAlerta().catch(() => ({ ultimos: {}, limites: {} }));
  const u = base.ultimos?.nivel || {}, otra = base.ultimos?.vigencia || {};
  // Por defecto pasa del nivel de ahora al de arriba.
  // En una alerta del SMN, la alerta ya está en el nivel nuevo: viene de `u.nivelAnterior`.
  const actual = pub.smn ? (u.nivelAnterior || nivelDe(pub)) : nivelDe(pub), nivel = pub.smn ? nivelDelMapa(pub) : NIVELES[Math.min(NIVELES.length - 1, NIVELES.indexOf(actual) + 1)];
  const v = pub.smn ? u.vigencia : null;
  const color = (n) => catalogo.categorias.find((c) => c.nombre === n)?.color;
  const g = generador(pub, "nivel", (s) => ({ fenomeno: s.fenomeno, nivelAnterior: s.nivelAnterior, zona: s.zona, vigencia: { fecha: s.fecha, desde: s.desde, hasta: s.hasta }, descripcion: s.descripcion }), editada);
  const pasos = [
    { ...pasoNivel(catalogo), pregunta: "¿A qué nivel pasa?", ayuda: "El nivel nuevo: la placa sale de ese color." },
    { pregunta: "¿De qué nivel venía?", ayuda: "Sale «El nivel de alerta pasa de … a …», con una flecha para arriba si sube o para abajo si baja.",
      html: (s) => `<div class="paso-niveles">${opciones({ nombre: "anterior", tipo: "radio", items: ANTERIORES.map((n) => ({ valor: n, titulo: n, marcada: s.nivelAnterior === n, deshabilitada: n === s.nivel })) })}</div>`,
      alMostrar: (popup) => popup.querySelectorAll(".paso-niveles .paso-opcion").forEach((el, i) => el.style.setProperty("--nivel", color(ANTERIORES[i]))),
      leer: (popup) => ({ nivelAnterior: leerOpciones(popup, "anterior")[0] }),
      validar: (s) => (!s.nivelAnterior ? "Elegí de qué nivel venía." : s.nivelAnterior === s.nivel ? "Tiene que ser distinto del nivel nuevo." : null) },
    { pregunta: "Fenómeno y zona",
      html: (s) => `<label class="paso-etiqueta">Alerta por… (va en el título, en color)<input class="paso-input" id="paso-fenomeno" maxlength="40" value="${esc(s.fenomeno)}" placeholder="tormenta" data-foco></label>
        <label class="paso-etiqueta">Zona (con el pin)<input class="paso-input" id="paso-zona" maxlength="160" value="${esc(s.zona)}" placeholder="Zona norte de Misiones"></label>`,
      leer: (popup) => ({ fenomeno: popup.querySelector("#paso-fenomeno").value.trim(), zona: popup.querySelector("#paso-zona").value.trim() }),
      validar: (s) => (!s.fenomeno ? "Escribí el fenómeno." : !s.zona ? "Escribí la zona." : null) },
    { pregunta: "¿Desde cuándo y hasta cuándo?", ayuda: "Sale «Vigencia: 04/10/2026 desde las 00:00 a 06:00 horas.». Las horas, como 00:00 o 24:00.",
      html: (s) => `<div class="paso-fila"><input class="paso-input" type="date" id="paso-fecha" value="${esc(s.fecha)}" aria-label="Día" data-foco>
        <span class="paso-fila__a">desde las</span><input class="paso-input paso-fila__hora" id="paso-desde" inputmode="numeric" value="${esc(s.desde)}" placeholder="00:00" aria-label="Desde">
        <span class="paso-fila__a">a</span><input class="paso-input paso-fila__hora" id="paso-hasta" inputmode="numeric" value="${esc(s.hasta)}" placeholder="06:00" aria-label="Hasta"></div>`,
      leer: (popup) => ({ fecha: popup.querySelector("#paso-fecha").value, desde: popup.querySelector("#paso-desde").value.trim(), hasta: popup.querySelector("#paso-hasta").value.trim() }),
      validar: (s) => (s.fecha && RE_HORA.test(s.desde) && RE_HORA.test(s.hasta) ? null : "Revisá el día y las horas (como 00:00 o 24:00).") },
    pasoTexto({ pregunta: "¿Qué se espera?", ayuda: "El texto del fenómeno, con la nube de tormenta al lado.", campo: "descripcion", max: base.limites?.descripcion || 700, filas: 8, placeholder: "El área será afectada por lluvias y tormentas fuertes…" }),
    pasoVistaPrevia({ clave: g.clave, generar: g.vistaPrevia }),
  ];
  const enviar = async (s) => { const placa = await g.guardar(s); alTerminar?.(); return resultado(placa, "", editada); };
  const ahora = new Date();
  if (editada) {
    const { vigencia, ...resto } = editada.datos;
    return asistente({ pasos, enviar, textoEnviar: "Confirmar", ancho: 760, estado: { nivel: editada.nivel, ...resto, ...vigencia } });
  }
  return asistente({ pasos, enviar, textoEnviar: "Confirmar", ancho: 760,
    estado: { nivel, nivelAnterior: actual !== nivel ? actual : ANTERIORES[Math.max(0, ANTERIORES.indexOf(nivel) - 1)], fenomeno: u.fenomeno || fenomenoDe(pub), zona: u.zona || base.ultimos?.aviso?.zona || "",
      fecha: v?.fecha || hoy(), desde: v?.desde || `${String(ahora.getHours()).padStart(2, "0")}:00`, hasta: v?.hasta || "24:00",
      descripcion: u.descripcion || otra.descripcion || base.ultimos?.aviso?.descripcion || "" } });
}

// ---------------------------------------------------------------------------------------------
// Crear placa para redes: la placa del mapa de la alerta (el asistente de siempre), guardada en su tarjeta
// ---------------------------------------------------------------------------------------------

export function placaMapaPorPasos({ pub, catalogo, placa: editada = null, alTerminar }) {
  // Las 17 zonas de la alerta (sin dato o gris = verde), como las pide la placa.
  const zonas = catalogo.departamentos.map((d) => {
    const z = (pub.zonasBase || pub.zonas)?.find((x) => String(x.id) === String(d.id));
    return { id: String(d.id), categoria: !z || z.categoria === "Gris" ? "Verde" : z.categoria };
  });
  const inicial = editada ? { ...editada.datos }
    : { zonas, iconos: pub.iconosBase || pub.iconos || [], periodo: pub.periodo || "Próximas 24 horas", fondo: "tormenta", tamanoPeriodo: catalogo.tamanoPeriodo?.predeterminado || 64 };
  return crearPlacaMapaAlertas({
    catalogo, inicial,
    vistaPrevia: (c) => A(pub).generarPlacaAlerta(pub.id, { tipo: "mapa", datos: c, vistaPrevia: true }),
    guardar: async (c, token) => {
      const placa = await A(pub).generarPlacaAlerta(pub.id, { tipo: "mapa", datos: c, confirmarToken: token, ...(editada ? { reemplaza: editada.id } : {}) });
      alTerminar?.(placa);
      return placa;
    },
  });
}

/** El asistente de cada tipo de placa (para editar una ya generada). */
export const ASISTENTE_DE = { mapa: placaMapaPorPasos, vigencia: cambiarVigenciaPorPasos, recomendaciones: recomendacionesPorPasos, aviso: avisoDeAlertaPorPasos, nivel: actualizacionNivelPorPasos };

export const TIPO_PLACA = { mapa: "Placa para redes", vigencia: "Actualización de vigencia", recomendaciones: "Recomendaciones", aviso: "Aviso de alerta", nivel: "Actualización de nivel" };
