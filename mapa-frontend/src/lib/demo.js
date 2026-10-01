/**
 * Modo demostración: avisos y alertas DE PRUEBA para mostrar cómo funcionan /tv y los
 * embebidos (reuniones, capacitaciones), sin tocar la base ni el servidor.
 *
 * - Sólo se activa en páginas abiertas con `?demo=1` (el sitio público nunca lo lleva,
 *   así que el mapa del ministerio jamás muestra datos de prueba).
 * - Qué se muestra lo deciden los interruptores de /panel/demostracion, guardados en el
 *   navegador (localStorage): todas las ventanas abiertas en ese navegador cambian al
 *   instante (evento `storage` + BroadcastChannel).
 * - Los datos de prueba se generan con la hora actual: siempre están "vigentes".
 */
const CLAVE = "alertaTemprana.demo";
const CANAL = "alertaTemprana.demo";
export const VACIO = { acp: false, alerta: false, smn: false };

export const enDemo = () => {
  try { return new URLSearchParams(window.location.search).has("demo"); } catch { return false; }
};

export function leerDemo() {
  try { return { ...VACIO, ...JSON.parse(localStorage.getItem(CLAVE) || "{}") }; } catch { return { ...VACIO }; }
}

let canal = null;
function obtenerCanal() {
  if (!canal && typeof BroadcastChannel !== "undefined") canal = new BroadcastChannel(CANAL);
  return canal;
}

export function guardarDemo(config) {
  try { localStorage.setItem(CLAVE, JSON.stringify(config)); } catch { /* sin almacenamiento: sólo esta ventana */ }
  obtenerCanal()?.postMessage(config);
}

/** Avisa cuando cambian los interruptores (en otra pestaña/ventana/iframe). Devuelve cómo dejar de escuchar. */
export function alCambiarDemo(fn) {
  const porStorage = (e) => { if (e.key === CLAVE) fn(leerDemo()); };
  const c = obtenerCanal();
  const porCanal = () => fn(leerDemo());
  window.addEventListener("storage", porStorage);
  c?.addEventListener("message", porCanal);
  return () => { window.removeEventListener("storage", porStorage); c?.removeEventListener("message", porCanal); };
}

/** Agrega `demo=1` a una ruta propia (para los iframes de /tv y de la página de demostración). */
export function conDemo(ruta) {
  return `${ruta}${ruta.includes("?") ? "&" : "?"}demo=1`;
}

// --- Datos de prueba -------------------------------------------------------------------------

const en = (minutos) => new Date(Date.now() + minutos * 60_000).toISOString();

export function acpDePrueba() {
  return [
    { id: -1, titulo: "Aviso a muy corto plazo (PRUEBA)", texto: "PRUEBA · Tormentas fuertes con ráfagas y caída de granizo en Oberá, Cainguás y Guaraní. Se recomienda permanecer bajo techo y evitar circular.",
      publicadoEn: en(-12), vigenteHasta: en(75), smnId: null,
      poligono: [[-55.25, -27.25], [-54.55, -27.15], [-54.35, -27.55], [-55.05, -27.75]] },
    { id: -2, titulo: "Aviso a muy corto plazo (PRUEBA)", texto: "PRUEBA · Lluvias intensas y actividad eléctrica frecuente en Iguazú y General Manuel Belgrano.",
      publicadoEn: en(-5), vigenteHasta: en(100), smnId: null,
      poligono: [[-54.55, -25.65], [-53.85, -25.6], [-53.75, -26.1], [-54.45, -26.2]] },
  ];
}

/** Alerta por departamentos de prueba: Naranja en el centro, Amarillo alrededor, el resto Verde. */
export function alertaDePrueba(departamentos) {
  const naranja = ["Oberá", "Cainguás", "Guaraní"], amarillo = ["25 de Mayo", "San Javier", "Leandro N. Alem", "San Pedro", "Montecarlo"];
  return [{
    id: -10, periodo: "PRUEBA · Hoy, tarde y noche", publicadoEn: en(-20), vigenteHasta: en(360),
    zonas: departamentos.map((d) => ({ id: String(d.id), categoria: naranja.includes(d.nombre) ? "Naranja" : amarillo.includes(d.nombre) ? "Amarillo" : "Verde" })),
    iconos: [{ id: "tormentas", categoria: "Naranja" }, { id: "granizo", categoria: "Amarillo" }],
  }];
}

export function smnDePrueba() {
  return [{
    id: -20, smnId: "demo", titulo: "Tormentas (PRUEBA)", categoria: "Amarillo", color: "#FFCC35",
    descripcion: "PRUEBA · El área será afectada por tormentas de variada intensidad, algunas localmente fuertes, acompañadas por ráfagas, ocasional caída de granizo y abundante caída de agua en cortos períodos.",
    instrucciones: "1- Evitá salir. 2- Desconectá los electrodomésticos. 3- Si estás al aire libre, buscá refugio en un edificio.",
    inicio: en(-30), fin: en(420), emitidoEn: en(-35), publicadoEn: en(-25), vigenteHasta: en(420), url: null,
    zonas: [{ nombre: "Sur de Misiones", departamentos: ["Apóstoles", "Concepción", "Capital", "Candelaria"],
      geometry: { type: "Polygon", coordinates: [[[-56.05, -27.35], [-55.45, -27.3], [-55.2, -27.85], [-55.55, -28.15], [-56.1, -27.9], [-56.05, -27.35]]] } }],
  }];
}
