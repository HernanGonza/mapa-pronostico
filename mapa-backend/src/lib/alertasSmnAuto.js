const publicadasStore = require("./alertasSmnPublicadasStore");
const notificacionesStore = require("./notificacionesStore");

/**
 * Alertas del SMN (SAT): la publicación es siempre a mano (botón «Publicar en el mapa público»), pero
 * lo repetitivo se resuelve solo:
 *
 *  - Cada emisión del SMN es un informe completo (msgType «Update») que reemplaza al anterior, así que
 *    una actualización llega como una alerta «nueva». Se la empareja con la ya publicada: mismo
 *    fenómeno, períodos que se pisan y al menos un departamento en común (si además coincide el
 *    inicio, es la misma sin dudas). `estado` le dice al panel cuál es cuál y qué cambió.
 *  - Al apretar «Publicar» sobre una alerta que actualiza a una publicada, se pisan sus datos en la
 *    misma fila (nivel, horarios, zonas, texto), sin duplicarla (`publicarOActualizar`).
 *  - Al publicar o actualizar se genera la placa con el texto del SMN: «aviso de alerta» y, si cambió el
 *    nivel (y la vigencia entra en un solo día), «actualización de nivel».
 *  - Cuando llega una alerta nueva o el SMN actualiza una publicada, sólo se avisa en la campanita
 *    (`revisar`): no se publica ni se saca nada sin que una persona lo haga.
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

/** Puntaje de que la publicada `fila` y la info nueva sean la misma alerta (0 = no lo son). */
function parecido(fila, info) {
  if (fenomenoDe(fila) !== fenomenoDe(info)) return 0;
  const [i1, f1, i2, f2] = [fila.inicio, fila.fin, info.inicio, info.fin].map(Date.parse);
  if (!(i1 < f2 && i2 < f1)) return 0;
  const nuevos = new Set(departamentosDe(info));
  const comunes = departamentosDe(fila).filter((d) => nuevos.has(d)).length;
  if (!comunes) return 0;
  return (i1 === i2 ? 1000 : 0) + (f1 === f2 ? 100 : 0) + comunes;
}

/** Empareja (uno a uno, de mayor a menor parecido) las publicadas con las infos nuevas: [[fila, info]…]. */
function emparejar(filas, infos) {
  const pares = [];
  filas.forEach((f, i) => infos.forEach((n, j) => { const p = parecido(f, n); if (p) pares.push({ i, j, p }); }));
  pares.sort((a, b) => b.p - a.p);
  const usadasF = new Set(), usadasN = new Set(), res = [];
  for (const { i, j } of pares) {
    if (usadasF.has(i) || usadasN.has(j)) continue;
    usadasF.add(i); usadasN.add(j); res.push([filas[i], infos[j]]);
  }
  return res;
}

/** Qué cambió entre lo publicado y la info nueva: lista de 'nivel' | 'vigencia' | 'zonas' | 'texto'. */
function diferencias(fila, info) {
  const cambios = [];
  if (fila.categoria !== info.categoria) cambios.push("nivel");
  if (Date.parse(fila.inicio) !== Date.parse(info.inicio) || Date.parse(fila.fin) !== Date.parse(info.fin)) cambios.push("vigencia");
  if ([...departamentosDe(fila)].sort().join("|") !== [...departamentosDe(info)].sort().join("|")) cambios.push("zonas");
  if (sinTildes(fila.descripcion) !== sinTildes(info.descripcion) || sinTildes(fila.instrucciones) !== sinTildes(info.instrucciones)) cambios.push("texto");
  return cambios;
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

/** Datos de la placa «aviso de alerta» (ver generatePlacasAlerta) armados con el texto del SMN. */
function datosAviso(d, maxDescripcion = 700) {
  return { fenomeno: recortar(d.evento || d.titulo, 40), vigencia: textoVigencia(d.inicio, d.fin), zona: listaCorta(departamentosDe(d)),
    descripcion: recortar(d.descripcion || d.titulo, maxDescripcion), nota: "" };
}
function datosNivel(d, nivelAnterior, maxDescripcion = 700) {
  const r = rangoDelDia(d.inicio, d.fin);
  return r ? { fenomeno: recortar(d.evento || d.titulo, 40), nivelAnterior, zona: listaCorta(departamentosDe(d)), vigencia: r, descripcion: recortar(d.descripcion || d.titulo, maxDescripcion) } : null;
}

/** Genera y guarda una placa; si el texto no entra se acorta la descripción. Un fallo se registra y no frena nada. */
async function generarPlaca(alerta, tipo, motivo, nivelAnterior, { logger = console, generar, guardar } = {}) {
  const { generarPlacaAlertaAmbos } = generar ? { generarPlacaAlertaAmbos: generar } : require("./generatePlacasAlerta");
  const crear = guardar || publicadasStore.crearPlaca;
  const datosDe = (max) => (tipo === "nivel" ? datosNivel(alerta, nivelAnterior, max) : datosAviso(alerta, max));
  try {
    for (const max of [700, 450, 300, 200]) {
      const datos = datosDe(max);
      if (!datos) return null;
      let pngs;
      try { pngs = await generarPlacaAlertaAmbos({ tipo, nivel: alerta.categoria, datos }); }
      catch (e) { if (e.status === 400 && /demasiado largo/.test(e.message) && max > 200) continue; throw e; }
      return await crear({ alertaId: alerta.id, tipo, motivo, nivel: alerta.categoria, datos, ...pngs });
    }
  } catch (e) { logger.error(`[alertas SMN] placa «${tipo}» de la alerta ${alerta.id}: ${e.message}`); }
  return null;
}

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

/**
 * Lo que necesita el panel para «Placa del mapa»: los 17 departamentos (el de la alerta con su nivel, el resto en
 * verde), el ícono del fenómeno y la leyenda con la vigencia. `departamentos`: el catálogo ({ id, nombre }).
 */
function mapaDe(alerta, departamentos) {
  const mios = new Set(departamentosDe(alerta).map(sinTildes));
  const icono = ICONO_DE_EVENTO.find(([re]) => re.test(alerta.evento || alerta.titulo))?.[1];
  return {
    zonas: departamentos.map((d) => ({ id: String(d.id), categoria: mios.has(sinTildes(d.nombre)) ? alerta.categoria : "Verde" })),
    iconos: icono ? [{ id: icono, categoria: alerta.categoria }] : [],
    periodo: recortar(sentencia(textoVigencia(alerta.inicio, alerta.fin)), 200),
  };
}

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
      vigencia: { zonas: dias.map((d) => ({ nombre: recortar(zona, 60), ...d })), descripcion },
      ...(items ? { recomendaciones: { items } } : {}),
    },
    recomendaciones: RECOMENDACIONES_PREDETERMINADAS, iconos: ICONOS, limites: LIMITES,
  };
}

const cuando = (iso) => fmt(iso, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const titulo = (d) => `${d.titulo || d.evento} · ${d.categoria}`;
const donde = (d) => listaCorta(departamentosDe(d), 90);

function resumenCambios(antes, despues, tipos) {
  const partes = [];
  if (tipos.includes("nivel")) partes.push(`el nivel pasa de ${antes.categoria} a ${despues.categoria}`);
  if (tipos.includes("vigencia")) partes.push(`vigencia hasta el ${cuando(despues.fin)}`);
  if (tipos.includes("zonas")) partes.push("cambian las zonas");
  if (tipos.includes("texto")) partes.push("cambia el texto");
  return partes.join(" · ");
}

const publicadas = () => publicadasStore.candidatas().then((l) => l.filter((f) => f.vigente));

/**
 * Para el panel: cada publicada vigente con su correspondiente en el último informe del SMN
 * (`smnIdActual`, el id con el que la ve el panel) y, si algo cambió, `actualizacion: { tipos }`.
 * `alertas`: las SAT vigentes (unirZonas(vigentes(ultimaEmision(…)))).
 */
function estado(filas, alertas) {
  const nuevas = alertas.flatMap((a) => a.infos.map((info, i) => ({ info, smnId: `${a.id}:${i}`, pub: publicable(info) })).filter((x) => x.pub));
  const pares = emparejar(filas, nuevas.map((x) => ({ ...x.pub, _x: x })));
  return new Map(pares.map(([f, n]) => [f.id, { smnIdActual: n._x.smnId, tipos: diferencias(f, n._x.pub) }]));
}

/**
 * Publica la alerta `smnId` (botón del panel). Si actualiza a una ya publicada, pisa esa misma (y
 * saca la placa de la actualización); si no, es una publicación nueva (y sale su placa de aviso).
 * Una falla al generar la placa no frena la publicación.
 */
async function publicarOActualizar(smnId, alertas, usuarioId = null, colores = {}, { repo = publicadasStore, placas = generarPlaca, logger = console } = {}) {
  const corte = String(smnId).lastIndexOf(":");
  const a = alertas.find((x) => x.id === String(smnId).slice(0, corte));
  const info = a?.infos[Number(String(smnId).slice(corte + 1))];
  const pub = info && publicable(info);
  if (pub) {
    const vigentes = (await repo.candidatas()).filter((f) => f.vigente);
    const par = emparejar(vigentes, [{ ...pub, _x: 1 }])[0];
    if (par) {
      const f = par[0], tipos = diferencias(f, pub);
      const datos = repo.copiaDe(a, pub, colores);
      const cambio = tipos.length ? { en: new Date().toISOString(), tipos, usuarioId, antes: { categoria: f.categoria, inicio: f.inicio, fin: f.fin, departamentos: departamentosDe(f) }, despues: { categoria: pub.categoria, inicio: pub.inicio, fin: pub.fin, departamentos: departamentosDe(pub) } } : null;
      const fila = await repo.actualizarDatos(f.id, { smnId, vigenteHasta: pub.fin, datos, cambio });
      if (tipos.length) {
        const alerta = { ...fila, ...datos, id: f.id };
        (tipos.includes("nivel") && NIVELES.includes(f.categoria) && await placas(alerta, "nivel", "nivel", f.categoria, { logger })) || await placas(alerta, "aviso", "actualizacion", null, { logger });
      }
      return fila;
    }
  }
  const fila = await repo.publicar(smnId, alertas, usuarioId, colores);
  if (!(await repo.placasDe([fila.id]))[fila.id]?.length) await placas(fila, "aviso", "nueva", null, { logger });
  return fila;
}

/**
 * Avisa en la campanita de las alertas del último informe que todavía no se publicaron, y de las
 * publicadas que el SMN actualizó. No publica ni cambia nada. La `clave` evita repetir el aviso en cada consulta.
 */
async function revisar(alertas, { logger = console, repo = publicadasStore, notificar = notificacionesStore } = {}) {
  const avisados = [];
  try {
    const filas = (await repo.candidatas()).filter((f) => f.vigente);
    const nuevas = alertas.flatMap((a) => a.infos.map((info, i) => ({ info, smnId: `${a.id}:${i}`, pub: publicable(info) })).filter((x) => x.pub));
    const pares = emparejar(filas, nuevas.map((x) => ({ ...x.pub, _x: x })));
    const conPar = new Map(pares.map(([f, n]) => [n._x, f]));
    for (const x of nuevas) {
      const f = conPar.get(x), d = x.pub, tipos = f ? diferencias(f, d) : [];
      if (f && !tipos.length) continue;
      const n = f
        ? { clave: `smn:act:${f.id}:${d.categoria}:${Date.parse(d.inicio)}:${Date.parse(d.fin)}`, titulo: `El SMN actualizó una alerta publicada: ${titulo(d)}`, detalle: `${donde(d)} · ${resumenCambios(f, d, tipos)}` }
        : { clave: `smn:nueva:${fenomenoDe(d)}:${d.categoria}:${Date.parse(d.inicio)}:${Date.parse(d.fin)}`, titulo: `Alerta nueva del SMN: ${titulo(d)}`, detalle: `${donde(d)} · hasta el ${cuando(d.fin)}` };
      try { if (await notificar.crearSiNoExiste({ tipo: "alerta-smn", ...n, url: "/panel/alertas-automaticas", venceEn: d.fin })) avisados.push(n.clave); }
      catch (e) { logger.error(`[alertas SMN] notificación: ${e.message}`); }
    }
  } catch (e) { logger.error(`[alertas SMN] revisión: ${e.message}`); }
  return avisados;
}

module.exports = { baseDe, mapaDe, rangosPorDia, recomendacionesDe, revisar, estado, publicarOActualizar, emparejar, diferencias, parecido, publicable, textoVigencia, rangoDelDia, datosAviso, datosNivel, listaCorta, generarPlaca };
