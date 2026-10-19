const notificacionesStore = require("./notificacionesStore");

/**
 * Lo que el módulo principal de alertas toma de las emisiones del SMN (SAT):
 *  - helpers de texto y de horarios que usa alertasSmnBase.js para armar la base de una alerta;
 *  - `revisar`: avisa en la campanita cuando llega una alerta nueva o el SMN corrige una ya publicada
 *    en «Alertas meteorológicas». No publica ni saca nada: publicar es siempre a mano.
 */
const AR = "America/Argentina/Buenos_Aires";
const NIVELES = ["Amarillo", "Naranja", "Rojo"];
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const departamentosDe = (a) => [...new Set((a.zonas || []).flatMap((z) => z.departamentos || []))];
const fenomenoDe = (a) => sinTildes(a.evento || a.titulo);

/** Lo que se publica de la info del SMN: sólo las zonas de Misiones con su polígono. null si no hay nada publicable. */
function publicable(info) {
  if (!NIVELES.includes(info.categoria)) return null;
  const zonas = (info.zonas || []).filter((z) => z.geometry && z.departamentos?.length);
  return zonas.length ? { ...info, zonas } : null;
}

// ——— textos de las placas ———

const diaAR = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(new Date(t));
const fmt = (t, o) => new Date(t).toLocaleString("es-AR", { timeZone: AR, hourCycle: "h23", ...o });
// Los CAP del SMN terminan en :59 («14:59:59»): en la placa se lee como la hora redonda.
const redondeado = (iso) => Date.parse(iso) + (new Date(iso).getUTCSeconds() === 59 ? 1000 : 0);

/** Minutos desde las 0:00 (hora argentina) del día de `desdeIso`, o null si no entra en ese día (hasta las 24:00). */
function rangoDelDia(inicio, fin) {
  const dia = diaAR(inicio), base = Date.parse(`${dia}T00:00:00-03:00`);
  const a = Math.round((Date.parse(inicio) - base) / 60000), b = Math.round((redondeado(fin) - base) / 60000);
  const hora = (m) => (m === 1440 ? "24:00" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return b <= 1440 && b > a ? { fecha: dia, desde: hora(a), hasta: hora(b) } : null;
}

function textoVigencia(inicio, fin) {
  // Por partes: con weekday + fecha corta el ICU de Node separa con «-» en vez de «/».
  const dia = (t) => `${fmt(t, { weekday: "long" })} ${fmt(t, { day: "2-digit" })}/${fmt(t, { month: "2-digit" })}`;
  const hora = (t) => fmt(t, { hour: "2-digit", minute: "2-digit" });
  const f = redondeado(fin);
  const r = rangoDelDia(inicio, fin);
  if (r) return `${dia(inicio)} de ${r.desde} a ${r.hasta} horas`;
  return `desde el ${dia(inicio)} a las ${hora(inicio)} hasta el ${dia(f)} a las ${hora(f)} horas`;
}

function listaCorta(departamentos, max = 150) {
  const lista = (l) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} y ${l.at(-1)}` : l[0] || "");
  for (let n = departamentos.length; n > 0; n--) {
    const resto = departamentos.length - n;
    const t = resto ? `${departamentos.slice(0, n).join(", ")} y ${resto} ${resto === 1 ? "departamento más" : "departamentos más"}` : lista(departamentos);
    if (t.length <= max) return t;
  }
  return "Misiones";
}

const recortar = (s, max) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max - 1), punto = corte.lastIndexOf(". ");
  return punto > max * 0.5 ? corte.slice(0, punto + 1) : `${corte.replace(/\s+\S*$/, "")}…`;
};

// ——— con qué arrancan los asistentes de placas (lo mismo que en el panel manual, pero con lo del SMN) ———

/** Un renglón por día de la vigencia (hasta 4): { fecha, desde, hasta } en hora argentina; 24:00 = medianoche. */
function rangosPorDia(inicio, fin, max = 4) {
  const hora = (m) => (m === 1440 ? "24:00" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  const f = redondeado(fin), res = [];
  for (let dia = diaAR(inicio); res.length < max; dia = diaAR(Date.parse(`${dia}T12:00:00-03:00`) + 864e5)) {
    const base = Date.parse(`${dia}T00:00:00-03:00`);
    if (base >= f) break;
    const a = Math.max(0, Math.round((Date.parse(inicio) - base) / 60000)), b = Math.min(1440, Math.round((f - base) / 60000));
    if (b > a) res.push({ fecha: dia, desde: hora(a), hasta: hora(b) });
  }
  return res;
}

const ICONO_POR_PALABRA = [[/viento|objeto|vuel/i, "objetos"], [/arroyo|inund|cruz|anega/i, "arroyos"], [/resguard|refug|techo|circul|abrig|reparo/i, "resguardo"], [/informa|oficial|pronóstico|pronostico/i, "informado"], [/911|emergencia|defensa civil/i, "emergencias"]];
/** Las instrucciones del SMN como lista de recomendaciones (texto + ícono por palabras clave), o null si no trae. */
function recomendacionesDe(instrucciones) {
  const items = String(instrucciones || "").split(/\n+|(?<=[.!?])\s+/).map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t.length > 3).slice(0, 7)
    .map((t) => ({ texto: recortar(t, 140), icono: ICONO_POR_PALABRA.find(([re]) => re.test(t))?.[1] || "alerta" }));
  return items.length ? items : null;
}

const ICONO_DE_EVENTO = [[/tormenta/i, "tormentas"], [/viento/i, "vientos-fuertes"], [/granizo/i, "granizo"], [/lluvia|precipit/i, "lluvias-intensas"], [/inunda/i, "inundacion"]];
const sentencia = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** Lo mismo que `/placas/ultimos` del panel manual, pero armado con la alerta del SMN: textos, niveles y horarios ya cargados. */
function baseDe(alerta, { RECOMENDACIONES_PREDETERMINADAS, ICONOS, LIMITES }) {
  const fenomeno = recortar(alerta.evento || alerta.titulo, 40), zona = listaCorta(departamentosDe(alerta)), descripcion = recortar(alerta.descripcion || alerta.titulo, LIMITES.descripcion);
  const dias = rangosPorDia(alerta.inicio, alerta.fin);
  const ultimoCambioDeNivel = [...(alerta.cambios || [])].reverse().find((c) => c.tipos?.includes("nivel"));
  const nivelAnterior = ultimoCambioDeNivel?.antes?.categoria || ["Verde", ...NIVELES][Math.max(0, NIVELES.indexOf(alerta.categoria))];
  const items = recomendacionesDe(alerta.instrucciones);
  return {
    ultimos: {
      aviso: { fenomeno, vigencia: textoVigencia(alerta.inicio, alerta.fin), zona, descripcion, nota: "" },
      nivel: { fenomeno, nivelAnterior, zona, vigencia: dias[0] || null, descripcion },
      vigencia: { zonas: dias.map((d) => ({ nombre: recortar(zona, 60), nivel: alerta.categoria, ...d })), descripcion },
      ...(items ? { recomendaciones: { items } } : {}),
    },
    recomendaciones: RECOMENDACIONES_PREDETERMINADAS, iconos: ICONOS, limites: LIMITES,
  };
}

const cuando = (iso) => fmt(iso, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Avisa en la campanita de la última emisión del SMN si todavía no está en «Alertas meteorológicas» (alerta nueva) o si corrige
 * una ya publicada (se reconoce por sus horarios: ver alertasSmnBase.clasificar). La `clave` evita repetir el aviso en cada consulta.
 * `alertas`: las SAT vigentes (unirZonas(vigentes(ultimaEmision(…)))).
 */
async function revisar(alertas, { logger = console, notificar = notificacionesStore, ahora = Date.now(),
  pendientes = () => require("./alertasMeteorologicasStore").pendientes(), departamentos = () => require("./departamentos").loadDepartamentos() } = {}) {
  const avisados = [];
  try {
    const base = require("./alertasSmnBase");
    const cand = base.candidata(alertas, departamentos(), { ahora });
    if (!cand) return avisados;
    const { vigentes, enFila } = await pendientes();
    const { yaPublicada, actualizaA } = base.clasificar(cand, [...vigentes, ...enFila]);
    if (yaPublicada || (actualizaA && !actualizaA.cambios.length)) return avisados;
    const nombre = `${cand.fenomenos.join(" y ")} · ${cand.categoria}`, donde = listaCorta(cand.departamentos, 90);
    const clave = `${cand.niveles.join("")}:${Date.parse(cand.inicio)}:${Date.parse(cand.fin)}`;
    const cambios = { vigencia: `vigencia hasta el ${cuando(cand.fin)}`, nivel: actualizaA?.antes ? `el nivel pasa de ${actualizaA.antes.niveles.join(" y ")} a ${cand.niveles.join(" y ")}` : "cambia el nivel", zonas: "cambian los departamentos" };
    const n = actualizaA
      ? { clave: `smn:act:${actualizaA.id}:${clave}`, titulo: `El SMN actualizó una alerta publicada: ${nombre}`, detalle: `${donde} · ${actualizaA.cambios.map((c) => cambios[c]).filter(Boolean).join(" · ")}` }
      : { clave: `smn:nueva:${cand.fenomenos.join("+")}:${clave}`, titulo: `Alerta nueva del SMN: ${nombre}`, detalle: `${donde} · hasta el ${cuando(cand.fin)}` };
    try { if (await notificar.crearSiNoExiste({ tipo: "alerta-smn", ...n, url: "/panel/alertas-meteorologicas?smn=1", venceEn: cand.fin })) avisados.push(n.clave); }
    catch (e) { logger.error(`[alertas SMN] notificación: ${e.message}`); }
  } catch (e) { logger.error(`[alertas SMN] revisión: ${e.message}`); }
  return avisados;
}

module.exports = { redondeado, recortar, sinTildes, sentencia, ICONO_DE_EVENTO, departamentosDe, baseDe, rangosPorDia, recomendacionesDe, revisar, publicable, textoVigencia, rangoDelDia, listaCorta };
