import { useEffect, useState } from 'react';
import BaseMap from './BaseMap';
import { API_URL } from '../config';
import { actualizarSmnAlertas } from '../api';
import { getAlertasMeteorologicasGeojson, getSmnApiAlertas, scrapeSmnPagina } from '../api';
const fecha = value => new Date(value).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
const order = { Amarillo: 1, Naranja: 2, Rojo: 3, ACP: 4 };
export default function SmnAlertas() {
  const [data, setData] = useState(null), [base, setBase] = useState(null), [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [apiResult, setApiResult] = useState(null);
  const [scrapeResult, setScrapeResult] = useState(null), [scraping, setScraping] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let busy = false;
    getAlertasMeteorologicasGeojson().then(g => { if (!controller.signal.aborted) setBase(g); }).catch(() => { if (!controller.signal.aborted) setError('No se pudo cargar el mapa de departamentos. Recargá la página para reintentar.'); });
    async function refresh() {
      if (busy) return; busy = true;
      try {
        const r = await fetch(`${API_URL}/api/alertas-meteorologicas/smn`, { signal: controller.signal, cache: 'no-store' });
        if (!r.ok) throw new Error('No se pudieron actualizar las alertas');
        const next = await r.json(); if (!controller.signal.aborted) { setData(next); setError(''); }
      } catch (e) { if (!controller.signal.aborted) setError(e.message); }
      finally { busy = false; }
    }
    refresh(); const timer = setInterval(refresh, 60000);
    getSmnApiAlertas().then(r => { if (!controller.signal.aborted) setApiResult(r); }).catch(e => { if (!controller.signal.aborted) setApiResult({ error: e.message }); });
    return () => { clearInterval(timer); controller.abort(); };
  }, []);
  if (!data) return <div className="base-map base-map--fallback">{error || 'Consultando alertas oficiales del SMN…'}</div>;
  const infos = Object.values(data.fuentes).flatMap(f => f.alertas).flatMap(a => a.infos.map((info, index) => ({ ...info, id: `${a.id}:${index}`, fuente: a.fuente, url: a.url })))
    .filter(i => Date.parse(i.fin) > Date.now()).sort((a, b) => order[a.categoria] - order[b.categoria]);
  // Agrega al mapa solamente áreas que tienen reportes activos en el API.
  // Las áreas sin reportes no generan ninguna geometría coloreada.
  const apiInfos = (apiResult?.datos || []).flatMap(a => {
    const area = apiResult.areas?.find(x => x.id === a.area_id);
    if (!area?.geometry || !area.provinces?.some(p => p.name === 'Misiones')) return [];
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
    const eventosActivos = new Set((a.warnings || []).find(w => w.date === hoy)?.events
      ?.filter(e => Number(e.max_level) > 1).map(e => String(e.id)) || []);
    return (a.reports || []).filter(r => !a.warnings?.length || eventosActivos.has(String(r.event_id))).flatMap((r, ri) => (r.levels || []).map((l, li) => ({
      id: `api:${a.area_id}:${r.event_id}:${ri}:${li}`, fuente: 'SAT API', categoria: Number(l.level) >= 3 ? 'Amarillo' : Number(l.level) === 2 ? 'Naranja' : 'Rojo',
      titulo: `Evento ${r.event_id}`, evento: `Evento ${r.event_id}`, descripcion: l.description || '', instrucciones: l.instruction || '',
      inicio: a.updated, fin: new Date(Date.parse(a.updated) + 24 * 3600000).toISOString(),
      zonas: [{ nombre: `${area.name}${area.provinces?.length ? ` · ${area.provinces.map(p => p.name).join(', ')}` : ''}`, geometry: area.geometry }], url: API_URL + '/api/alertas-meteorologicas/smn-api',
    })));
  });
  const mapaInfos = [...infos, ...apiInfos];
  const features = base.features.map(f => ({ ...f, properties: { ...f.properties, id: `base-${f.properties.id}` } })), datos = [];
  for (const info of mapaInfos) info.zonas.forEach((z, i) => {
    if (!z.geometry) return;
    const id = `${info.id}:${i}`;
    features.push({ type: 'Feature', geometry: z.geometry, properties: { id } });
    datos.push({ ...info, id, nombre: z.nombre });
  });
  const outdated = Object.entries(data.fuentes).filter(([, f]) => f.desactualizado || f.error);
  const last = Object.values(data.fuentes).map(f => f.consultadoEn).filter(Boolean).sort().at(-1);
  const filas = infos.flatMap(info => info.zonas.map(zona => ({
    fuente: info.fuente, categoria: info.categoria, evento: info.evento || info.titulo,
    zona: zona.nombre, inicio: info.inicio, fin: info.fin, descripcion: info.descripcion,
    url: info.url,
  })));
  async function consultarAhora() {
    if (updating) return;
    setUpdating(true); setError('');
    try { setData(await actualizarSmnAlertas()); }
    catch (e) { setError(e.message); }
    finally { setUpdating(false); }
  }
  async function scrapearPagina() {
    if (scraping) return;
    setScraping(true);
    try { setScrapeResult(await scrapeSmnPagina()); }
    catch (e) { setScrapeResult({ error: e.message }); }
    finally { setScraping(false); }
  }
  return <div style={{ height: '100%', minHeight: 500, display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: '10px 16px', background: '#fff', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <span>SMN · {data.alcance === 'argentina' ? 'Toda Argentina · prueba' : 'Misiones'} · consulta cada 5 minutos</span>
      <button className="btn" type="button" onClick={consultarAhora} disabled={updating}>{updating ? 'Consultando SMN…' : 'Consultar ahora'}</button>
      <button className="btn" type="button" onClick={scrapearPagina} disabled={scraping}>{scraping ? 'Abriendo SMN…' : 'Respaldar con navegador'}</button>
      {(error || outdated.length > 0) && <strong role="status">{error || `${outdated.map(([s]) => s).join(' y ')}: actualización pendiente. Últimos datos disponibles.`}</strong>}
    </div>
    {base ? <div style={{ flex: 1, minHeight: 400 }}><BaseMap poligonos={{ type: 'FeatureCollection', features }} datos={datos}
      colorDe={d => data.colores[d?.categoria]} regionLabel={data.alcance === 'argentina' ? 'Argentina · prueba' : 'Misiones'} titulo="SMN · períodos vigentes y próximos" publicadoEn={last}
      leyenda={<div className="risk-legend"><strong>{infos.length} períodos de aviso · consultar horarios</strong>
        <div className="risk-legend__scale">{Object.entries(data.colores).map(([name, color]) => <div key={name}><i style={{ background: color }} /><span>{name}</span></div>)}</div>
        <small>Gris: sin polígono de alerta. ACP en violeta.</small>
        <small>Seleccioná un área para ver horarios e instrucciones.</small>
      </div>}
      renderInfo={(d, { onCerrar }) => <div className="municipio-popover" role="dialog" aria-label={d.titulo} style={{ maxHeight: '60vh', overflow: 'auto' }}>
        <button className="municipio-popover__close" onClick={onCerrar} aria-label="Cerrar">✕</button>
        <h3>{d.titulo} · {d.categoria}</h3><p>{d.nombre}</p>
        <p>Desde {fecha(d.inicio)} hasta {fecha(d.fin)} (Argentina)</p>
        <p>{d.descripcion}</p><p style={{ whiteSpace: 'pre-line' }}>{d.instrucciones}</p>
        <a href={d.url} target="_blank" rel="noreferrer">Documento oficial SMN</a>
      </div>} /></div> : <div className="base-map base-map--fallback">No se pudo cargar el mapa de departamentos; se muestran los datos del SMN en la tabla.</div>}
    <details style={{ padding: 12, background: '#fff', maxHeight: '35vh', overflow: 'auto' }}><summary>Detalle de todos los períodos ({infos.length})</summary>
      {infos.map(i => <article key={i.id}><strong>{i.titulo} · {i.categoria}</strong><p>{fecha(i.inicio)} — {fecha(i.fin)}</p><p>{i.descripcion}</p><p>{i.zonas.map(z => z.nombre).join(' · ')}</p><p>{i.instrucciones}</p>{i.zonas.some(z => !z.geometry) && <p>Sin polígono disponible</p>}</article>)}
    </details>
    <div style={{ padding: 12, background: '#fff', overflow: 'auto' }}>
      <h3 style={{ margin: '0 0 8px' }}>Respuesta del SMN · Misiones</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr>{['Fuente', 'Categoría', 'Evento', 'Área', 'Inicio', 'Fin', 'Descripción'].map(h => <th key={h} style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #ddd' }}>{h}</th>)}</tr></thead>
        <tbody>{filas.map((f, i) => <tr key={`${f.fuente}-${f.zona}-${i}`}>{[f.fuente, f.categoria, f.evento, f.zona, fecha(f.inicio), fecha(f.fin), f.descripcion].map((v, j) => <td key={j} style={{ verticalAlign: 'top', padding: 6, borderBottom: '1px solid #eee' }}>{j === 2 && f.url ? <a href={f.url} target="_blank" rel="noreferrer">{v}</a> : v}</td>)}</tr>)}</tbody>
      </table>
      {!filas.length && <p>No hay avisos vigentes en la respuesta del SMN.</p>}
    </div>
    <details style={{ padding: 12, background: '#f7f7f7' }}>
      <summary>Alertas tempranas API del SMN (proxy autenticado)</summary>
      <p style={{ marginBottom: 6 }}>{apiResult?.error || apiResult?.fuente || 'Consultando API…'}</p>
      {apiResult?.datos?.length > 0 && <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}><thead><tr>{['Área API', 'Evento', 'Nivel', 'Descripción'].map(h => <th key={h} style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #ddd' }}>{h}</th>)}</tr></thead><tbody>{apiResult.datos.filter(a => { const area = apiResult.areas?.find(x => x.id === a.area_id); const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()); return area?.provinces?.some(p => p.name === 'Misiones') && (!a.warnings?.length || (a.warnings.find(w => w.date === hoy)?.events || []).some(e => Number(e.max_level) > 1)); }).flatMap(a => (a.reports || []).flatMap(r => (r.levels || []).map((l, i) => ({ a, r, l, i })))).map(({ a, r, l, i }) => { const area = apiResult.areas?.find(x => x.id === a.area_id); return <tr key={`${a.area_id}-${r.event_id}-${i}`}><td style={{ padding: 6, borderBottom: '1px solid #eee' }}>{area?.name || `Área ${a.area_id}`}{area?.provinces?.length ? ` · ${area.provinces.map(p => p.name).join(', ')}` : ''}</td><td style={{ padding: 6, borderBottom: '1px solid #eee' }}>Evento {r.event_id}</td><td style={{ padding: 6, borderBottom: '1px solid #eee' }}>Nivel {l.level}</td><td style={{ padding: 6, borderBottom: '1px solid #eee', whiteSpace: 'pre-line' }}>{l.description}</td></tr>; })}</tbody></table>}
      {apiResult?.datos !== undefined && <pre style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(apiResult.datos, null, 2).slice(0, 12000)}{JSON.stringify(apiResult.datos, null, 2).length > 12000 ? '\n… (respuesta recortada)' : ''}</pre>}
    </details>
    <details style={{ padding: 12, background: '#f7f7f7' }}>
      <summary>Cuarta opción: scraping de la página del SMN</summary>
      {scrapeResult?.error ? <p>{scrapeResult.error}</p> : scrapeResult ? <><p>{scrapeResult.titulo} · {scrapeResult.url}</p><pre style={{ maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{scrapeResult.texto}</pre></> : <p>Consulta manual con Chrome headless; no se ejecuta automáticamente.</p>}
    </details>
  </div>;
}
