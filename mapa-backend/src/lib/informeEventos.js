const store = require("./store");
const { loadDepartamentos } = require("./departamentos");
const { iconos: FENOMENOS } = require("./alertasMeteorologicas");

/**
 * «Resumen de eventos» (módulo «Informe mensual», pestaña «Eventos»): lo que pasó en un mes o en una semana, leído de la base:
 *  - avisos a muy corto plazo (ACP) del SMN para Misiones,
 *  - alertas del SMN para Misiones (una por emisión),
 *  - alertas meteorológicas que publicó el Ministerio,
 *  - avisos a muy corto plazo y avisos especiales que publicó el Ministerio,
 *  - eventos climáticos cargados a mano.
 * Todo lo del SMN sale del historial que guarda la app (smn_historial): lo que el SMN emitió mientras la app estaba apagada no está.
 * Las fechas son AAAA-MM-DD en hora de Misiones, ambas incluidas.
 */
const TRES_HORAS = 3 * 3600 * 1000;
const ORDEN = { Verde: 0, Amarillo: 1, Naranja: 2, Rojo: 3 };
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const LIMITE_DIAS = 93;

function errorDePeriodo(desde, hasta) {
  if (!RE_FECHA.test(desde || "") || !RE_FECHA.test(hasta || "") || Number.isNaN(Date.parse(desde)) || Number.isNaN(Date.parse(hasta))) return "Las fechas no son válidas.";
  if (hasta < desde) return "El período termina antes de empezar.";
  if ((Date.parse(hasta) - Date.parse(desde)) / 86400000 >= LIMITE_DIAS) return `El período no puede pasar de ${LIMITE_DIAS} días.`;
  return null;
}
const ventana = (desde, hasta) => [Date.parse(`${desde}T00:00:00-03:00`), Date.parse(`${hasta}T00:00:00-03:00`) + 86400000];
const redondeado = (iso) => Date.parse(iso) + (new Date(iso).getUTCSeconds() === 59 ? 1000 : 0); // el «…:59:59» del SMN se lee como la hora redonda
const nivelMax = (l) => l.reduce((a, b) => ((ORDEN[b] || 0) > (ORDEN[a] || 0) ? b : a), "Verde");
const departamentosDe = (info) => [...new Set((info.zonas || []).flatMap((z) => z.departamentos || []))].sort((a, b) => a.localeCompare(b, "es"));
const nivelDeTitulo = (t) => { const m = /AVISO\s+(AMARILLO|NARANJA|ROJO)/i.exec(t || ""); return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : null; };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

/** Mensajes del SMN guardados (historial + estado actual) de una fuente, sin repetir. Sin base: []. */
async function mensajesSmn(fuente) {
  const p = store.getPool();
  if (!p) return [];
  const [h, e] = await Promise.all([
    p.query("SELECT datos FROM smn_historial WHERE fuente = $1", [fuente]),
    p.query("SELECT datos FROM smn_estado WHERE fuente = $1", [fuente]),
  ]);
  const porId = new Map();
  for (const fila of [...h.rows, ...e.rows]) for (const r of fila.datos || []) porId.set(r.id, r);
  return [...porId.values()];
}

async function reunir(desde, hasta) {
  const error = errorDePeriodo(desde, hasta);
  if (error) throw Object.assign(new Error(error), { status: 400 });
  await store.init();
  const p = store.getPool();
  const [t0, t1] = ventana(desde, hasta), dentro = (ms) => ms >= t0 && ms < t1;
  const iso = (ms) => new Date(ms).toISOString();

  // ACP del SMN: un mensaje = un aviso.
  const acp = [];
  for (const r of await mensajesSmn("ACP")) for (const i of r.infos || []) {
    if (!dentro(Date.parse(i.inicio))) continue;
    acp.push({ id: r.id, emitidoEn: r.emitidoEn, inicio: i.inicio, fin: i.fin, nivel: nivelDeTitulo(i.titulo) || "Sin nivel", evento: cap(i.evento || i.titulo), titulo: i.titulo, departamentos: departamentosDe(i), zona: (i.zonas || []).map((z) => z.nombre).join(" | ") });
  }
  acp.sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));

  // Alertas del SMN: los mensajes de una misma emisión son una sola alerta partida en zonas y horarios.
  const porEmision = new Map();
  for (const r of await mensajesSmn("SAT")) {
    const infos = (r.infos || []).filter((i) => departamentosDe(i).length);
    if (!infos.length || !infos.some((i) => dentro(Date.parse(i.inicio)))) continue;
    const g = porEmision.get(r.emitidoEn) || { emitidoEn: r.emitidoEn, niveles: [], fenomenos: new Set(), inicio: Infinity, fin: 0, departamentos: new Set() };
    for (const i of infos) {
      g.niveles.push(i.categoria); g.fenomenos.add(cap(i.evento || i.titulo));
      g.inicio = Math.min(g.inicio, Date.parse(i.inicio)); g.fin = Math.max(g.fin, redondeado(i.fin));
      departamentosDe(i).forEach((d) => g.departamentos.add(d));
    }
    porEmision.set(r.emitidoEn, g);
  }
  const alertasSmn = [...porEmision.values()].sort((a, b) => a.inicio - b.inicio).map((g) => ({
    emitidoEn: g.emitidoEn, nivel: nivelMax(g.niveles), fenomenos: [...g.fenomenos], inicio: iso(g.inicio), fin: iso(g.fin), departamentos: [...g.departamentos].sort((a, b) => a.localeCompare(b, "es")) }));

  let alertasPublicadas = [], avisosPropios = [], avisosEspeciales = [], eventos = [];
  if (p) {
    const nombres = new Map(loadDepartamentos().map((d) => [String(d.id), d.nombre]));
    const nombreFenomeno = new Map(FENOMENOS.map((f) => [f.id, f.nombre]));
    const pub = await p.query("SELECT id, publicado_en, periodo, vigente_desde, visible_desde, vigente_hasta, origen_smn FROM alertas_meteo_publicaciones WHERE publicado_en >= $1 AND publicado_en < $2 ORDER BY publicado_en", [iso(t0), iso(t1)]);
    const ids = pub.rows.map((r) => r.id);
    const [deps, fens] = ids.length ? await Promise.all([
      p.query("SELECT publicacion_id, departamento_id, categoria FROM alertas_meteo_publicacion_departamentos WHERE publicacion_id = ANY($1)", [ids]),
      p.query("SELECT publicacion_id, fenomeno_id FROM alertas_meteo_publicacion_fenomenos WHERE publicacion_id = ANY($1)", [ids]),
    ]) : [{ rows: [] }, { rows: [] }];
    alertasPublicadas = pub.rows.map((r) => {
      const d = deps.rows.filter((x) => x.publicacion_id === r.id && x.categoria && x.categoria !== "Verde");
      return { id: Number(r.id), publicadoEn: r.publicado_en.toISOString(), periodo: r.periodo, vigenteHasta: r.vigente_hasta ? r.vigente_hasta.toISOString() : null, origen: r.origen_smn ? "SMN" : "Manual",
        nivel: nivelMax(d.map((x) => x.categoria)), fenomenos: fens.rows.filter((x) => x.publicacion_id === r.id).map((x) => nombreFenomeno.get(x.fenomeno_id) || x.fenomeno_id),
        departamentos: d.map((x) => nombres.get(String(x.departamento_id)) || x.departamento_id).sort((a, b) => a.localeCompare(b, "es")) };
    });
    const av = await p.query("SELECT id, titulo, texto, nivel, generado_en, publicado_en, vigente_hasta FROM avisos_corto_plazo WHERE COALESCE(publicado_en, generado_en) >= $1 AND COALESCE(publicado_en, generado_en) < $2 ORDER BY COALESCE(publicado_en, generado_en)", [iso(t0), iso(t1)]);
    avisosPropios = av.rows.map((r) => ({ id: Number(r.id), fecha: (r.publicado_en || r.generado_en).toISOString(), titulo: r.titulo, texto: r.texto, nivel: r.nivel || "—", vigenteHasta: r.vigente_hasta ? r.vigente_hasta.toISOString() : null, publicado: !!r.publicado_en }));
    const es = await p.query("SELECT id, titulo, subtitulo, texto, nivel, generado_en, emitido_en FROM avisos_especiales WHERE COALESCE(emitido_en, generado_en) >= $1 AND COALESCE(emitido_en, generado_en) < $2 ORDER BY COALESCE(emitido_en, generado_en)", [iso(t0), iso(t1)]);
    avisosEspeciales = es.rows.map((r) => ({ id: Number(r.id), fecha: (r.emitido_en || r.generado_en).toISOString(), titulo: [r.titulo, r.subtitulo].filter(Boolean).join(" · "), texto: r.texto, nivel: r.nivel || "—" }));
    const ev = await p.query("SELECT id, tipo, tipo_otro, titulo, descripcion, severidad, fecha_inicio, fecha_fin, departamento, municipio FROM eventos_climaticos WHERE fecha_inicio <= $2::date AND COALESCE(fecha_fin, fecha_inicio) >= $1::date ORDER BY fecha_inicio", [desde, hasta]);
    eventos = ev.rows.map((r) => ({ id: Number(r.id), tipo: r.tipo_otro || r.tipo, titulo: r.titulo, severidad: r.severidad, desde: String(r.fecha_inicio instanceof Date ? r.fecha_inicio.toISOString() : r.fecha_inicio).slice(0, 10), hasta: r.fecha_fin ? String(r.fecha_fin instanceof Date ? r.fecha_fin.toISOString() : r.fecha_fin).slice(0, 10) : null, lugar: [r.municipio, r.departamento].filter(Boolean).join(", ") }));
  }

  const cuenta = (xs) => { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "es")).map(([nombre, cantidad]) => ({ nombre, cantidad })); };
  return {
    desde, hasta, conBase: !!p, acp, alertasSmn, alertasPublicadas, avisosPropios, avisosEspeciales, eventos,
    resumen: { acp: acp.length, alertasSmn: alertasSmn.length, alertasPublicadas: alertasPublicadas.length, avisosPropios: avisosPropios.length, avisosEspeciales: avisosEspeciales.length, eventos: eventos.length,
      acpPorNivel: cuenta(acp.map((a) => a.nivel)), acpPorEvento: cuenta(acp.map((a) => a.evento)), acpPorDepartamento: cuenta(acp.flatMap((a) => a.departamentos)),
      alertasSmnPorNivel: cuenta(alertasSmn.map((a) => a.nivel)), alertasPublicadasPorNivel: cuenta(alertasPublicadas.map((a) => a.nivel)) },
  };
}

module.exports = { reunir, errorDePeriodo };
