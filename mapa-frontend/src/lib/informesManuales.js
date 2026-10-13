/**
 * Estaciones cargadas a mano en Informes diarios: llegan por otro medio (WhatsApp, planilla) y se escriben con los mismos
 * datos que traen las automáticas. Cada una se convierte en una estación más, con el mismo `resumen` que arma el servidor
 * (`resumir` en informesDiarios.js), para que la tabla, el mapa, el texto y los archivos la traten igual.
 */
const num = (v) => { if (v === "" || v == null) return null; const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
const hora = (v) => (/^\d{1,2}:\d{2}$/.test(v || "") ? v.padStart(5, "0") : null);

export const manualVacia = (n = 1) => ({
  id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
  nombre: `Estación manual ${n}`, fuente: "", municipioId: "", lat: null, lng: null,
  lluviaTotal: "", lluviaMax: "", ventana: 30, lluviaMaxHora: "", inicioLluvia: "",
  rafaga: "", rafagaHora: "", viento: "", vientoHora: "", tMax: "", tMaxHora: "", tMin: "", tMinHora: "",
  caida: "", caidaMinutos: 30, caidaHora: "",
  mes: "", media: "",
});

export const claveManual = (m) => `manual-${m.id}`;

/** ¿Escribieron algo de lluvia, viento o temperatura? Una estación sin nada no tiene datos (queda como «Sin datos»). */
export const manualConDatos = (m) => ["lluviaTotal", "lluviaMax", "rafaga", "viento", "tMax", "tMin", "caida"].some((k) => num(m[k]) != null);

/** La estación manual con la forma de las automáticas ({ clave, nombre, red, lat, lng, resumen, serie, crudo, manual }). */
export function estacionDeManual(m) {
  const lluvia = num(m.lluviaTotal), dato = (v, h, campo) => (num(v) == null ? null : { [campo]: num(v), hora: hora(h) });
  const resumen = manualConDatos(m) ? {
    registros: 0, desde: null, hasta: null,
    lluviaTotal: lluvia,
    lluvia30: lluvia == null ? null : { mm: num(m.lluviaMax) ?? 0, hora: hora(m.lluviaMaxHora), minutos: Number(m.ventana) === 60 ? 60 : 30 },
    viento: dato(m.viento, m.vientoHora, "kmh"), rafaga: dato(m.rafaga, m.rafagaHora, "kmh"),
    tMax: dato(m.tMax, m.tMaxHora, "c"), tMin: dato(m.tMin, m.tMinHora, "c"),
    caida: num(m.caida) == null ? null : { grados: num(m.caida), hora: hora(m.caidaHora), t: null, minutos: Number(m.caidaMinutos) === 60 ? 60 : 30 },
    inicioLluvia: hora(m.inicioLluvia),
    sinViento: num(m.viento) == null && num(m.rafaga) == null, sinTemperatura: num(m.tMax) == null && num(m.tMin) == null, sinLluvia: lluvia == null,
  } : null;
  return { clave: claveManual(m), nombre: (m.nombre || "Estación manual").trim(), red: "Manual", manual: true, fuente: m.fuente || "", lat: m.lat, lng: m.lng, resumen, serie: [], crudo: [], mes: num(m.mes), media: num(m.media) };
}

/** Promedios, máximos y totales de una lista de números (ignora los vacíos). */
export function estadistica(valores) {
  const v = valores.filter((x) => x != null && Number.isFinite(x));
  if (!v.length) return { n: 0, suma: null, max: null, min: null, prom: null };
  const suma = v.reduce((a, b) => a + b, 0);
  return { n: v.length, suma, max: Math.max(...v), min: Math.min(...v), prom: suma / v.length };
}
export const redondear = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Anomalía respecto de la media del mes (como en el Excel de Alerta Temprana): acumulado del mes − media. */
export const anomalia = (mes, media) => (mes == null || media == null ? null : redondear(mes - media));

/** Acumulado por día de una estación (con la serie de 10 min / horaria), para el cuadro «por día» de su hoja. */
export function porDia(e, zona = "America/Argentina/Buenos_Aires") {
  const diaDe = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(new Date(t));
  const dias = new Map();
  for (const r of e.serie || []) {
    const d = diaDe(r.t), x = dias.get(d) || { lluvia: 0, temps: [], rafaga: null };
    x.lluvia += r.lluvia || 0;
    if (r.temperatura != null) x.temps.push(r.temperatura);
    if (r.rafaga != null) x.rafaga = Math.max(x.rafaga ?? -Infinity, r.rafaga);
    dias.set(d, x);
  }
  return [...dias].sort(([a], [b]) => a.localeCompare(b)).map(([dia, x]) => ({ dia, lluvia: redondear(x.lluvia), tMin: x.temps.length ? Math.min(...x.temps) : null, tMax: x.temps.length ? Math.max(...x.temps) : null, rafaga: x.rafaga }));
}

/** Columnas y filas del dato crudo de una estación, tal cual lo manda (todos los campos). */
export function tablaCruda(e, zona = "America/Argentina/Buenos_Aires") {
  const crudo = e.crudo || [];
  const campos = [...new Set(crudo.flatMap((f) => Object.keys(f)))].filter((k) => k !== "t");
  const cuando = (t) => new Date(t).toLocaleString("es-AR", { timeZone: zona, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const celda = (v) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return { columnas: ["Fecha y hora", ...campos], filas: crudo.map((f) => [cuando(f.t), ...campos.map((k) => celda(f[k]))]) };
}

/** CSV (con BOM y «;» para que lo abra Excel en español) con el dato crudo de una estación. */
export function csvCrudo(e) {
  const { columnas, filas } = tablaCruda(e);
  const esc = (s) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return `﻿${[columnas, ...filas].map((f) => f.map(esc).join(";")).join("\r\n")}`;
}
