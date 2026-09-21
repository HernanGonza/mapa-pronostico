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

/** Fenómenos de la placa de alertas: cada uno con su color (categoría). */
export function pasoFenomenos({ catalogo }) {
  return {
    pregunta: "¿Qué fenómenos se esperan?", ayuda: "Marcá los que apliquen y elegí el color de cada uno. Podés no elegir ninguno.",
    html: (s) => `<div class="paso-fenomenos">${catalogo.iconos.map((ic, i) => {
      const elegido = s.iconos.find((x) => x.id === ic.id);
      return `<div class="paso-fenomeno"><label><input type="checkbox" data-fen="${i}" ${elegido ? "checked" : ""}> <span>${esc(ic.nombre)}</span></label>
        <select class="paso-select" data-color="${i}" aria-label="Color de ${esc(ic.nombre)}">${catalogo.categorias.map((c) => `<option value="${esc(c.nombre)}" ${c.nombre === (elegido?.categoria || "Rojo") ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select></div>`;
    }).join("")}</div>`,
    leer: (popup) => ({ iconos: catalogo.iconos.map((ic, i) => popup.querySelector(`input[data-fen="${i}"]`).checked ? { id: ic.id, categoria: popup.querySelector(`select[data-color="${i}"]`).value } : null).filter(Boolean) }),
  };
}

/** Resumen de qué cambia respecto de lo publicado (para "Revisar y publicar"). */
export function htmlCambios({ cambios, sinPublicar }) {
  return `${sinPublicar ? "<p>Se publicará el primer mapa con los niveles elegidos.</p>" : ""}
    ${cambios.length ? `<p>Se van a actualizar <strong>${cambios.length}</strong> ${cambios.length === 1 ? "departamento" : "departamentos"} en el mapa público:</p>
    <ul class="paso-cambios">${cambios.map((c) => `<li><strong>${esc(c.nombre)}</strong>: ${esc(c.antes)} <span aria-hidden="true">→</span> ${esc(c.despues)}</li>`).join("")}</ul>` : ""}`;
}
