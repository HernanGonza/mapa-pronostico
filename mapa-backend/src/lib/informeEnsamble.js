/**
 * Propuesta de valores para el informe «PREVISIÓN DEL TIEMPO PARA LA PROVINCIA DE MISIONES» a partir del ensamble
 * multimodelo: lo que el asistente del cajón completa solo (temperaturas, sensación térmica, humedad, lluvia y
 * viento por provincia, zona y ciudad, y el extendido). El texto de los dos días, el estado del tiempo y la alerta
 * los escribe el equipo: acá quedan vacíos. Es una propuesta: el asistente la deja editar y no pisa lo que ya se
 * escribió a mano.
 *
 * Cada número es el promedio de los modelos elegidos (ver ensamble.js). Las zonas son las del SMN (mismas listas que
 * mapa-frontend/src/lib/zonasSmn.js: Guaraní cuenta en el Norte y en el Centro); una zona promedia sus departamentos.
 */
const { pronosticoEnsamble, puntosDelEnsamble, mediaCircular, MODELOS } = require("./ensamble");

const ZONAS = {
  Sur: ["Capital", "Candelaria", "Apóstoles", "Concepción", "San Javier", "Leandro N. Alem"],
  Centro: ["San Ignacio", "Libertador General San Martín", "Oberá", "Cainguás", "25 de Mayo", "Guaraní"],
  Norte: ["Montecarlo", "Eldorado", "Iguazú", "General Manuel Belgrano", "San Pedro", "Guaraní"],
};
const ADJETIVO_ZONA = { Sur: "sur", Centro: "central", Norte: "norte" };
const RUMBOS = ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"];
const ART = "America/Argentina/Buenos_Aires";

const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const prom = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const ent = (x) => (x == null ? "" : String(Math.round(x)));
const titulo = (s) => s.toLowerCase().replace(/(^|\s|\.)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\bDel\b|\bDe\b/g, (m) => m.toLowerCase());
const rumbo = (g) => RUMBOS[Math.round((((g % 360) + 360) % 360) / 45) % 8];
/** Largo del promedio de los vectores (0–1): cerca de 1 = todos del mismo lado, cerca de 0 = direcciones dispersas. */
const resultante = (g) => { const v = g.filter((x) => x != null); return v.length ? Math.hypot(v.reduce((a, x) => a + Math.sin((x * Math.PI) / 180), 0), v.reduce((a, x) => a + Math.cos((x * Math.PI) / 180), 0)) / v.length : 0; };
const hh = (h) => String(h).padStart(2, "0");

/** El valor medio de los modelos de un punto en un día (o null). */
const valor = (punto, fecha, clave) => punto.dias.find((d) => d.fecha === fecha)?.[clave]?.media ?? null;

/** Dirección predominante de un conjunto de puntos: «sur», o «direcciones variables» si no hay una clara. */
function direccionDe(puntos, fecha) {
  const dirs = puntos.map((p) => valor(p, fecha, "dirviento")).filter((x) => x != null);
  if (!dirs.length) return null;
  return resultante(dirs) >= 0.6 ? rumbo(mediaCircular(dirs)) : null; // null = variables
}
const rango = (a, b, unidad) => { const x = Math.round(a), y = Math.round(b); return x === y ? `${x} ${unidad}` : `${x} a ${y} ${unidad}`; };

/**
 * Humedad relativa promedio de la provincia hora por hora (promedio de los 17 departamentos y de los modelos de
 * Open-Meteo elegidos): { min: { valor, hora }, max: { valor, hora } } del día `fecha`, o null si no se pudo pedir.
 */
async function humedadHoraria(fecha, modelosOpenMeteo) {
  if (!modelosOpenMeteo.length) return null;
  const pts = puntosDelEnsamble().slice(0, 17);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${pts.map((p) => p.lat.toFixed(3)).join(",")}&longitude=${pts.map((p) => p.lng.toFixed(3)).join(",")}`
    + `&hourly=relative_humidity_2m&models=${modelosOpenMeteo.join(",")}&timezone=${encodeURIComponent(ART)}&start_date=${fecha}&end_date=${fecha}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Open-Meteo: HTTP ${r.status}.`);
  const j = await r.json(), puntos = Array.isArray(j) ? j : [j], horas = puntos[0]?.hourly?.time || [];
  const clave = (m) => (modelosOpenMeteo.length === 1 ? "relative_humidity_2m" : `relative_humidity_2m_${m}`);
  const porHora = horas.map((_, i) => prom(puntos.flatMap((p) => modelosOpenMeteo.map((m) => p.hourly?.[clave(m)]?.[i] ?? null))));
  const validas = porHora.map((v, h) => ({ v, h })).filter((x) => x.v != null);
  if (!validas.length) return null;
  const min = validas.reduce((a, b) => (b.v < a.v ? b : a)), max = validas.reduce((a, b) => (b.v > a.v ? b : a));
  return { min: { valor: Math.round(min.v), hora: min.h }, max: { valor: Math.round(max.v), hora: max.h } };
}

/**
 * { emision: { fecha, hora }, diaTablas: 0|1, modelos: [ids] } → { propuesta, fechaTablas, modelos, avisos }.
 * Pide el ensamble de los 4 días desde la fecha de emisión (los dos con texto y los dos del extendido).
 */
async function propuestaInforme({ emision, diaTablas = 0, modelos }) {
  const fecha = emision?.fecha;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "")) throw Object.assign(new Error("Falta la fecha de emisión."), { status: 400 });
  const dia = diaTablas === 1 ? 1 : 0, fechaTablas = sumarDias(fecha, dia), extendido = [sumarDias(fecha, 2), sumarDias(fecha, 3)];
  const r = await pronosticoEnsamble({ desde: `${fecha}T00:00`, hasta: `${sumarDias(fecha, 3)}T23:00`, modelos });
  const avisos = [...r.avisos];
  if (r.pendientes?.length) avisos.push(`${r.pendientes.map((id) => MODELOS.find((m) => m.id === id)?.nombre || id).join(", ")} todavía se está${r.pendientes.length > 1 ? "n" : ""} descargando: esta propuesta no ${r.pendientes.length > 1 ? "los incluye" : "lo incluye"}. Volvé a completar cuando termine para sumarlo.`);
  const usados = r.modelos.map((m) => m.id);
  const deptos = r.departamentos, ciudades = r.ciudades, todos = [...deptos, ...ciudades];
  const miembros = (z) => deptos.filter((d) => ZONAS[z].includes(d.nombre));
  const media = (puntos, f, clave) => prom(puntos.map((p) => valor(p, f, clave)));
  const extremo = (clave, minimo) => { // el punto con la mínima (o la máxima) de la provincia
    const c = todos.map((p) => ({ p, v: valor(p, fechaTablas, clave) })).filter((x) => x.v != null);
    return c.length ? c.reduce((a, b) => ((minimo ? b.v < a.v : b.v > a.v) ? b : a)) : null;
  };

  // Provincia
  const tmin = extremo("tmin", true), tmax = extremo("tmax", false);
  let hum = null;
  try { hum = await humedadHoraria(fechaTablas, usados.filter((id) => !id.startsWith("wrf"))); } catch (e) { avisos.push(`No se pudo calcular la hora de la humedad: ${e.message}`); }
  const humMin = hum?.min.valor ?? media(deptos, fechaTablas, "hmin"), humMax = hum?.max.valor ?? media(deptos, fechaTablas, "hmax");
  const lluviaZonas = Object.keys(ZONAS).map((z) => ({ z, v: media(miembros(z), fechaTablas, "lluvia") })).filter((x) => x.v != null);
  const llMax = lluviaZonas.length ? lluviaZonas.reduce((a, b) => (b.v > a.v ? b : a)) : null, llMin = lluviaZonas.length ? Math.min(...lluviaZonas.map((x) => x.v)) : null;
  const velocidades = deptos.map((d) => valor(d, fechaTablas, "viento")).filter((x) => x != null);
  const dirProv = direccionDe(deptos, fechaTablas);
  const provincia = {
    tmin: { valor: ent(tmin?.v), lugar: tmin ? titulo(tmin.p.nombre) : "" },
    tmax: { valor: ent(tmax?.v), lugar: tmax ? titulo(tmax.p.nombre) : "" },
    humedad: humMin == null ? "" : `MÍN. PROMEDIO ${ent(humMin)}%${hum ? `  ${hh(hum.min.hora)} HORAS` : ""}\nMAX. PROMEDIO  ${ent(humMax)}%${hum ? `, ${hh(hum.max.hora)} HORAS` : ""}`,
    precipitaciones: !llMax ? "" : llMax.v < 1 ? "Sin precipitaciones significativas" : `${rango(llMin, llMax.v, "mm")} en zona ${ADJETIVO_ZONA[llMax.z]}`,
    vientos: velocidades.length ? `${rango(Math.min(...velocidades), Math.max(...velocidades), "km/h")}, ${dirProv ? `del ${dirProv}` : "de direcciones variables"}` : "",
  };

  // Zonas
  const zonas = Object.fromEntries(Object.keys(ZONAS).map((z) => {
    const m = miembros(z), vel = m.map((d) => valor(d, fechaTablas, "viento")).filter((x) => x != null), dir = direccionDe(m, fechaTablas);
    const smax = media(m, fechaTablas, "sensmax"), smin = media(m, fechaTablas, "sensmin"), h1 = media(m, fechaTablas, "hmin"), h2 = media(m, fechaTablas, "hmax");
    return [z, {
      tmin: ent(media(m, fechaTablas, "tmin")), tmax: ent(media(m, fechaTablas, "tmax")),
      sens: smax == null ? "" : `MAX ${ent(smax)}º C\nMIN. ${ent(smin)}º C`,
      humedad: h1 == null ? "" : `${ent(h1)} A ${ent(h2)}%`,
      vientos: vel.length ? `${dir ? dir[0].toUpperCase() + dir.slice(1) : "Variables"}\n${rango(Math.min(...vel), Math.max(...vel), "km/h")}` : "",
      estado: "", alerta: "", // las escribe el equipo
    }];
  }));

  // Ciudades y extendido
  const ciudadesFilas = ciudades.map((c) => ({ tmin: ent(valor(c, fechaTablas, "tmin")), tmax: ent(valor(c, fechaTablas, "tmax")), estado: "", alerta: "" }));
  const extendidoZonas = Object.fromEntries(Object.keys(ZONAS).map((z) => [z, extendido.map((f) => ({ fecha: f, tmin: ent(media(miembros(z), f, "tmin")), tmax: ent(media(miembros(z), f, "tmax")), estado: "", alerta: "" }))]));

  return { propuesta: { provincia, zonas, ciudades: ciudadesFilas, extendido: extendidoZonas }, fechaTablas, modelos: usados, avisos, wrfPendiente: !!r.wrf?.pendiente };
}

module.exports = { propuestaInforme, ZONAS };
