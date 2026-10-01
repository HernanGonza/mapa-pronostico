/**
 * Pantallas de la rotación de /tv. Las del sistema están definidas acá; desde el panel
 * (Configuración → Pantalla TV) se activan o desactivan, se reordenan, se les cambia la
 * duración y se suman pantallas propias (un video o una imagen subidos, o una página de otro
 * sitio). Lo guardado vive en el backend (GET/PUT /api/tv/rotacion) y /tv lo relee solo.
 *
 * Tipos:
 *   embebido  una o dos páginas propias (lado a lado), en el área entre la cabecera y el pie
 *   pagina    una página de otro sitio, en la misma área (propia)
 *   imagen    una imagen, en la misma área (propia)
 *   video     a pantalla completa; dura lo que dure el video
 */
export const DURACION_PREDETERMINADA = 25; // segundos (los videos duran lo que duran)

export const PANTALLAS_SISTEMA = [
  { id: "marca", tipo: "video", titulo: "Misiones", src: "/videos/marca-misiones.mp4", descripcion: "Video institucional Marca Misiones." },
  { id: "pronostico", tipo: "embebido", titulo: "Previsión del tiempo", paginas: [{ src: "/embed" }], descripcion: "Mapa del pronóstico publicado." },
  // Pensado para un iframe chico: se agranda para que llene la pantalla.
  { id: "extendido", tipo: "embebido", titulo: "Pronóstico de 3 días", paginas: [{ src: "/embed/pronostico-3-dias", escala: 1.6 }], descripcion: "Pronóstico extendido publicado." },
  { id: "riesgo", tipo: "embebido", titulo: "Riesgo de incendios forestales", paginas: [{ src: "/embed/riesgo-incendios" }], descripcion: "Mapa de riesgo de incendios publicado." },
  { id: "cuencas", tipo: "embebido", titulo: "Monitor de cuencas", paginas: [{ src: "/embed/cuencas-tarjetas", escala: 1.3 }], descripcion: "Sólo las tarjetas del Paraná, Uruguay e Iguazú." },
  // El mapa de cuencas todavía no está terminado: viene apagado.
  { id: "cuencas-mapa", tipo: "embebido", titulo: "Monitor de cuencas", activoPorDefecto: false,
    paginas: [{ src: "/embed/cuencas-mapa", ancho: "42%" }, { src: "/embed/cuencas-tarjetas", ancho: "58%", escala: 1.3 }],
    descripcion: "CON EL MAPA de cuencas al lado de las tarjetas (el mapa todavía no está terminado)." },
  { id: "focos", tipo: "embebido", titulo: "Focos de calor", paginas: [{ src: "/embed/alertas-incendios" }], descripcion: "Mapa de focos de calor." },
  { id: "loop", tipo: "video", titulo: "Ministerio de Ecología", src: "/videos/loop-ecologia.mp4", descripcion: "Video institucional del Ministerio." },
];

/**
 * La rotación completa a partir de lo guardado (null = nunca se guardó: la de siempre).
 * Respeta el orden guardado; las pantallas del sistema que no figuran (nuevas en el código)
 * se suman al final con su estado por defecto.
 */
export function armarRotacion(guardadas) {
  const porId = new Map(PANTALLAS_SISTEMA.map((p) => [p.id, p]));
  const lista = [];
  for (const g of guardadas || []) {
    if (g.propia) { lista.push({ ...g, propia: true }); continue; }
    const base = porId.get(g.id);
    if (!base) continue; // una pantalla del sistema que ya no existe
    porId.delete(g.id);
    lista.push({ ...base, activo: g.activo !== false, titulo: g.titulo || base.titulo, ...(g.duracion ? { duracion: g.duracion } : {}) });
  }
  for (const base of porId.values()) lista.push({ ...base, activo: base.activoPorDefecto !== false });
  return lista;
}

/** Lo que se guarda en el backend: de las del sistema, sólo lo que se puede cambiar. */
export function paraGuardar(lista) {
  return lista.map((p) => p.propia
    ? { id: p.id, propia: true, tipo: p.tipo, titulo: p.titulo, src: p.src, activo: p.activo, ...(p.tipo !== "video" ? { duracion: p.duracion || DURACION_PREDETERMINADA } : {}) }
    : { id: p.id, activo: p.activo, titulo: p.titulo, ...(p.duracion ? { duracion: p.duracion } : {}) });
}

export const duracionDe = (p) => (p.duracion || DURACION_PREDETERMINADA) * 1000;

export const nuevoId = () => `propia-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
