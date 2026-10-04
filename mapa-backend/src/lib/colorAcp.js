const { categorias } = require("./alertasMeteorologicas");

/**
 * Color de los avisos a muy corto plazo (ACP). El RSS/CAP del SMN no trae
 * nivel para los ACP, así que se toma el de la alerta bajo la que aparecen:
 * si la vigencia del ACP se cruza con la de una alerta (SAT del SMN o la
 * manual publicada desde el panel), el ACP es de ese color; si se cruza con
 * varias, el nivel más alto. Si el titular del ACP ya dice el nivel ("AVISO NARANJA…"),
 * se usa ése (ver nivelDeTitulo). El cruce es sólo por fecha y hora, sin mirar la zona — a
 * pedido: "hay alerta naranja, entonces todos los ACP son naranjas". Sin
 * ninguna alerta, queda el violeta de siempre.
 */
const VIOLETA = "#8b3fc4";
const NIVEL = { Amarillo: 1, Naranja: 2, Rojo: 3 };
const COLORES = Object.fromEntries(categorias.filter((c) => NIVEL[c.nombre]).map((c) => [c.nombre, c.color]));

const mayor = (a, b) => ((NIVEL[b] || 0) > (NIVEL[a] || 0) ? b : a);

/** Períodos de las infos SAT del SMN (filas ya filtradas: última emisión, vigentes). Sólo las que tocan Misiones. */
function intervalosSmn(filas = []) {
  return filas.flatMap((r) => r.infos || [])
    .filter((i) => NIVEL[i.categoria] && (i.zonas || []).some((z) => z.departamentos?.length || /\bmisiones\b/i.test(z.nombre || "")))
    .map((i) => ({ categoria: i.categoria, inicio: i.inicio, fin: i.fin }));
}

/**
 * Períodos de las alertas manuales (`pendientes()` del store): la vigente va
 * de que se publicó hasta su vigencia; la que espera en fila arranca cuando
 * vence la que espera. El nivel es el más alto de sus departamentos.
 */
function intervalosManuales({ vigentes = [], enFila = [] } = {}) {
  const todas = [...vigentes, ...enFila];
  const porId = new Map(todas.map((m) => [m.id, m]));
  const inicioDe = (m, vistos = new Set()) => {
    const previa = m.enFilaDe != null && porId.get(m.enFilaDe);
    if (!previa || vistos.has(m.id)) return m.publicadoEn;
    vistos.add(m.id);
    return previa.vigenteHasta || inicioDe(previa, vistos);
  };
  return todas.map((m) => ({ categoria: (m.zonas || []).map((z) => z.categoria).reduce(mayor, null), inicio: inicioDe(m), fin: m.vigenteHasta }))
    .filter((x) => NIVEL[x.categoria] && x.inicio && x.fin);
}

/**
 * Nivel escrito en el titular del SMN ("AVISO NARANJA POR TORMENTAS…"): el campo
 * `severity` de los ACP no lo trae, pero el titular sí. null si no lo dice.
 */
function nivelDeTitulo(texto) {
  const m = /\b(?:aviso|alerta)\s+(amarill|naranj|roj)/i.exec(String(texto || ""));
  return m ? { amarill: "Amarillo", naranj: "Naranja", roj: "Rojo" }[m[1].toLowerCase()] : null;
}

/**
 * Nivel y color de un ACP vigente de `inicio` a `fin` (ISO; sin `fin`, el
 * instante `inicio`). Primero el nivel propio del ACP (`nivelPropio`, el de su
 * titular); si no lo tiene, el de la alerta más alta cuya vigencia se cruza.
 */
function colorDeAcp(intervalos, inicio, fin = inicio, nivelPropio = null) {
  if (NIVEL[nivelPropio]) return { nivel: nivelPropio, color: COLORES[nivelPropio] };
  const a = Date.parse(inicio), b = Date.parse(fin);
  const nivel = intervalos
    .filter((x) => Date.parse(x.inicio) <= b && Date.parse(x.fin) > a)
    .map((x) => x.categoria).reduce(mayor, null);
  return { nivel, color: nivel ? COLORES[nivel] : VIOLETA };
}

/** Todos los períodos de alerta conocidos ahora (SMN + manuales). Si una fuente falla, se sigue con la otra. */
async function intervalosAlertas() {
  const [smn, manuales] = await Promise.all([
    import("./smn/store.mjs").then(async ({ actual }) => {
      const { ultimaEmision, vigentes } = await import("./smn/cap.mjs");
      return intervalosSmn(vigentes(ultimaEmision((await actual("SAT"))?.datos || [])));
    }).catch((e) => { console.error("[colorAcp] SMN:", e.message); return []; }),
    require("./alertasMeteorologicasStore").pendientes().then(intervalosManuales)
      .catch((e) => { console.error("[colorAcp] alertas manuales:", e.message); return []; }),
  ]);
  return [...smn, ...manuales];
}

module.exports = { VIOLETA, COLORES, intervalosSmn, intervalosManuales, colorDeAcp, nivelDeTitulo, intervalosAlertas };
