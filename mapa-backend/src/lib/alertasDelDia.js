const { categorias, iconos } = require("./alertasMeteorologicas");

/**
 * Las alertas meteorológicas que rigen en un día (para el campo «Alertas» de los informes del pronóstico) y las que rigen
 * ahora en cada departamento (para la tarjeta de cada municipio en el mapa público). Todo sale de lo publicado en «Alertas
 * meteorológicas» (vigentes y en fila, con la vigencia de cada nivel por departamento) y, para no depender de que alguien
 * publique primero, de la última emisión del SMN que todavía no está en la pila.
 */
const AR_OFFSET = "-03:00";
const ORDEN = { Verde: 0, Gris: 0, Amarillo: 1, Naranja: 2, Rojo: 3 };
const FEMENINO = { Amarillo: "amarilla", Naranja: "naranja", Rojo: "roja" };
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const colorDe = (nivel) => categorias.find((c) => c.nombre === nivel)?.color || null;
const nombreDeFenomeno = (id) => (iconos.find((i) => i.id === id)?.nombre || id).toLowerCase();

const hhmm = (ms) => new Date(ms).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const diaCorto = (ms) => {
  const f = (o) => new Date(ms).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", ...o });
  return `${f({ weekday: "long" })} ${f({ day: "2-digit" })}/${f({ month: "2-digit" })}`;
};

/** Tramos de nivel de un departamento: [{ nivel, desde, hasta }] (ms) entre `inicio` y el fin de la publicación. */
function lineaDe(pub, depId, inicio) {
  const base = (pub.zonasBase || pub.zonas || []).find((z) => String(z.id) === String(depId))?.categoria || "Verde";
  const fin = Date.parse(pub.vigenteHasta), tramos = pub.tramos?.[String(depId)];
  if (!Array.isArray(tramos) || !tramos.length) return [{ nivel: base, desde: inicio, hasta: fin }];
  const salida = [];
  let desde = inicio;
  for (const t of tramos) { const hasta = Math.min(Date.parse(t.hasta), fin); if (hasta > desde) salida.push({ nivel: t.categoria, desde, hasta }); desde = Math.max(desde, hasta); }
  return salida;
}

/** Cuándo empieza a verse una publicación (las que esperan en fila, al terminar la anterior). */
function inicioDe(pub, todas) {
  if (pub.vigenteDesde) return Date.parse(pub.vigenteDesde);
  if (pub.visibleDesde) return Date.parse(pub.visibleDesde);
  const previa = pub.enFilaDe != null ? todas.find((x) => x.id === pub.enFilaDe) : null;
  return Math.max(Date.parse(pub.publicadoEn), previa ? Date.parse(previa.vigenteHasta) : 0);
}

/**
 * Las alertas del día `fecha` (AAAA-MM-DD, hora de Misiones): una por publicación con algún departamento en amarillo, naranja o
 * rojo durante ese día. `pubs`: vigentes + en fila; `smn`: la base del SMN (alertasSmnBase.candidata) si todavía no se publicó.
 */
function delDia(fecha, pubs, smn = null, departamentos = []) {
  const [d0, d1] = [Date.parse(`${fecha}T00:00:00${AR_OFFSET}`), Date.parse(`${fecha}T00:00:00${AR_OFFSET}`) + 864e5];
  const nombreDep = new Map(departamentos.map((d) => [String(d.id), d.nombre]));
  const fuentes = pubs.map((p) => ({ pub: p, inicio: inicioDe(p, pubs), origen: "publicada" }));
  if (smn) fuentes.push({ pub: { id: null, zonasBase: smn.base.zonas, tramos: smn.base.tramos, vigenteHasta: smn.base.vigenteHasta, iconosBase: smn.base.iconos, periodo: smn.base.periodo }, inicio: Math.min(Date.parse(smn.inicio), Date.now()), origen: "smn" });
  const salida = [];
  for (const { pub, inicio, origen } of fuentes) {
    const afectados = []; let nivel = "Verde", desde = Infinity, hasta = -Infinity;
    for (const z of pub.zonasBase || pub.zonas || []) {
      for (const t of lineaDe(pub, z.id, inicio)) {
        const a = Math.max(t.desde, d0), b = Math.min(t.hasta, d1);
        if (b <= a || !(ORDEN[t.nivel] > 0)) continue;
        if (ORDEN[t.nivel] > ORDEN[nivel]) nivel = t.nivel;
        desde = Math.min(desde, a); hasta = Math.max(hasta, b);
        if (!afectados.includes(nombreDep.get(String(z.id)) || String(z.id))) afectados.push(nombreDep.get(String(z.id)) || String(z.id));
      }
    }
    if (nivel === "Verde") continue;
    const fenomenos = [...new Set((pub.iconosBase || pub.iconos || []).map((i) => nombreDeFenomeno(i.id)))];
    const nombre = `Alerta ${FEMENINO[nivel]}${fenomenos.length ? ` por ${fenomenos.join(" y ")}` : ""}`;
    const todoElDia = desde <= d0 && hasta >= d1 - 1000;
    const cuando = todoElDia ? "durante todo el día" : `${desde <= d0 ? "hasta" : hasta >= d1 - 1000 ? "desde" : "de"} ${desde <= d0 ? hhmm(hasta) : hasta >= d1 - 1000 ? hhmm(desde) : `${hhmm(desde)} a ${hhmm(hasta)}`}`.replace(/^(hasta|desde|de) /, (m) => `${m}las `);
    salida.push({ id: pub.id != null ? `pub:${pub.id}` : "smn", origen, nivel, color: colorDe(nivel), nombre, fenomenos, departamentos: afectados, desde: new Date(desde).toISOString(), hasta: new Date(hasta).toISOString(),
      detalle: `${diaCorto(d0 + 1)}: ${cuando} h · ${afectados.length === 17 ? "toda la provincia" : afectados.join(", ")}`, texto: `${nombre} (${cuando} h)` });
  }
  return salida.sort((a, b) => ORDEN[b.nivel] - ORDEN[a.nivel] || a.desde.localeCompare(b.desde));
}

/**
 * Nivel que rige AHORA en cada departamento según lo que se muestra en el mapa público (`vigentes`: ya con `zonas` resueltas a esta hora):
 * Map(idDepartamento → { nivel, color, fenomenos }). Un departamento sin alerta no está en el mapa.
 */
function ahoraPorDepartamento(vigentes) {
  const m = new Map();
  for (const p of vigentes) {
    const fenomenos = [...new Set((p.iconos || []).map((i) => nombreDeFenomeno(i.id)))];
    for (const z of p.zonas || []) {
      if (!(ORDEN[z.categoria] > 0)) continue;
      const previo = m.get(String(z.id));
      if (!previo || ORDEN[z.categoria] > ORDEN[previo.nivel]) m.set(String(z.id), { nivel: z.categoria, color: colorDe(z.categoria), fenomenos, hasta: p.vigenteHasta });
    }
  }
  return m;
}

module.exports = { delDia, ahoraPorDepartamento, FEMENINO };
