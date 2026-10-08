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
const baseDe = (pub) => pub.zonasBase || pub.zonas || [];
const nivelesPresentes = (pub) => ORDEN.filter((n) => baseDe(pub).some((z) => z.categoria === n));

/** Valores iniciales por nivel, a partir de los tramos ya cargados (o la vigencia de la alerta). */
function porNivelInicial(pub) {
  const out = {};
  for (const n of nivelesPresentes(pub)) {
    const dep = baseDe(pub).find((z) => z.categoria === n && pub.tramos?.[String(z.id)]?.length);
    const t = dep ? pub.tramos[String(dep.id)] : [];
    out[n] = { hasta: t[0] ? aLocal(t[0].hasta) : aLocal(pub.vigenteHasta), despues: t[1]?.categoria || "Verde", hasta2: t[1] ? aLocal(t[1].hasta) : "" };
  }
  return out;
}

/** Tramos de cada departamento a partir de lo cargado por nivel. */
function tramosDesdeNiveles(pub, porNivel) {
  const out = {};
  for (const z of baseDe(pub)) {
    const p = porNivel[z.categoria];
    if (!p) continue;
    out[String(z.id)] = [{ categoria: z.categoria, hasta: p.hasta }, ...(p.despues !== "Verde" && p.hasta2 ? [{ categoria: p.despues, hasta: p.hasta2 }] : [])];
  }
  return out;
}

function errorDeTramosLocal(pub, tramos, nombreDe) {
  const tope = Date.parse(pub.vigenteHasta);
  for (const [id, lista] of Object.entries(tramos)) {
    let anterior = 0;
    for (const t of lista) {
      const hasta = Date.parse(t.hasta);
      if (Number.isNaN(hasta)) return `Falta la hora de fin de ${nombreDe(id)}.`;
      if (hasta <= anterior) return `En ${nombreDe(id)}, cada tramo tiene que terminar después del anterior.`;
      if (hasta > tope) return `El tramo de ${nombreDe(id)} termina después de que la alerta se saca sola (${fechaHora(pub.vigenteHasta)} h). Primero alargá la vigencia de la alerta.`;
      anterior = hasta;
    }
  }
  return null;
}

export async function vigenciasPorNivelPorPasos({ pub, catalogo, alTerminar }) {
  const nombres = new Map(catalogo.departamentos.map((d) => [String(d.id), d.nombre]));
  const nombreDe = (id) => nombres.get(String(id)) || id;
  const color = (nivel) => catalogo.categorias.find((c) => c.nombre === nivel)?.color || "#d5dbd5";
  const niveles = nivelesPresentes(pub);
  // Departamentos de norte a sur, en el orden de las zonas del SMN.
  const ordenPorZona = (zonas) => agruparPorZona(catalogo.departamentos).flatMap((g) => g.propios).map((i) => zonas.find((z) => String(z.id) === String(catalogo.departamentos[i].id))).filter(Boolean);
  if (!niveles.length) return null;
  const opcionesNivel = (sel, permitirVerde = true, nivelesPosibles = ORDEN) => `${permitirVerde ? `<option value="Verde" ${sel === "Verde" ? "selected" : ""}>Verde (se sale)</option>` : ""}${nivelesPosibles.map((n) => `<option value="${n}" ${n === sel ? "selected" : ""}>${n}</option>`).join("")}`;

  const pasoPorNivel = {
    pregunta: "¿Hasta cuándo vale cada nivel?",
    ayuda: `La alerta se saca sola el ${fechaHora(pub.vigenteHasta)} h. Cada nivel termina a su hora y los departamentos pasan al nivel que elijas (o se salen).`,
    html: (s) => `<div class="paso-filas">${niveles.map((n) => `<div class="paso-fila" data-nivel="${n}">
        <strong style="flex:1 1 100%"><i class="vig-punto" style="background:${color(n)}"></i> Alerta ${esc(enFemenino(n).toLowerCase())}</strong>
        <label class="paso-etiqueta">Hasta<input type="datetime-local" class="paso-input" data-campo="hasta" value="${esc(s.porNivel[n].hasta)}"></label>
        <label class="paso-etiqueta">Después<select class="paso-select" data-campo="despues">${opcionesNivel(s.porNivel[n].despues, true, ORDEN.slice(ORDEN.indexOf(n) + 1))}</select></label>
        <label class="paso-etiqueta" data-hasta2 ${s.porNivel[n].despues === "Verde" ? "hidden" : ""}>Hasta<input type="datetime-local" class="paso-input" data-campo="hasta2" value="${esc(s.porNivel[n].hasta2)}"></label>
      </div>`).join("")}</div>`,
    alMostrar: (popup) => popup.querySelectorAll("[data-nivel]").forEach((fila) => {
      fila.querySelector('[data-campo="despues"]').addEventListener("change", (e) => { fila.querySelector("[data-hasta2]").hidden = e.target.value === "Verde"; });
    }),
    leer: (popup, s) => {
      const porNivel = Object.fromEntries(niveles.map((n) => {
        const fila = popup.querySelector(`[data-nivel="${n}"]`), v = (c) => fila.querySelector(`[data-campo="${c}"]`).value;
        return [n, { hasta: v("hasta"), despues: v("despues"), hasta2: v("despues") === "Verde" ? "" : v("hasta2") }];
      }));
      // Si cambió algo de acá, se vuelven a armar los departamentos; si no, se respetan los ajustes individuales.
      const cambio = JSON.stringify(porNivel) !== JSON.stringify(s.porNivel);
      return { porNivel, tramos: cambio || !s.tramos ? tramosDesdeNiveles(pub, porNivel) : s.tramos };
    },
    validar: (s) => {
      for (const n of niveles) {
        const p = s.porNivel[n];
        if (!p.hasta) return `Falta hasta cuándo vale la alerta ${enFemenino(n).toLowerCase()}.`;
        if (p.despues !== "Verde" && !p.hasta2) return `Falta hasta cuándo vale el nivel siguiente de la alerta ${enFemenino(n).toLowerCase()}.`;
      }
      return errorDeTramosLocal(pub, s.tramos || tramosDesdeNiveles(pub, s.porNivel), nombreDe);
    },
  };

  const pasoPorDepartamento = {
    pregunta: "¿Algún departamento distinto?",
    ayuda: "Así quedó cada departamento. Si alguno termina antes o después que el resto, cambiale la hora acá. Dejá vacío el segundo tramo si se sale.",
    html: (s) => `<div class="vig-deptos">${ordenPorZona(baseDe(pub)).filter((z) => s.tramos[String(z.id)]).map((z) => {
      const t = s.tramos[String(z.id)];
      return `<div class="paso-fila" data-dep="${esc(z.id)}"><strong class="vig-depto"><i class="vig-punto" style="background:${color(z.categoria)}"></i>${esc(nombreDe(z.id))}</strong>${Array.from({ length: MAX_TRAMOS }, (_, k) => `
        <select class="paso-select" data-cat="${k}" aria-label="Nivel del tramo ${k + 1}">${opcionesNivel(t[k]?.categoria || "", false).replace("<option", `${k ? '<option value="">—</option><option' : "<option"}`)}</select>
        <input type="datetime-local" class="paso-input" data-hasta="${k}" value="${esc(t[k] ? aLocal(t[k].hasta) : "")}" aria-label="Hasta, tramo ${k + 1}">`).join("")}</div>`;
    }).join("")}</div>`,
    leer: (popup, s) => {
      const tramos = { ...s.tramos };
      popup.querySelectorAll("[data-dep]").forEach((fila) => {
        const lista = [];
        for (let k = 0; k < MAX_TRAMOS; k++) {
          const categoria = fila.querySelector(`[data-cat="${k}"]`).value, hasta = fila.querySelector(`[data-hasta="${k}"]`).value;
          if (categoria && hasta) lista.push({ categoria, hasta });
          else if (categoria || hasta) lista.push({ categoria, hasta }); // incompleto: lo marca validar
        }
        tramos[fila.dataset.dep] = lista;
      });
      return { tramos };
    },
    validar: (s) => {
      for (const [id, lista] of Object.entries(s.tramos)) {
        if (lista.some((t) => !t.categoria || !t.hasta)) return `Completá nivel y hora en los tramos de ${nombreDe(id)}.`;
        if (!lista.length) return `${nombreDe(id)} no tiene ningún tramo.`;
      }
      return errorDeTramosLocal(pub, s.tramos, nombreDe);
    },
  };

  const enviar = async (s) => {
    const tramos = Object.fromEntries(Object.entries(s.tramos).map(([id, lista]) => [id, lista.map((t) => ({ categoria: t.categoria, hasta: new Date(t.hasta).toISOString() }))]));
    await api.cambiarTramosAlerta(pub.id, tramos);
    alTerminar?.();
    return { tipo: "ok", titulo: "Vigencias guardadas", datos: true, html: "<p>El mapa público cambia solo el nivel de cada departamento a la hora que corresponde (se actualiza cada minuto).</p>" };
  };

  const porNivel = porNivelInicial(pub);
  return asistente({ pasos: [pasoPorNivel, pasoPorDepartamento], enviar, textoEnviar: "Guardar", ancho: 820,
    estado: { porNivel, tramos: Object.keys(pub.tramos || {}).length ? Object.fromEntries(Object.entries(pub.tramos).map(([id, l]) => [id, l.map((t) => ({ categoria: t.categoria, hasta: aLocal(t.hasta) }))])) : null } });
}
