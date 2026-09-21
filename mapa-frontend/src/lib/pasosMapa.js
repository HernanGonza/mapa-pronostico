import { esc } from "./ui";

/**
 * Pasos reutilizables de los asistentes de mapas por departamento (riesgo de incendios y alertas
 * meteorológicas): elegir el nivel de cada departamento y, en las alertas, los fenómenos.
 */

/** Nivel de cada departamento, con un selector "Poner todos en…" para cargar rápido. */
export function pasoNiveles({ catalogo, pregunta = "Nivel de cada departamento", ayuda, etiqueta = (c) => c.nombre, idComoTexto = false, permitirVacio = true }) {
  const colorDe = (nombre) => catalogo.categorias.find((c) => c.nombre === nombre)?.color || "#d5dbd5";
  const opciones = (sel) => `${permitirVacio ? '<option value="">Elegir nivel…</option>' : ""}${catalogo.categorias.map((c) => `<option value="${esc(c.nombre)}" ${c.nombre === sel ? "selected" : ""}>${esc(etiqueta(c))}</option>`).join("")}`;
  return {
    pregunta, ayuda,
    html: (s) => `<label class="paso-todos"><span>Poner todos en</span><select class="paso-select" id="paso-todos"><option value="">Elegir…</option>${catalogo.categorias.map((c) => `<option value="${esc(c.nombre)}">${esc(etiqueta(c))}</option>`).join("")}</select></label>
      <div class="paso-niveles">${catalogo.departamentos.map((d, i) => {
        const cat = s.zonas.find((z) => String(z.id) === String(d.id))?.categoria || "";
        return `<label class="paso-nivel"><span><i style="background:${colorDe(cat)}"></i>${esc(d.nombre)}</span><select class="paso-select" data-dep="${i}" aria-label="Nivel de ${esc(d.nombre)}">${opciones(cat)}</select></label>`;
      }).join("")}</div>`,
    alMostrar: (popup) => {
      const selects = [...popup.querySelectorAll("select[data-dep]")];
      const pintar = (sel) => { sel.closest(".paso-nivel").querySelector("i").style.background = colorDe(sel.value); };
      selects.forEach((sel) => sel.addEventListener("change", () => pintar(sel)));
      popup.querySelector("#paso-todos").addEventListener("change", (e) => { if (!e.target.value) return; selects.forEach((sel) => { sel.value = e.target.value; pintar(sel); }); e.target.value = ""; });
    },
    leer: (popup) => ({ zonas: catalogo.departamentos.map((d, i) => ({ id: idComoTexto ? String(d.id) : d.id, categoria: popup.querySelector(`select[data-dep="${i}"]`).value })) }),
    validar: (s) => (s.zonas.every((z) => z.categoria) ? null : "Falta elegir el nivel de algún departamento."),
  };
}

/**
 * Fenómenos de la placa de alertas: cada uno con su color de subrayado y, opcionalmente, un SEGUNDO color
 * (el subrayado se parte en dos mitades, p. ej. mitad amarillo y mitad naranja). Muestra el resultado en vivo.
 */
export function pasoFenomenos({ catalogo }) {
  const color = (nombre) => catalogo.categorias.find((c) => c.nombre === nombre)?.color || "#888";
  const opcionesColor = (sel, vacio) => `${vacio ? `<option value="">${vacio}</option>` : ""}${catalogo.categorias.map((c) => `<option value="${esc(c.nombre)}" ${c.nombre === sel ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")}`;
  const subrayado = (c1, c2) => (c2 && c2 !== c1 ? `linear-gradient(90deg, ${color(c1)} 50%, ${color(c2)} 50%)` : color(c1));
  return {
    pregunta: "¿Qué fenómenos se esperan?", ayuda: "Marcá los que apliquen. Cada uno se subraya con un color; si querés, sumá un segundo color y el subrayado se parte en dos mitades.",
    html: (s) => `<div class="paso-fenomenos"><div class="paso-fenomeno paso-fenomeno--cabecera" aria-hidden="true"><span>Fenómeno</span><span>Color</span><span>Segundo color</span></div>${catalogo.iconos.map((ic, i) => {
      const el = s.iconos.find((x) => x.id === ic.id);
      return `<div class="paso-fenomeno"><div class="paso-fenomeno__nombre"><label><input type="checkbox" data-fen="${i}" ${el ? "checked" : ""}> <span>${esc(ic.nombre)}</span></label><i class="paso-subrayado" data-sub="${i}" style="background:${subrayado(el?.categoria || "Rojo", el?.categoria2)}"></i></div>
        <select class="paso-select" data-color="${i}" aria-label="Color de ${esc(ic.nombre)}">${opcionesColor(el?.categoria || "Rojo")}</select>
        <select class="paso-select" data-color2="${i}" aria-label="Segundo color de ${esc(ic.nombre)} (opcional)">${opcionesColor(el?.categoria2 || "", "Ninguno")}</select></div>`;
    }).join("")}</div>`,
    alMostrar: (popup) => {
      catalogo.iconos.forEach((_, i) => {
        const c1 = popup.querySelector(`[data-color="${i}"]`), c2 = popup.querySelector(`[data-color2="${i}"]`), marca = popup.querySelector(`[data-sub="${i}"]`), fila = popup.querySelector(`[data-fen="${i}"]`);
        const pintar = () => { marca.style.background = subrayado(c1.value, c2.value); };
        // Tocar un color marca el fenómeno como elegido: es lo que la persona quiere.
        [c1, c2].forEach((sel) => sel.addEventListener("change", () => { pintar(); if (sel.value) fila.checked = true; }));
      });
    },
    leer: (popup) => ({ iconos: catalogo.iconos.map((ic, i) => {
      if (!popup.querySelector(`input[data-fen="${i}"]`).checked) return null;
      const categoria = popup.querySelector(`select[data-color="${i}"]`).value, categoria2 = popup.querySelector(`select[data-color2="${i}"]`).value;
      return { id: ic.id, categoria, ...(categoria2 && categoria2 !== categoria ? { categoria2 } : {}) };
    }).filter(Boolean) }),
  };
}

/** Resumen de qué cambia respecto de lo publicado (para "Revisar y publicar"). */
export function htmlCambios({ cambios, sinPublicar }) {
  return `${sinPublicar ? "<p>Se publicará el primer mapa con los niveles elegidos.</p>" : ""}
    ${cambios.length ? `<p>Se van a actualizar <strong>${cambios.length}</strong> ${cambios.length === 1 ? "departamento" : "departamentos"} en el mapa público:</p>
    <ul class="paso-cambios">${cambios.map((c) => `<li><strong>${esc(c.nombre)}</strong>: ${esc(c.antes)} <span aria-hidden="true">→</span> ${esc(c.despues)}</li>`).join("")}</ul>` : ""}`;
}
