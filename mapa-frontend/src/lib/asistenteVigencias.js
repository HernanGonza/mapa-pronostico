import { asistente, opciones, leerOpciones } from "./pasos";
import { valorLocal } from "./asistenteAvisoEspecial";
import { esc } from "./ui";
import { enFemenino } from "./nivelAlerta.js";
import { agruparPorZona } from "./zonasSmn";
import * as api from "../api";

/**
 * Vigencias individuales de una alerta publicada: hasta cuándo vale cada nivel y a qué pasa después
 * (ej. naranja hasta las 06:00 y desde ahí amarillo hasta las 12:00). Primero por nivel (lo común) y
 * después, si hace falta, ajustando departamento por departamento. El mapa público resuelve solo el
 * nivel de cada departamento según la hora (ver mapa-backend/src/lib/tramosAlerta.js).
 */
const ORDEN = ["Rojo", "Naranja", "Amarillo"];
const MAX_TRAMOS = 4; // el servidor admite hasta 4 (el SMN puede subir y bajar el nivel varias veces)
const fechaHora = (d) => new Date(d).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const aLocal = (iso) => valorLocal(new Date(iso));
const nivelesPresentes = (zonas) => ORDEN.filter((n) => zonas.some((z) => z.categoria === n));

/** Valores iniciales por nivel, a partir de los tramos ya cargados (o, si no hay, la vigencia de la alerta). */
function porNivelInicial(zonas, tramos, vigenciaLocal) {
  const out = {};
  for (const n of nivelesPresentes(zonas)) {
    const dep = zonas.find((z) => z.categoria === n && tramos?.[String(z.id)]?.length);
    // Un tramo en verde al principio es «todavía no empezó» (alerta que arranca más tarde): no es parte del nivel.
    const t = dep ? tramos[String(dep.id)].filter((x, k) => !(k === 0 && x.categoria === "Verde")) : [];
    out[n] = { hasta: t[0] ? aLocal(t[0].hasta) : vigenciaLocal, despues: t[1]?.categoria || "Verde", hasta2: t[1] ? aLocal(t[1].hasta) : "" };
  }
  return out;
}

/** Tramos de cada departamento (horas locales) a partir de lo cargado por nivel. */
function tramosDesdeNiveles(zonas, porNivel) {
  const out = {};
  for (const z of zonas) {
    const p = porNivel[z.categoria];
    if (!p) continue;
    out[String(z.id)] = [{ categoria: z.categoria, hasta: p.hasta }, ...(p.despues !== "Verde" && p.hasta2 ? [{ categoria: p.despues, hasta: p.hasta2 }] : [])];
  }
  return out;
}

function errorDeTramosLocal(tope, topeTexto, tramos, nombreDe) {
  for (const [id, lista] of Object.entries(tramos)) {
    let anterior = 0;
    for (const t of lista) {
      const hasta = Date.parse(t.hasta);
      if (Number.isNaN(hasta)) return `Falta la hora de fin de ${nombreDe(id)}.`;
      if (hasta <= anterior) return `En ${nombreDe(id)}, cada tramo tiene que terminar después del anterior.`;
      if (hasta > tope) return `El tramo de ${nombreDe(id)} termina después de que la alerta se saca sola (${topeTexto} h). Primero alargá la vigencia de la alerta.`;
      anterior = hasta;
    }
  }
  return null;
}


/**
 * Los dos pasos (por nivel y por departamento), reutilizables: sirven para una alerta ya publicada y
 * para el asistente de publicar (ahí con el mapa en borrador).
 *  zonas(s) → [{id, categoria}] del mapa; tope(s) → { ms, texto, local } (cuándo se saca sola la alerta);
 *  inicial: { tramos } ya guardados (ISO), para precargar. El estado usa `porNivel` y `tramos` (horas locales).
 */
export function pasosVigencias({ catalogo, zonas, tope, inicial = null, soloSiVarios = false }) {
  const nombres = new Map(catalogo.departamentos.map((d) => [String(d.id), d.nombre]));
  const nombreDe = (id) => nombres.get(String(id)) || id;
  const color = (nivel) => catalogo.categorias.find((c) => c.nombre === nivel)?.color || "#d5dbd5";
  const ordenPorZona = (lista) => agruparPorZona(catalogo.departamentos).flatMap((g) => g.propios).map((i) => lista.find((z) => String(z.id) === String(catalogo.departamentos[i].id))).filter(Boolean);
  const opcionesNivel = (sel, permitirVerde = true, posibles = ORDEN) => `${permitirVerde ? `<option value="Verde" ${sel === "Verde" ? "selected" : ""}>Verde (se sale)</option>` : ""}${posibles.map((n) => `<option value="${n}" ${n === sel ? "selected" : ""}>${n}</option>`).join("")}`;
  const niveles = (s) => nivelesPresentes(zonas(s));

  // Arma (o rearma, si cambió el mapa o la vigencia) lo que se muestra; así el borrador y los pasos no se desfasan.
  function preparar(s) {
    const clave = JSON.stringify([zonas(s).map((z) => [z.id, z.categoria]), tope(s).local]);
    if (s._vigClave === clave && s.porNivel) return;
    const primera = s._vigClave === undefined;
    s._vigClave = clave;
    s.porNivel = porNivelInicial(zonas(s), primera ? inicial?.tramos : null, tope(s).local);
    s.tramos = primera && inicial?.tramos ? Object.fromEntries(Object.entries(inicial.tramos).map(([id, l]) => [id, l.map((t) => ({ categoria: t.categoria, hasta: aLocal(t.hasta) }))])) : null;
  }
  const tramosDe = (s) => { preparar(s); return s.tramos || tramosDesdeNiveles(zonas(s), s.porNivel); };
  const porDefecto = (s) => tramosDesdeNiveles(zonas(s), porNivelInicial(zonas(s), null, tope(s).local));
  const personalizado = (s) => { preparar(s); return JSON.stringify(tramosDe(s)) !== JSON.stringify(porDefecto(s)); };

  const pasoPorNivel = {
    omitir: (s) => !niveles(s).length || (soloSiVarios && niveles(s).length < 2),
    pregunta: "¿Hasta cuándo vale cada nivel?",
    ayuda: "Cada nivel termina a su hora y los departamentos pasan al nivel que elijas (o se salen). Si no cambia nada, la alerta vale entera hasta que se saca sola.",
    html: (s) => {
      preparar(s);
      return `<p class="paso__ayuda">La alerta se saca sola el ${esc(tope(s).texto)} h.</p><div class="paso-filas">${niveles(s).map((n) => `<div class="paso-fila" data-nivel="${n}">
        <strong style="flex:1 1 100%"><i class="vig-punto" style="background:${color(n)}"></i> Alerta ${esc(enFemenino(n).toLowerCase())}</strong>
        <label class="paso-etiqueta">Hasta<input type="datetime-local" class="paso-input" data-campo="hasta" value="${esc(s.porNivel[n].hasta)}"></label>
        <label class="paso-etiqueta">Después<select class="paso-select" data-campo="despues">${opcionesNivel(s.porNivel[n].despues, true, ORDEN.slice(ORDEN.indexOf(n) + 1))}</select></label>
        <label class="paso-etiqueta" data-hasta2 ${s.porNivel[n].despues === "Verde" ? "hidden" : ""}>Hasta<input type="datetime-local" class="paso-input" data-campo="hasta2" value="${esc(s.porNivel[n].hasta2)}"></label>
      </div>`).join("")}</div>`;
    },
    alMostrar: (popup, s) => popup.querySelectorAll("[data-nivel]").forEach((fila) => {
      fila.querySelector('[data-campo="despues"]').addEventListener("change", (e) => {
        const dos = fila.querySelector("[data-hasta2]"), campo = dos.querySelector("input");
        dos.hidden = e.target.value === "Verde";
        // El segundo tramo, por defecto, llega hasta que se saca sola la alerta (si eso queda después del primero).
        if (!dos.hidden && !campo.value && Date.parse(tope(s).local) > Date.parse(fila.querySelector('[data-campo="hasta"]').value)) campo.value = tope(s).local;
      });
    }),
    leer: (popup, s) => {
      preparar(s);
      const porNivel = Object.fromEntries(niveles(s).map((n) => {
        const fila = popup.querySelector(`[data-nivel="${n}"]`), v = (c) => fila.querySelector(`[data-campo="${c}"]`).value;
        return [n, { hasta: v("hasta"), despues: v("despues"), hasta2: v("despues") === "Verde" ? "" : v("hasta2") }];
      }));
      // Si cambió algo de acá, se vuelven a armar los departamentos; si no, se respetan los ajustes individuales.
      const cambio = JSON.stringify(porNivel) !== JSON.stringify(s.porNivel);
      return { porNivel, tramos: cambio ? null : s.tramos, ...(cambio ? { sinDistintos: false } : {}) };
    },
    validar: (s) => {
      preparar(s);
      for (const n of niveles(s)) {
        const p = s.porNivel[n];
        if (!p.hasta) return `Falta hasta cuándo vale la alerta ${enFemenino(n).toLowerCase()}.`;
        if (p.despues !== "Verde" && !p.hasta2) return `Falta hasta cuándo vale el tramo ${p.despues.toLowerCase()} que sigue a la alerta ${enFemenino(n).toLowerCase()}.`;
        const t1 = Date.parse(p.hasta), t2 = Date.parse(p.hasta2);
        if (t1 > tope(s).ms) return `La alerta ${enFemenino(n).toLowerCase()} no puede terminar después de que se saca sola la alerta (${tope(s).texto} h). Primero alargá la vigencia de la alerta.`;
        if (p.despues !== "Verde" && t2 <= t1) return `Alerta ${enFemenino(n).toLowerCase()}: después de que termina (${fechaHora(p.hasta)} h) tiene que quedar tiempo en ${p.despues.toLowerCase()}, pero ese tramo termina ${fechaHora(p.hasta2)} h. Hacé terminar antes el ${n.toLowerCase()}, o alargá la vigencia de la alerta; si el ${n.toLowerCase()} dura hasta el final, elegí «Verde (se sale)» en «Después».`;
        if (p.despues !== "Verde" && t2 > tope(s).ms) return `El tramo ${p.despues.toLowerCase()} de la alerta ${enFemenino(n).toLowerCase()} termina después de que se saca sola la alerta (${tope(s).texto} h). Primero alargá la vigencia de la alerta.`;
      }
      return errorDeTramosLocal(tope(s).ms, tope(s).texto, tramosDe(s), nombreDe);
    },
  };

  const pasoPorDepartamento = {
    omitir: (s) => pasoPorNivel.omitir(s) || s.sinDistintos || !personalizado(s),
    pregunta: "¿Algún departamento distinto?",
    ayuda: "En el paso anterior cargaste los horarios de cada nivel. Acá decidís si algún departamento tiene un horario propio (por ejemplo, que le toque el nivel naranja más tarde que a los demás).",
    html: (s) => {
      preparar(s); const t = tramosDe(s);
      const eleccion = opciones({ nombre: "distintos", tipo: "radio", items: [
        { valor: "ninguno", titulo: "No, ninguno es distinto", detalle: "Todos los departamentos siguen los horarios de su nivel (el paso anterior). No hace falta tocar nada más.", marcada: !!s.sinDistintos },
        { valor: "si", titulo: "Sí, algunos tienen horarios propios", detalle: "Abajo ves cada departamento con sus tramos: cambiá los que hagan falta.", marcada: !s.sinDistintos },
      ] });
      return `${eleccion}<div class="vig-deptos" data-lista ${s.sinDistintos ? "hidden" : ""}>
        <p class="paso__ayuda">Cada departamento tiene hasta ${MAX_TRAMOS} tramos, uno detrás del otro: el nivel que rige y hasta qué hora. «—» deja el tramo sin usar; «Verde» es un tramo sin alerta (por ejemplo, antes de que empiece).</p>${ordenPorZona(zonas(s)).filter((z) => t[String(z.id)]).map((z) => {
      const l = t[String(z.id)];
      return `<div class="paso-fila" data-dep="${esc(z.id)}"><strong class="vig-depto"><i class="vig-punto" style="background:${color(z.categoria)}"></i>${esc(nombreDe(z.id))}</strong>${Array.from({ length: MAX_TRAMOS }, (_, k) => `
        <select class="paso-select" data-cat="${k}" aria-label="Nivel del tramo ${k + 1}">${k ? '<option value="">—</option>' : ""}${opcionesNivel(l[k]?.categoria || "", true)}</select>
        <input type="datetime-local" class="paso-input" data-hasta="${k}" value="${esc(l[k]?.hasta || "")}" aria-label="Hasta, tramo ${k + 1}">`).join("")}</div>`;
    }).join("")}</div>`;
    },
    alMostrar: (popup) => popup.querySelectorAll('input[name="distintos"]').forEach((r) => r.addEventListener("change", () => {
      popup.querySelector("[data-lista]").hidden = leerOpciones(popup, "distintos")[0] === "ninguno";
    })),
    leer: (popup, s) => {
      // «No, ninguno es distinto»: se descartan los ajustes y vale lo de cada nivel.
      if (leerOpciones(popup, "distintos")[0] === "ninguno") return { tramos: null, sinDistintos: true };
      const tramos = { ...tramosDe(s) };
      popup.querySelectorAll("[data-dep]").forEach((fila) => {
        const lista = [];
        for (let k = 0; k < MAX_TRAMOS; k++) {
          const categoria = fila.querySelector(`[data-cat="${k}"]`).value, hasta = fila.querySelector(`[data-hasta="${k}"]`).value;
          if (categoria || hasta) lista.push({ categoria, hasta }); // incompleto: lo marca validar
        }
        tramos[fila.dataset.dep] = lista;
      });
      return { tramos, sinDistintos: false };
    },
    validar: (s) => {
      if (s.sinDistintos) return null;
      for (const [id, lista] of Object.entries(tramosDe(s))) {
        if (!lista.length) return `${nombreDe(id)} no tiene ningún tramo.`;
        if (lista.some((t) => !t.categoria || !t.hasta)) return `Completá nivel y hora en los tramos de ${nombreDe(id)}.`;
      }
      return errorDeTramosLocal(tope(s).ms, tope(s).texto, tramosDe(s), nombreDe);
    },
  };

  /** Tramos listos para mandar al servidor (ISO), o null si no se pidió nada distinto de lo normal. */
  const paraEnviar = (s) => {
    if (pasoPorNivel.omitir(s)) return null;
    preparar(s);
    if (!personalizado(s)) return null;
    return Object.fromEntries(Object.entries(tramosDe(s)).map(([id, lista]) => [id, lista.map((t) => ({ categoria: t.categoria, hasta: new Date(t.hasta).toISOString() }))]));
  };
  return { pasos: [pasoPorNivel, pasoPorDepartamento], paraEnviar };
}

/** Botón «Vigencias por nivel» de una alerta ya publicada. */
export async function vigenciasPorNivelPorPasos({ pub, catalogo, alTerminar }) {
  const zonas = pub.zonasBase || pub.zonas || [];
  const tope = { ms: Date.parse(pub.vigenteHasta), texto: fechaHora(pub.vigenteHasta), local: aLocal(pub.vigenteHasta) };
  const { pasos, paraEnviar } = pasosVigencias({ catalogo, zonas: () => zonas, tope: () => tope, inicial: { tramos: pub.tramos && Object.keys(pub.tramos).length ? pub.tramos : null } });
  if (!nivelesPresentes(zonas).length) return null;
  const enviar = async (s) => {
    // Sin nada distinto de lo normal se borran los tramos: la alerta vale entera hasta que se saca sola.
    await api.cambiarTramosAlerta(pub.id, paraEnviar(s) || {});
    alTerminar?.();
    return { tipo: "ok", titulo: "Vigencias guardadas", datos: true, html: "<p>El mapa público cambia solo el nivel de cada departamento a la hora que corresponde (se actualiza cada minuto).</p>" };
  };
  return asistente({ pasos: pasos.map((p) => ({ ...p, omitir: p === pasos[0] ? undefined : p.omitir })), enviar, textoEnviar: "Guardar", ancho: 820 });
}
