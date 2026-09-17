/**
 * Catálogo fijo de tipos de evento meteorológico puntual (tornado,
 * granizo, etc.) para el registro histórico — ver
 * `eventosClimaticosStore.js`. "otro" permite texto libre en
 * `tipo_otro` cuando ninguno de los fijos aplica, sin tener que tocar
 * este catálogo cada vez que aparece un caso nuevo. Para agregar un tipo
 * de verdad nuevo (que se quiera poder filtrar/graficar aparte), alcanza
 * con sumarlo acá — no hace falta migración de base.
 */

const TIPOS_EVENTO = [
  { id: "tornado", etiqueta: "Tornado", color: "#5b3a8e" },
  { id: "granizo", etiqueta: "Granizo", color: "#3b8fc4" },
  { id: "inundacion", etiqueta: "Inundación", color: "#1f5fa8" },
  { id: "sequia", etiqueta: "Sequía", color: "#b5651d" },
  { id: "helada", etiqueta: "Helada", color: "#5aa9c9" },
  { id: "tormenta_severa", etiqueta: "Tormenta severa / vientos fuertes", color: "#c9346c" },
  { id: "otro", etiqueta: "Otro", color: "#6b7a70" },
];

const SEVERIDADES = ["leve", "moderado", "severo"];

const IDS_TIPO = new Set(TIPOS_EVENTO.map((t) => t.id));

function tipoValido(tipo) {
  return IDS_TIPO.has(tipo);
}

function severidadValida(severidad) {
  return severidad == null || SEVERIDADES.includes(severidad);
}

module.exports = { TIPOS_EVENTO, SEVERIDADES, tipoValido, severidadValida };
