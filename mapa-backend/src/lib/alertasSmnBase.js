const auto = require("./alertasSmnAuto");
const { categorias, iconos } = require("./alertasMeteorologicas");

/**
 * La última emisión de alertas del SMN (SAT) armada como BASE de una alerta del módulo «Alertas meteorológicas»: lo que ese módulo
 * pide para publicar (nivel de cada departamento, fenómenos, para cuándo es, hasta cuándo se ve y la vigencia de cada nivel) sale
 * de los horarios de la emisión, para que la persona sólo revise y publique.
 *
 * El SMN parte Misiones en zonas y manda un mensaje por cada una (y por cada tramo horario): todo eso es UNA alerta para la
 * provincia, así que se junta. Para cada departamento se arma su línea de tiempo con los horarios de las infos que lo tocan (si se
 * pisan, manda el nivel más alto): eso son los `tramos` que ya sabe resolver el mapa público (ver tramosAlerta.js), de modo que
 * los niveles cambian solos a la hora que dice el SMN y la alerta se baja sola cuando termina la última.
 *
 * Cuando el SMN corrige una emisión (extiende el rango de horas, cambia un nivel…) llega como una emisión nueva: se la reconoce
 * como la misma alerta por sus horarios (mismo fenómeno, períodos que se pisan o se tocan y algún departamento en común).
 */
const ORDEN = { Verde: 0, Amarillo: 1, Naranja: 2, Rojo: 3 };
const MAX_TRAMOS = 4;
const ADELANTO_MS = 15 * 60 * 1000; // una alerta que empieza dentro de menos de esto se muestra ya, sin tramo en verde antes
const TOLERANCIA_MS = 2000; // :59:59 contra :00:00
const iso = (t) => new Date(t).toISOString();

const nivelMax = (lista) => lista.reduce((a, b) => ((ORDEN[b] || 0) > (ORDEN[a] || 0) ? b : a), "Verde");

/** Línea de tiempo de un departamento: [{ categoria, desde, hasta }] (ms), con "Verde" en los huecos, sin lo que ya pasó. */
function lineaDeTiempo(intervalos, ahora) {
  const cortes = [...new Set(intervalos.flatMap((i) => [i.desde, i.hasta]))].sort((a, b) => a - b);
  const tramos = [];
  for (let k = 0; k + 1 < cortes.length; k++) {
    const [d, h] = [cortes[k], cortes[k + 1]];
    if (h <= ahora) continue;
    const categoria = nivelMax(intervalos.filter((i) => i.desde < h && i.hasta > d).map((i) => i.categoria));
    const ultimo = tramos.at(-1);
    if (ultimo && ultimo.categoria === categoria && d - ultimo.hasta <= TOLERANCIA_MS) ultimo.hasta = h;
    else tramos.push({ categoria, desde: Math.max(d, ahora), hasta: h });
  }
  // Lo que empieza dentro de un rato se muestra ya; lo que empieza más adelante deja el departamento en verde hasta entonces.
  if (tramos[0] && tramos[0].desde - ahora <= ADELANTO_MS) tramos[0].desde = ahora;
  return tramos;
}

/** Los `tramos` de la publicación (ver tramosAlerta.js) y el nivel con el que se publica cada departamento. */
function tramosYBase(porDepto, ahora, finGlobal) {
  const tramos = {}, base = {}, avisos = [];
  for (const [id, intervalos] of porDepto) {
    let lista = lineaDeTiempo(intervalos, ahora);
    if (!lista.length) continue;
    const adelantado = lista[0].desde - ahora > ADELANTO_MS;
    base[id] = lista.find((t) => t.categoria !== "Verde")?.categoria || "Verde";
    if (adelantado) lista = [{ categoria: "Verde", desde: ahora, hasta: lista[0].desde }, ...lista];
    if (lista.length > MAX_TRAMOS) { avisos.push(`Un departamento cambia de nivel más de ${MAX_TRAMOS} veces: se muestran los primeros ${MAX_TRAMOS} tramos.`); lista = lista.slice(0, MAX_TRAMOS); }
    const simple = lista.length === 1 && lista[0].hasta >= finGlobal - TOLERANCIA_MS && !adelantado;
    if (!simple) tramos[id] = lista.map((t) => ({ categoria: t.categoria, hasta: iso(t.hasta) }));
  }
  return { tramos, base, avisos: [...new Set(avisos)] };
}

const idDe = (d) => String(d.id);

/**
 * Los fenómenos que nombra una info del SMN. El campo «evento» trae uno solo («Tormentas»), pero el texto de la alerta cuenta todo
 * lo que se espera («…abundantes precipitaciones, ocasional granizo, actividad eléctrica frecuente y ráfagas intensas»): se leen de
 * ahí los íconos del mapa. Devuelve ids del catálogo (ver alertasMeteorologicas.js), en un orden estable.
 */
const FENOMENOS_TEXTO = [
  ["tormentas-severas", /tormentas?\s+(severas?|muy fuertes)|severas?\s+tormentas?/],
  ["tormentas", /tormenta|actividad electrica|descargas electricas|\brayos?\b/],
  ["granizo", /granizo|piedra/],
  ["vientos-fuertes", /rafagas?|vientos?\s+(fuertes?|intensos?|muy fuertes?)|fuertes?\s+vientos?|\bviento\b/],
  ["lluvias-intensas", /lluvias?\s+(intensas?|fuertes?|abundantes?)|precipitaciones?\s+(intensas?|fuertes?|abundantes?)|abundantes?\s+(lluvias?|precipitaciones?)|intensas?\s+(lluvias?|precipitaciones?)|precipitacion(es)? acumulada|lluvias? torrenciales?/],
  ["inundacion", /inundacion|anegamiento|desborde|crecida/],
];
function iconosDeTexto(info) {
  const t = auto.sinTildes(`${info.evento || ""} ${info.titulo || ""} ${info.descripcion || ""}`);
  const ids = FENOMENOS_TEXTO.filter(([, re]) => re.test(t)).map(([id]) => id);
  // «severas» ya dice más que «tormentas»: no se ponen los dos.
  return ids.includes("tormentas-severas") ? ids.filter((id) => id !== "tormentas") : ids;
}

/**
 * La base de la última emisión, o null si no hay nada publicable.
 * `alertas`: las SAT vigentes de `obtenerActual()` (ya con las zonas unidas); `departamentos`: el catálogo ({ id, nombre }).
 */
function candidata(alertas, departamentos, { ahora = Date.now() } = {}) {
  const infos = [];
  for (const a of alertas || []) a.infos.forEach((info, i) => { const pub = auto.publicable(info); if (pub) infos.push({ ...pub, _smnId: `${a.id}:${i}`, _emitidoEn: a.emitidoEn }); });
  if (!infos.length) return null;
  const idPorNombre = new Map(departamentos.map((d) => [auto.sinTildes(d.nombre), idDe(d)]));
  const sinId = new Set();

  // Intervalos por departamento (el fin del SMN, «…:59:59», se lee como la hora redonda).
  const porDepto = new Map();
  for (const info of infos) {
    const desde = Date.parse(info.inicio), hasta = auto.redondeado(info.fin);
    for (const nombre of auto.departamentosDe(info)) {
      const id = idPorNombre.get(auto.sinTildes(nombre));
      if (!id) { sinId.add(nombre); continue; }
      if (!porDepto.has(id)) porDepto.set(id, []);
      porDepto.get(id).push({ categoria: info.categoria, desde, hasta });
    }
  }
  const inicio = Math.min(...infos.map((i) => Date.parse(i.inicio))), fin = Math.max(...infos.map((i) => auto.redondeado(i.fin)));
  const { tramos, base, avisos } = tramosYBase(porDepto, ahora, fin);
  if (sinId.size) avisos.push(`El SMN nombra departamentos que no están en el mapa: ${[...sinId].join(", ")}.`);

  const zonas = departamentos.map((d) => ({ id: idDe(d), categoria: base[idDe(d)] || "Verde" }));
  const nivelesPorFenomeno = new Map(), sinIcono = new Set();
  for (const info of infos) {
    const ids = iconosDeTexto(info);
    if (!ids.length) sinIcono.add(auto.recortar(info.evento || info.titulo, 40));
    for (const f of ids) nivelesPorFenomeno.set(f, [...(nivelesPorFenomeno.get(f) || []), info.categoria]);
  }
  // Un fenómeno que no tiene ícono en el mapa (ej. «Temperaturas extremas») no se elige solo: se avisa para agregarlo a mano.
  for (const f of sinIcono) avisos.push(`El SMN trae «${f}» y ese fenómeno no tiene ícono en el mapa: agregalo a mano con «Editar mapa» si hace falta.`);
  const iconos = [...nivelesPorFenomeno].map(([id, niveles]) => {
    const orden = [...new Set(niveles)].sort((a, b) => ORDEN[b] - ORDEN[a]);
    return { id, categoria: orden[0], ...(orden[1] ? { categoria2: orden[1] } : {}) };
  });

  // La alerta «entera» (para los textos de las placas): el nivel más alto, el rango completo y todos los departamentos.
  const principal = [...infos].sort((a, b) => ORDEN[b.categoria] - ORDEN[a.categoria] || Date.parse(a.inicio) - Date.parse(b.inicio))[0];
  const todos = [...new Set(infos.flatMap(auto.departamentosDe))];
  const fenomenos = [...new Set(infos.map((i) => auto.recortar(i.evento || i.titulo, 40)))];
  const entera = { ...principal, evento: fenomenos.join(" y "), titulo: fenomenos.join(" y "), categoria: nivelMax(infos.map((i) => i.categoria)), inicio: iso(inicio), fin: iso(fin - 1000),
    zonas: [{ departamentos: todos }] };
  const emision = infos.map((i) => i._emitidoEn).sort().at(-1);
  const colorDe = (n) => categorias.find((c) => c.nombre === n)?.color || null;

  return {
    emision, smnIds: infos.map((i) => i._smnId), fenomenos, categoria: entera.categoria, color: colorDe(entera.categoria),
    fenomenosLeidos: [...nivelesPorFenomeno.keys()].map((id) => iconos.find((i) => i.id === id)?.nombre || id),
    niveles: [...new Set(infos.map((i) => i.categoria))].sort((a, b) => ORDEN[b] - ORDEN[a]), departamentos: todos,
    inicio: iso(inicio), fin: iso(fin), emitidoEn: emision, descripcion: principal.descripcion || "", avisos,
    // Los tramos por horario, a la vista del panel (para mostrar «Naranja de 03:00 a 09:00»).
    lineas: infos.map((i) => ({ categoria: i.categoria, fenomeno: i.evento || i.titulo, inicio: i.inicio, fin: iso(auto.redondeado(i.fin)), departamentos: auto.departamentosDe(i) })),
    base: { zonas, iconos, tramos, vigenteHasta: iso(fin), periodo: auto.recortar(auto.sentencia(auto.textoVigencia(iso(inicio), iso(fin - 1000))), 120) },
    _entera: entera,
  };
}

/** ¿La publicada (con `origenSmn`) es la misma alerta que `cand` (una emisión nueva con otros horarios)? Por horarios, fenómeno y departamentos. */
function esLaMisma(origen, cand) {
  if (!origen) return false;
  const [i1, f1, i2, f2] = [origen.inicio, origen.fin, cand.inicio, cand.fin].map(Date.parse);
  if (!(i1 <= f2 + TOLERANCIA_MS && i2 <= f1 + TOLERANCIA_MS)) return false; // los períodos se pisan o se tocan
  const comun = (a, b) => a.some((x) => b.includes(x));
  return comun(origen.fenomenos || [], cand.fenomenos) && comun(origen.departamentos || [], cand.departamentos);
}

/** Qué cambió entre lo que se publicó (su `origenSmn`) y la emisión de ahora: lista de 'vigencia' | 'nivel' | 'zonas'. */
function cambios(origen, cand) {
  const c = [];
  if (Date.parse(origen.inicio) !== Date.parse(cand.inicio) || Date.parse(origen.fin) !== Date.parse(cand.fin)) c.push("vigencia");
  if (nivelMax(origen.niveles || []) !== nivelMax(cand.niveles)) c.push("nivel");
  if ([...(origen.departamentos || [])].sort().join("|") !== [...cand.departamentos].sort().join("|")) c.push("zonas");
  return c;
}

/** Lo que se guarda de la base en la publicación para reconocer después a la misma alerta. */
/**
 * Dónde está la emisión `cand` respecto de la pila de alertas del módulo (vigentes + en fila): `yaPublicada` (id de la que salió de esa
 * misma emisión) o `actualizaA` (la que corrige, reconocida por sus horarios, con qué cambió). Las dos null = es nueva.
 */
function clasificar(cand, pila) {
  const conOrigen = pila.filter((p) => p.origenSmn);
  const igual = conOrigen.find((p) => p.origenSmn.emision === cand.emision);
  const lineage = !igual && conOrigen.filter((p) => esLaMisma(p.origenSmn, cand)).sort((a, b) => b.id - a.id)[0];
  return { yaPublicada: igual ? igual.id : null,
    actualizaA: lineage ? { id: lineage.id, periodo: lineage.periodo, cambios: cambios(lineage.origenSmn, cand), antes: { inicio: lineage.origenSmn.inicio, fin: lineage.origenSmn.fin, niveles: lineage.origenSmn.niveles } } : null };
}

const origenDe = (cand) => ({ emision: cand.emision, fenomenos: cand.fenomenos, niveles: cand.niveles, departamentos: cand.departamentos, inicio: cand.inicio, fin: cand.fin });

module.exports = { iconosDeTexto, candidata, esLaMisma, cambios, clasificar, origenDe, lineaDeTiempo };
