import { asistente } from "./pasos";
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
const MAX_TRAMOS = 2;
const fechaHora = (d) => new Date(d).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const aLocal = (iso) => valorLocal(new Date(iso));
const nivelesPresentes = (zonas) => ORDEN.filter((n) => zonas.some((z) => z.categoria === n));

/** Valores iniciales por nivel, a partir de los tramos ya cargados (o, si no hay, la vigencia de la alerta). */
function porNivelInicial(zonas, tramos, vigenciaLocal) {
  const out = {};
  for (const n of nivelesPresentes(zonas)) {
    const dep = zonas.find((z) => z.categoria === n && tramos?.[String(z.id)]?.length);
    const t = dep ? tramos[String(dep.id)] : [];
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
    alMostrar: (popup) => popup.querySelectorAll("[data-nivel]").forEach((fila) => {
      fila.querySelector('[data-campo="despues"]').addEventListener("change", (e) => { fila.querySelector("[data-hasta2]").hidden = e.target.value === "Verde"; });
    }),
    leer: (popup, s) => {
      preparar(s);
      const porNivel = Object.fromEntries(niveles(s).map((n) => {
        const fila = popup.querySelector(`[data-nivel="${n}"]`), v = (c) => fila.querySelector(`[data-campo="${c}"]`).value;
        return [n, { hasta: v("hasta"), despues: v("despues"), hasta2: v("despues") === "Verde" ? "" : v("hasta2") }];
      }));
      // Si cambió algo de acá, se vuelven a armar los departamentos; si no, se respetan los ajustes individuales.
      const cambio = JSON.stringify(porNivel) !== JSON.stringify(s.porNivel);
      return { porNivel, tramos: cambio ? null : s.tramos };
    },
    validar: (s) => {
      preparar(s);
      for (const n of niveles(s)) {
        const p = s.porNivel[n];
        if (!p.hasta) return `Falta hasta cuándo vale la alerta ${enFemenino(n).toLowerCase()}.`;
        if (p.despues !== "Verde" && !p.hasta2) return `Falta hasta cuándo vale el nivel siguiente de la alerta ${enFemenino(n).toLowerCase()}.`;
      }
      return errorDeTramosLocal(tope(s).ms, tope(s).texto, tramosDe(s), nombreDe);
    },
  };

  const pasoPorDepartamento = {
    omitir: (s) => pasoPorNivel.omitir(s) || !personalizado(s),
    pregunta: "¿Algún departamento distinto?",
    ayuda: "Así quedó cada departamento. Si alguno termina antes o después que el resto, cambiale la hora acá. Dejá vacío el segundo tramo si se sale.",
    html: (s) => { preparar(s); const t = tramosDe(s); return `<div class="vig-deptos">${ordenPorZona(zonas(s)).filter((z) => t[String(z.id)]).map((z) => {
      const l = t[String(z.id)];
      return `<div class="paso-fila" data-dep="${esc(z.id)}"><strong class="vig-depto"><i class="vig-punto" style="background:${color(z.categoria)}"></i>${esc(nombreDe(z.id))}</strong>${Array.from({ length: MAX_TRAMOS }, (_, k) => `
        <select class="paso-select" data-cat="${k}" aria-label="Nivel del tramo ${k + 1}">${k ? '<option value="">—</option>' : ""}${opcionesNivel(l[k]?.categoria || "", false)}</select>
        <input type="datetime-local" class="paso-input" data-hasta="${k}" value="${esc(l[k]?.hasta || "")}" aria-label="Hasta, tramo ${k + 1}">`).join("")}</div>`;
    }).join("")}</div>`; },
    leer: (popup, s) => {
      const tramos = { ...tramosDe(s) };
      popup.querySelectorAll("[data-dep]").forEach((fila) => {
        const lista = [];
        for (let k = 0; k < MAX_TRAMOS; k++) {
          const categoria = fila.querySelector(`[data-cat="${k}"]`).value, hasta = fila.querySelector(`[data-hasta="${k}"]`).value;
          if (categoria || hasta) lista.push({ categoria, hasta }); // incompleto: lo marca validar
        }
        tramos[fila.dataset.dep] = lista;
      });
      return { tramos };
    },
    validar: (s) => {
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
