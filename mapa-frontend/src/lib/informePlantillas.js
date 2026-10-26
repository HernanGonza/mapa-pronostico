/**
 * Los informes de «Previsión del tiempo» (formato 2): 5 botones, 3 plantillas. Lo que cambia entre ellas es la vigencia y qué
 * temperaturas lleva el primer día; los días 2 y 3 son siempre mínimas y máximas.
 *
 *   A  · 1° informe lunes a sábado (12 h, vigencia hasta las 18 h): día 1 = lo que resta del día → máximas y nocturnas, sin presión.
 *   B  · 2° informe lunes a sábado (18 h, hasta las 23:59) = 1° del domingo: día 1 = sólo nocturnas.
 *   C  · 3° informe lunes a sábado (00 h, hasta las 12 h) = 2° del domingo: tres días completos, mínimas y máximas.
 *
 * El borrador es autodescriptivo (cada día lleva sus `temps` y si lleva `presion`), así el PDF y las validaciones no necesitan
 * conocer las plantillas. La fecha del borrador (`fecha`) es el «día de trabajo»: el del 3° informe sale a las 00 h del día
 * siguiente, así que su primer día de pronóstico es `fecha` + 1.
 */
import { masSevera, CATALOGO } from "./condiciones.js";

export const ZONAS_ORDEN = ["Sur", "Centro", "Norte"];
export const CIUDADES = ["POSADAS", "APÓSTOLES", "SAN JAVIER", "LEANDRO ALEM", "OBERÁ", "JARDÍN AMÉRICA", "ARISTÓBULO DEL VALLE", "SAN VICENTE", "MONTECARLO", "ELDORADO", "SAN PEDRO", "BERNARDO DE IRIGOYEN", "PUERTO IGUAZÚ"];

export const ROTULO_TEMP = { tmax: "Temperaturas máximas", tmin: "Temperaturas mínimas", tnoct: "Temperaturas nocturnas" };
export const CORTO_TEMP = { tmax: "Máxima", tmin: "Mínima", tnoct: "Nocturna" };

const MIN_MAX = { temps: ["tmin", "tmax"], presion: true };
export const PLANTILLAS = {
  A: { vigenciaHasta: "18:00", sigueDia: false, dias: [{ temps: ["tmax", "tnoct"], presion: false, hoy: true }, MIN_MAX, MIN_MAX] },
  B: { vigenciaHasta: "23:59", sigueDia: false, dias: [{ temps: ["tnoct"], presion: true }, MIN_MAX, MIN_MAX] },
  C: { vigenciaHasta: "12:00", sigueDia: true, dias: [MIN_MAX, MIN_MAX, MIN_MAX] },
};
export const BOTONES = [
  { id: "ls1", grupo: "Lunes a sábado", nombre: "1° informe", salida: "12:00", plantilla: "A", domingo: false, resumen: "Sale a las 12 h · vigencia hasta las 18 h · hoy: máximas y nocturnas" },
  { id: "ls2", grupo: "Lunes a sábado", nombre: "2° informe", salida: "18:00", plantilla: "B", domingo: false, resumen: "Sale a las 18 h · vigencia hasta las 23:59 · hoy: sólo nocturnas" },
  { id: "ls3", grupo: "Lunes a sábado", nombre: "3° informe", salida: "00:00", plantilla: "C", domingo: false, resumen: "Sale a las 00 h · vigencia hasta las 12 h · 3 días de mínimas y máximas" },
  { id: "do1", grupo: "Domingo", nombre: "1° informe", salida: "18:00", plantilla: "B", domingo: true, resumen: "Sale a las 18 h · vigencia hasta las 23:59 · hoy: sólo nocturnas" },
  { id: "do2", grupo: "Domingo", nombre: "2° informe", salida: "00:00", plantilla: "C", domingo: true, resumen: "Sale a las 00 h (ya lunes) · vigencia hasta las 12 h · 3 días de mínimas y máximas" },
];
export const botonDe = (id) => BOTONES.find((x) => x.id === id);
export const nombreDeBoton = (id) => { const x = botonDe(id); return x ? `${x.nombre} · ${x.grupo.toLowerCase()}` : "Informe"; };

// --- fechas ------------------------------------------------------------------------------------------------------
const AR = "America/Argentina/Buenos_Aires";
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const hoyART = () => new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(new Date());
const horaART = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: AR, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
export const sumarDias = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const diaSemana = (f) => new Date(`${f}T12:00:00Z`).getUTCDay();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const nombreDia = (f) => cap(DIAS[diaSemana(f)]);
export const fechaDia = (f) => { const d = new Date(`${f}T12:00:00Z`); return `${nombreDia(f)} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`; };
export const fechaCorta = (f) => f.split("-").reverse().join("/");

/** Día de trabajo sugerido: hoy; el 3° informe (00 h) se arma de madrugada, cuando el día de trabajo todavía es el de ayer. */
export function fechaSugerida(botonId) {
  const b = botonDe(botonId);
  const hoy = hoyART();
  return PLANTILLAS[b.plantilla].sigueDia && horaART() < 12 ? sumarDias(hoy, -1) : hoy;
}

// --- borrador ------------------------------------------------------------------------------------------------------
const rangoVacio = () => ({ desde: "", hasta: "" });
function diaVacio(cfg, fecha) {
  return {
    fecha, temps: cfg.temps, presion: cfg.presion, hoy: !!cfg.hoy, resumen: "",
    zonas: Object.fromEntries(ZONAS_ORDEN.map((z) => [z, Object.fromEntries(cfg.temps.map((t) => [t, rangoVacio()]))])),
    humedad: rangoVacio(), presionRango: rangoVacio(), precipitaciones: "Sin probabilidades", vientos: "", alertas: "",
    ciudades: CIUDADES.map((ciudad) => ({ ciudad, ...Object.fromEntries(cfg.temps.map((t) => [t, ""])), condicion: "", alerta: "s/a" })),
  };
}
/** Las fechas que dependen del día de trabajo: los tres días y la vigencia. */
function conFechas(b) {
  const p = PLANTILLAS[b.plantilla], primero = sumarDias(b.fecha, p.sigueDia ? 1 : 0);
  return { ...b, vigencia: { hasta: p.vigenciaHasta, fecha: p.sigueDia ? primero : b.fecha }, dias: b.dias.map((d, i) => ({ ...d, fecha: sumarDias(primero, i) })) };
}
export function borradorNuevo(botonId, fecha = fechaSugerida(botonId)) {
  const x = botonDe(botonId), p = PLANTILLAS[x.plantilla];
  return conFechas({ version: 2, boton: botonId, plantilla: x.plantilla, fecha, emision: x.salida, dias: p.dias.map((cfg) => diaVacio(cfg, fecha)) });
}

/** Nuevo informe con los datos del último, manteniendo el tipo/fechas elegidos y emparejando las ciudades por nombre. */
export function borradorDesdeUltimo(botonId, ultimo, fecha = fechaSugerida(botonId)) {
  const nuevo = borradorNuevo(botonId, fecha), anterior = ultimo?.borrador;
  if (anterior?.version !== 2 || !Array.isArray(anterior.dias)) return nuevo;
  const dias = nuevo.dias.map((d, i) => {
    const a = anterior.dias[i];
    if (!a) return d;
    const zonas = Object.fromEntries(ZONAS_ORDEN.map((z) => [z, {
      ...d.zonas[z],
      ...Object.fromEntries(d.temps.map((t) => [t, a.zonas?.[z]?.[t] ? { ...d.zonas[z][t], ...a.zonas[z][t] } : d.zonas[z][t]])),
    }]));
    const ciudadesAnteriores = new Map((a.ciudades || []).map((c) => [c.ciudad, c]));
    const ciudades = d.ciudades.map((c) => {
      const previa = ciudadesAnteriores.get(c.ciudad);
      if (!previa) return c;
      return { ...c, ...Object.fromEntries(d.temps.filter((t) => previa[t] != null).map((t) => [t, previa[t]])), condicion: previa.condicion ?? c.condicion, alerta: previa.alerta ?? c.alerta };
    });
    return {
      ...d, resumen: a.resumen ?? d.resumen, zonas, ciudades,
      humedad: a.humedad ? { ...d.humedad, ...a.humedad } : d.humedad,
      presionRango: d.presion && a.presionRango ? { ...d.presionRango, ...a.presionRango } : d.presionRango,
      precipitaciones: a.precipitaciones ?? d.precipitaciones,
      vientos: a.vientos ?? d.vientos,
      alertas: a.alertas ?? d.alertas,
    };
  });
  return { ...nuevo, dias };
}

/** Copia de `obj` con `valor` en `camino` ("dias.0.zonas.Sur.tmax.desde"). */
const poner = (obj, camino, valor) => {
  const [k, ...resto] = camino.split(".");
  const copia = Array.isArray(obj) ? [...obj] : { ...obj };
  copia[k] = resto.length ? poner(obj[k], resto.join("."), valor) : valor;
  return copia;
};
export function conCampoV2(b, camino, valor) {
  const n = poner(b, camino, valor);
  return camino === "fecha" ? conFechas(n) : n;
}
/** ¿Se escribió algo? (si no, descartarlo no pierde nada). */
export function conAlgoV2(b) {
  const vacio = borradorNuevo(b.boton, b.fecha);
  const sin = (x) => JSON.stringify({ ...x, fecha: null, vigencia: null, dias: x.dias.map((d) => ({ ...d, fecha: null })) });
  return sin(b) !== sin(vacio);
}

// --- texto --------------------------------------------------------------------------------------------------------
const entero = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return String(v ?? "").trim() !== "" && Number.isInteger(n); };
const num = (v) => Number(String(v).replace(",", "."));
/** «20° C a 22° C» (o «20° C» si es un solo valor). */
export function textoRango(r, unidad = "°C") {
  if (!r || String(r.desde ?? "").trim() === "") return "";
  const u = (x) => (unidad === "%" ? `${x}%` : unidad === "°C" ? `${x}° C` : `${x} ${unidad}`);
  return String(r.hasta ?? "").trim() === "" || num(r.hasta) === num(r.desde) ? u(r.desde) : unidad === "%" ? `${r.desde}% - ${r.hasta}%` : `${u(r.desde)} a ${u(r.hasta)}`;
}

// --- validación ---------------------------------------------------------------------------------------------------
const revisarRango = (nombre, r, [min, max], p) => {
  if (!entero(r.desde)) { p.push(`${nombre}: falta el valor`); return; }
  if (String(r.hasta ?? "").trim() !== "" && !entero(r.hasta)) { p.push(`${nombre}: el «hasta» no es un número`); return; }
  const d = num(r.desde), h = String(r.hasta ?? "").trim() === "" ? d : num(r.hasta);
  if (d < min || d > max || h < min || h > max) p.push(`${nombre}: fuera de rango (de ${min} a ${max})`);
  else if (d > h) p.push(`${nombre}: el primer valor supera al segundo`);
};
const ETIQ_TEMP = { tmax: "máxima", tmin: "mínima", tnoct: "nocturna" };
/** Lo que falta o está mal en el informe (lista vacía = completo). Cada texto dice dónde. */
export function problemasV2(b) {
  const p = [];
  const x = botonDe(b.boton);
  if (x) {
    const dom = diaSemana(b.fecha) === 0;
    if (x.domingo && !dom) p.push(`El día de trabajo es ${nombreDia(b.fecha).toLowerCase()}, pero este es un informe de domingo`);
    if (!x.domingo && dom) p.push("El día de trabajo es domingo, pero este es un informe de lunes a sábado");
  }
  b.dias.forEach((d, i) => {
    const D = `Día ${i + 1} (${fechaCorta(d.fecha)})`;
    if (!d.resumen.trim()) p.push(`${D}: falta el texto del día`);
    for (const z of ZONAS_ORDEN) for (const t of d.temps) revisarRango(`${D}, ${z}, ${ETIQ_TEMP[t]}`, d.zonas[z][t], [-15, 55], p);
    if (d.temps.includes("tmin") && d.temps.includes("tmax")) {
      for (const z of ZONAS_ORDEN) { const a = d.zonas[z].tmin, c = d.zonas[z].tmax; if (entero(a.desde) && entero(c.desde) && num(a.desde) > num(c.hasta || c.desde)) p.push(`${D}, ${z}: la mínima supera la máxima`); }
    }
    revisarRango(`${D}, humedad`, d.humedad, [0, 100], p);
    if (d.presion) revisarRango(`${D}, presión`, d.presionRango, [900, 1100], p);
    if (!d.precipitaciones.trim()) p.push(`${D}: faltan las precipitaciones`);
    if (!d.vientos.trim()) p.push(`${D}: faltan los vientos`);
    d.ciudades.forEach((c) => {
      for (const t of d.temps) if (!entero(c[t]) || num(c[t]) < -15 || num(c[t]) > 55) p.push(`${D}, ${c.ciudad}: falta la ${ETIQ_TEMP[t]} (número de −15 a 55)`);
      if (d.temps.includes("tmin") && d.temps.includes("tmax") && entero(c.tmin) && entero(c.tmax) && num(c.tmin) > num(c.tmax)) p.push(`${D}, ${c.ciudad}: la mínima supera la máxima`);
      if (!c.condicion?.trim()) p.push(`${D}, ${c.ciudad}: falta el estado del tiempo`);
    });
  });
  return p;
}

// --- mapa público -------------------------------------------------------------------------------------------------
/**
 * Lo que un informe publica en el mapa: las 13 ciudades de UN día (mín y máx) y las 3 zonas a los días que siguen. El día
 * principal es el primero que trae mínima y máxima: el día 1 del 3° informe (y del 2° del domingo); en el 1° y 2° informe el día 1
 * trae sólo máximas/nocturnas, así que el mapa arranca en el día 2 y nunca se publica un valor que no está en el informe.
 */
const LOCALIDAD_MAPA = { "LEANDRO ALEM": "L. N. ALEM", "ARISTÓBULO DEL VALLE": "A. DEL VALLE", "BERNARDO DE IRIGOYEN": "BDO. DE IRIGOYEN" };
const ZONA_DE = {
  Norte: ["MONTECARLO", "ELDORADO", "SAN PEDRO", "BERNARDO DE IRIGOYEN", "PUERTO IGUAZÚ"],
  Centro: ["OBERÁ", "JARDÍN AMÉRICA", "ARISTÓBULO DEL VALLE", "SAN VICENTE"],
  Sur: ["POSADAS", "LEANDRO ALEM", "APÓSTOLES", "SAN JAVIER"],
};
const zonaDe = (ciudad) => Object.keys(ZONA_DE).find((z) => ZONA_DE[z].includes(ciudad));
export const diaPrincipal = (b) => Math.max(0, b.dias.findIndex((d) => d.temps.includes("tmin") && d.temps.includes("tmax")));
const etiquetaDia = (f) => { const hoy = hoyART(); return f === hoy ? "Hoy" : f === sumarDias(hoy, 1) ? "Mañana" : nombreDia(f); };
/** El estado del tiempo de la zona es el más severo de sus ciudades (el texto completo de esa ciudad); si empatan, el de la primera. */
const gravedad = (t) => { const c = masSevera(t); return c ? CATALOGO.indexOf(c) : -1; };
const masSeveraDe = (xs) => xs.reduce((a, x) => (a === undefined || gravedad(x) > gravedad(a) ? x : a), undefined) ?? "";
const fechaLargaMapa = (f) => { const d = new Date(`${f}T12:00:00Z`); return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`; };

export function aMapaV2(b) {
  const i0 = diaPrincipal(b), principal = b.dias[i0];
  const filas = principal.ciudades.map((c) => ({ LOCALIDAD: LOCALIDAD_MAPA[c.ciudad] || c.ciudad, TMIN: c.tmin, TMAX: c.tmax, CONDICION: c.condicion, ZONA: zonaDe(c.ciudad) }));
  // Los días anteriores al principal (el "Hoy" de las emisiones de tarde/noche, que sólo traen máxima y nocturna) también van al extendido:
  // la mínima es la temperatura nocturna.
  const tmaxDe = (z) => z.tmax?.hasta || z.tmax?.desde, tminDe = (z) => (z.tmin || z.tnoct)?.desde;
  const dias = b.dias.filter((d, k) => k >= i0 || (d.temps.includes("tmax") && ZONAS_ORDEN.every((zn) => tmaxDe(d.zonas[zn]) !== "" && tmaxDe(d.zonas[zn]) !== undefined)));
  const zonas = ["Sur", "Centro", "Norte"].map((zona) => ({ zona, dias: dias.map((d) => {
    const z = d.zonas[zona], k = b.dias.indexOf(d);
    return {
      etiqueta: k <= i0 ? etiquetaDia(d.fecha) : nombreDia(d.fecha), fecha: fechaLargaMapa(d.fecha), ...(k === i0 ? { principal: true } : {}),
      tmin: tminDe(z), tmax: tmaxDe(z),
      condicion: masSeveraDe(d.ciudades.filter((c) => zonaDe(c.ciudad) === zona).map((c) => c.condicion)),
    };
  }) }));
  const informes = dias.map((d) => ({
    dia: nombreDia(d.fecha), fecha: fechaLargaMapa(d.fecha),
    texto: [d.resumen, d.precipitaciones && `Precipitaciones: ${d.precipitaciones}.`, d.vientos && `Vientos: ${d.vientos}.`].map((t) => String(t ?? "").trim()).filter(Boolean).join(" ").slice(0, 800),
  }));
  return { filas, extendido: { zonas, informes }, fecha: principal.fecha };
}
/** Para el mapa hace falta el informe completo (el mismo control del paso final). */
export const problemasMapaV2 = (b) => problemasV2(b);
