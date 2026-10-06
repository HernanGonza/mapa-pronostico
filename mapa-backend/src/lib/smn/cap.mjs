import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const provincia = JSON.parse(readFileSync(new URL('../../../data/departamentos.geojson', import.meta.url)));
const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true });
export const FEEDS = {
  SAT: 'https://ssl.smn.gob.ar/feeds/CAP/rss_alertaCAP_nuevo_2026.xml',
  ACP: 'https://ssl.smn.gob.ar/feeds/CAP/avisocortoplazo/rss_acpCAP.xml',
};
export const colores = { Amarillo: '#FFCC35', Naranja: '#F67F15', Rojo: '#D62E42', ACP: '#8b3fc4' };
const array = v => v == null || v === '' ? [] : Array.isArray(v) ? v : [v];
const valor = v => {
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return valor(v[0]);
  return v?.value ?? v?.Value ?? v?.name ?? v?.['#text'] ?? v?._text ?? v?.['@_value'] ?? '';
};
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function xml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new Error('SMN: XML inválido');
  return parser.parse(text);
}
/**
 * El SMN escribe la hora UTC con sufijo "-03:00" (ej. `<sent>…T13:21:41-03:00`
 * para un informe emitido a las 10:21 de Misiones; las franjas SAT vienen como
 * 03:00–08:59, que en UTC son el bloque 00–06 de acá). Por eso el reloj se lee
 * como UTC y se ignora el desfase. Si algún día el SMN lo corrige, sacar esto
 * (y `corregirHoraVieja`).
 */
export function fecha(value) {
  if (typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('SMN: fecha inválida');
  const reloj = value.replace(/(Z|[+-]\d\d:\d\d)$/, '');
  const t = Date.parse(`${reloj}Z`);
  if (!Number.isFinite(t)) throw new Error('SMN: fecha inválida');
  return new Date(t).toISOString();
}
/**
 * Los textos del SMN vienen con los acentos como entidades escapadas dos veces
 * (`&amp;#xE1;` en el XML → "&#xE1;" después de parsear). Se decodifican acá.
 */
export function textoPlano(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&(quot|apos|lt|gt|nbsp|amp);/g, (m, n) => ({ quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', amp: '&' })[n]);
}
// Marca de las filas leídas con `fecha` ya corregida: las guardadas antes del
// arreglo (sin la marca) tienen todas las horas 3 h de más.
export const RELOJ_UTC = 'utc';
const TRES_HORAS = 3 * 3600 * 1000;
const menos3h = iso => new Date(Date.parse(iso) - TRES_HORAS).toISOString();
/** Corrige una sola vez las filas guardadas antes del arreglo de `fecha`. */
export function corregirHoraVieja(r) {
  if (r.reloj === RELOJ_UTC) return r;
  return { ...r, reloj: RELOJ_UTC, emitidoEn: menos3h(r.emitidoEn), infos: (r.infos || []).map(i => ({ ...i, inicio: i.inicio && menos3h(i.inicio), fin: i.fin && menos3h(i.fin),
    // (de paso, los textos guardados antes de decodificar las entidades)
    titulo: textoPlano(i.titulo), descripcion: textoPlano(i.descripcion), instrucciones: textoPlano(i.instrucciones),
    zonas: (i.zonas || []).map(z => ({ ...z, nombre: textoPlano(z.nombre) })) })) };
}
export function polygon(text) {
  const ring = String(text).trim().split(/\s+/).map(pair => {
    const parts = pair.split(',');
    if (parts.length !== 2 || parts.some(p => !p.trim())) throw new Error('SMN: coordenada CAP inválida');
    const [lat, lon] = parts.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('SMN: coordenada fuera de WGS84');
    return [lon, lat]; // CAP: lat,lon; GeoJSON: lon,lat.
  });
  if (ring.length < 4 || ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error('SMN: polígono CAP abierto');
  return { type: 'Polygon', coordinates: [ring] };
}
const rings = geo => geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInPoly(p, poly) { return pointInRing(p, poly[0]) && !poly.slice(1).some(hole => pointInRing(p, hole)); }
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function segment(a, b, c, d) {
  if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) return false;
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}
function bbox(ring) { return ring.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]); }
export function intersecta(a, b) {
  for (const pa of rings(a)) for (const pb of rings(b)) {
    const x = bbox(pa[0]), y = bbox(pb[0]);
    if (x[2] < y[0] || y[2] < x[0] || x[3] < y[1] || y[3] < x[1]) continue;
    if (pointInPoly(pa[0][0], pb) || pointInPoly(pb[0][0], pa)) return true;
    for (const ra of pa) for (const rb of pb)
      for (let i = 1; i < ra.length; i++) for (let j = 1; j < rb.length; j++)
        if (segment(ra[i - 1], ra[i], rb[j - 1], rb[j])) return true;
  }
  return false;
}
/**
 * ACP (avisos a muy corto plazo): áreas chicas, de una ciudad o un partido; se usa
 * `intersecta` (basta tocar el departamento). SAT: `solapa`.
 */
/**
 * Como `intersecta`, pero exige que se superpongan de verdad (al menos `minKm2`):
 * un aviso de Corrientes que sólo roza el límite con Misiones comparte borde o
 * un punto con el departamento y no debe contarse como aviso de Misiones.
 * Se mide por muestreo en grilla sobre la zona común de ambos.
 */
export const perteneceA = (fuente, geo, departamento) => fuente === 'ACP' ? intersecta(geo, departamento) : solapa(geo, departamento);
export function solapa(a, b, minKm2 = 15) {
  if (!intersecta(a, b)) return false;
  for (const pa of rings(a)) for (const pb of rings(b)) {
    const x = bbox(pa[0]), y = bbox(pb[0]);
    const x0 = Math.max(x[0], y[0]), x1 = Math.min(x[2], y[2]), y0 = Math.max(x[1], y[1]), y1 = Math.min(x[3], y[3]);
    if (x1 < x0 || y1 < y0) continue;
    const paso = Math.max(0.005, (x1 - x0) / 80, (y1 - y0) / 80); // grados; ~0,5 km o más
    const celdaKm2 = (paso * 111) * (paso * 111 * Math.cos(((y0 + y1) / 2) * Math.PI / 180));
    const necesarias = Math.max(1, Math.ceil(minKm2 / celdaKm2));
    let dentro = 0;
    for (let lon = x0 + paso / 2; lon < x1; lon += paso)
      for (let lat = y0 + paso / 2; lat < y1; lat += paso)
        if (pointInPoly([lon, lat], pa) && pointInPoly([lon, lat], pb) && ++dentro >= necesarias) return true;
  }
  return false;
}
/**
 * Re-aplica el criterio de pertenencia a Misiones sobre avisos YA guardados
 * (guardados antes de exigir superposición real, cuando un borde en común bastaba).
 * Recalcula los departamentos de cada zona con polígono y descarta las que ya
 * no caen en Misiones; las zonas sin polígono (ACP por texto) no se tocan.
 */
export function depurarGuardados(rows, alcance = process.env.SMN_SCOPE || 'argentina') {
  if (alcance !== 'misiones') return rows;
  return rows.map(r => ({ ...r, infos: (r.infos || []).map(i => ({ ...i, zonas: (i.zonas || []).flatMap(z => {
    if (!z.geometry) return [z];
    const departamentos = provincia.features.filter(f => perteneceA(r.fuente, z.geometry, f.geometry)).map(f => f.properties.nombre);
    return departamentos.length ? [{ ...z, departamentos }] : [];
  }) })).filter(i => i.zonas.length) })).filter(r => r.infos.length || r.tipo === 'Cancel');
}
export function normalizarCap(text, fuente, url, alcance = process.env.SMN_SCOPE || 'argentina') {
  if (!['misiones', 'argentina'].includes(alcance)) throw new Error('SMN_SCOPE debe ser misiones o argentina');
  const a = xml(text).alert;
  if (!a?.identifier || !a.sender || !a.sent || !a.msgType) throw new Error('SMN: documento CAP incompleto');
  if (a.status !== 'Actual' || a.scope !== 'Public') return null;
  if (!['Alert', 'Update', 'Cancel'].includes(a.msgType)) return null;
  const ref = array(a.references).flatMap(r => String(r).split(/\s+/)).filter(Boolean).map(r => r.split(',')[1]).filter(Boolean);
  const result = { id: String(a.identifier), fuente, alcance, emitidoEn: fecha(a.sent), reloj: RELOJ_UTC, tipo: a.msgType, referencias: ref, url, infos: [] };
  if (a.msgType === 'Cancel') return result;
  for (const info of array(a.info)) {
    if (info.language && !info.language.startsWith('es')) continue;
    const inicio = fecha(info.onset || info.effective || a.sent), fin = fecha(info.expires);
    if (Date.parse(fin) <= Date.parse(inicio)) throw new Error('SMN: vigencia CAP inválida');
    const zonas = [];
    for (const area of array(info.area)) {
      const campos = Object.keys(area || {});
      const geocodigos = array(area.geocode).map(g => valor(g)).filter(Boolean);
      const nombreArea = textoPlano(valor(area.areaDesc)) || geocodigos.join(' · ') || (area.circle ? `Área circular (${valor(area.circle)})` : `Área definida por el SMN${campos.length ? ` (${campos.join(', ')})` : ''}`);
      for (const p of array(area.polygon)) {
        const geo = polygon(p);
        const departamentos = provincia.features.filter(f => perteneceA(fuente, geo, f.geometry)).map(f => f.properties.nombre);
        if (departamentos.length || alcance === 'argentina') zonas.push({ nombre: nombreArea || departamentos.join(' · '), departamentos, geocodigos, campos, geometry: geo });
      }
      // ACP: sin polígono no hay forma de confirmar geográficamente que es de
      // Misiones (área hiperlocal, puede describir sólo una ciudad/partido).
      // Se prioriza que la alarma suene — el operador filtra a ojo — sobre
      // el riesgo de perder un aviso real por no decir "Misiones" en el texto.
      if (!array(area.polygon).length && (alcance === 'argentina' || fuente === 'ACP' || /\bmisiones\b/i.test(nombreArea))) zonas.push({ nombre: nombreArea, departamentos: [], geocodigos, campos, geometry: null });
    }
    if (!zonas.length) continue;
    // En los CAP del SMN el nivel suele venir en `severity`, pero algunas
    // publicaciones históricas usan Minor para el nivel amarillo o lo dejan
    // escrito en el titular. No descartamos esos mensajes válidos.
    const textoNivel = `${info.headline || ''} ${info.event || ''}`;
    const categoria = ({ Minor: 'Amarillo', Moderate: 'Amarillo', Severe: 'Naranja', Extreme: 'Rojo' })[info.severity]
      || (fuente === 'SAT' && /amarill/i.test(textoNivel) ? 'Amarillo' : null)
      || (fuente === 'SAT' && /naranj/i.test(textoNivel) ? 'Naranja' : null)
      || (fuente === 'SAT' && /rojo/i.test(textoNivel) ? 'Rojo' : null)
      || (fuente === 'SAT' ? 'Sin nivel' : null)
      // ACP siempre se clasifica como 'ACP' más abajo — cualquier valor no
      // nulo alcanza acá; no se descarta un aviso a muy corto plazo por no
      // traer severity reconocible.
      || (fuente === 'ACP' ? 'Sin nivel' : null);
    // Las advertencias SAT sin nivel explícito siguen siendo visibles en la
    // tabla, para poder diagnosticar el formato real que entrega el SMN.
    if (!categoria) continue;
    result.infos.push({ titulo: textoPlano(info.headline || info.event || 'Aviso SMN'), evento: textoPlano(info.event || ''),
      descripcion: textoPlano(info.description || ''), instrucciones: textoPlano(info.instruction || ''),
      severidad: String(info.severity || ''), categoria: fuente === 'ACP' ? 'ACP' : categoria,
      inicio, fin, zonas });
  }
  return result;
}
/**
 * Sólo la emisión más reciente. Cada emisión SAT del SMN es un informe
 * completo (msgType "Update") que reemplaza al anterior, pero sus
 * `references` apuntan al informe previo sin el sufijo de zona
 * (`…2026.09.28.20.49.42`, no `…2026.09.28.20.49.42.56`), así que
 * `reconciliar` no encuentra qué borrar y las emisiones viejas se acumulan
 * hasta que vencen. Esto no toca lo guardado (smn_estado / smn_historial
 * conservan todo para el histórico): sólo filtra lo que se muestra. Cuenta
 * también las emisiones sin áreas en Misiones: si el último informe ya no
 * trae alertas acá, no queda ninguna vigente.
 */
export function ultimaEmision(rows) {
  // Un mismo informe se publica en varios mensajes a lo largo de algunos
  // segundos (ej. 13:21:41, :42, :43 y :44 — cada uno con su propio id): se
  // toma como una sola emisión todo lo emitido hasta 10 min antes del último
  // mensaje. Entre informes pasan horas, así que no se mezclan.
  const ultima = Math.max(...rows.map(r => Date.parse(r.emitidoEn)).filter(Number.isFinite));
  return rows.filter(r => ultima - Date.parse(r.emitidoEn) <= VENTANA_EMISION_MS);
}
const VENTANA_EMISION_MS = 10 * 60 * 1000;
export function vigentes(rows, now = Date.now()) {
  return rows.map(r => ({ ...r, infos: r.infos.filter(i => Date.parse(i.fin) > now) })).filter(r => r.infos.length);
}
// El RSS lista los últimos mensajes: la ausencia de un ID no equivale a cancelación.
export function reconciliar(previous, received, now = Date.now()) {
  const map = new Map(previous.map(r => [r.id, r]));
  const ordered = received.filter(Boolean).sort((a, b) => a.emitidoEn.localeCompare(b.emitidoEn));
  for (const r of ordered) {
    for (const id of r.referencias) map.delete(id);
    map.set(r.id, r);
  }
  // Una referencia puede aparecer antes de su original dentro del feed.
  const references = [...previous, ...ordered].flatMap(r => r.referencias);
  for (const id of references) map.delete(id);
  return [...map.values()].map(r => ({ ...r, infos: r.infos.filter(i => Date.parse(i.fin) > now) }))
    // Conserva referencias de actualización/cancelación aunque desaparezcan del RSS.
    .filter(r => r.infos.length || (r.referencias.length && now - Date.parse(r.emitidoEn) < 7 * 86400000))
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function enlacesFeed(text) {
  const channel = xml(text).rss?.channel;
  if (!channel || !channel.title) throw new Error('SMN: respuesta no es RSS');
  const items = array(channel.item);
  const links = [];
  for (const item of items) {
    const value = String(item.link || '');
    const u = new URL(value);
    if (u.protocol === 'https:' && u.hostname === 'ssl.smn.gob.ar' && u.pathname.startsWith('/feeds/CAP/') && u.pathname.endsWith('.xml') && !u.username && !u.password && !u.port) links.push(u.href);
    else if (!/No se han emitido Avisos Meteorologicos/i.test(String(item.description || ''))) throw new Error('SMN: enlace CAP inesperado');
  }
  if (links.length > 500) throw new Error('SMN: feed demasiado grande');
  return [...new Set(links)];
}
export async function descargar(url, { fetchImpl = fetch, timeoutMs = 30000, intentos = 2, headers = {} } = {}) {
  let ultimo;
  for (let intento = 1; intento <= intentos; intento++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // El servidor del SMN puede redirigir el RSS al host canónico.
      const r = await fetchImpl(url, { signal: controller.signal, redirect: 'follow', headers });
      if (!r.ok) throw new Error(`SMN HTTP ${r.status}`);
      const reader = r.body?.getReader();
      if (!reader) return await r.text();
      let size = 0; const chunks = [];
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 5 * 1024 * 1024) { await reader.cancel(); throw new Error('SMN: XML supera 5 MB'); }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks).toString('utf8');
    } catch (e) {
      ultimo = e.name === 'AbortError' ? new Error(`SMN timeout después de ${timeoutMs / 1000}s`) : e;
      if (intento < intentos) await new Promise(resolve => setTimeout(resolve, 750));
    } finally { clearTimeout(timer); }
  }
  throw ultimo;
}
/**
 * `cache` (opcional, Map url → resultado): un CAP no cambia nunca bajo su URL, así que
 * el resultado de cada uno se recuerda (también los que no son de Misiones, como `null`).
 * Cada consulta sólo baja los enlaces nuevos del RSS: antes bajaba los ~90 cada 5 min y,
 * si el SMN respondía 429 en uno, se perdía toda la consulta y el reintento volvía a
 * empezar de cero. Ahora los que ya se bajaron se conservan aunque otro falle.
 */
export async function leerFuente(fuente, download = descargar, cache = null, { pausaMs = 500, esperaTopeMs = 30000 } = {}) {
  const links = enlacesFeed(await download(FEEDS[fuente]));
  if (cache) for (const url of cache.keys()) if (!links.includes(url)) cache.delete(url); // ya no están en el RSS
  const output = new Array(links.length); let next = 0;
  // Con caché (el sondeo real) se baja de a uno, con pausa y esperando ante un 429 del SMN: lo bajado
  // se conserva y la consulta siguiente sigue desde ahí. Sin caché: cuatro a la vez, falla ante un CAP incompleto.
  const pausado = !!cache;
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  async function bajar(url) {
    for (let intento = 1; ; intento++) {
      try { return await download(url); }
      catch (e) {
        if (!pausado || !/HTTP 429/.test(e.message) || intento >= 3) throw e;
        await dormir(esperaTopeMs * intento / 3 + 2000);
      }
    }
  }
  let failure;
  await Promise.all(Array.from({ length: pausado ? 1 : Math.min(4, links.length) }, async () => {
    while (!failure && next < links.length) {
      const n = next++, url = links[n];
      if (cache?.has(url)) { output[n] = cache.get(url); continue; }
      try { output[n] = normalizarCap(await bajar(url), fuente, url); cache?.set(url, output[n]); }
      catch (e) { failure = e; }
      if (pausado && !failure) await dormir(pausaMs);
    }
  }));
  if (failure) throw failure;
  return output.filter(Boolean);
}
