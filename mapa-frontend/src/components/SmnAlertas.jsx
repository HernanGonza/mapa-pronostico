import { useEffect, useState } from 'react';
import BaseMap from './BaseMap';
import { API_URL } from '../config';
import { actualizarSmnAlertas, getAlertasMeteorologicasGeojson } from '../api';
import { tiempoRelativo } from '../lib/tiempoRelativo';

const fecha = value => new Date(value).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
const order = { Amarillo: 1, Naranja: 2, Rojo: 3, ACP: 4 };

// Única vía en producción: RSS/CAP del SMN (ver mapa-backend/src/lib/smn).
// Las otras vías que existían acá (API JSON con JWT y scraping con Chrome
// headless) se sacaron: nunca anduvieron de forma confiable y complicaban
// la página sin aportar datos reales.
export default function SmnAlertas() {
  const [data, setData] = useState(null), [base, setBase] = useState(null), [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const controller = new AbortController(); let busy = false;
    getAlertasMeteorologicasGeojson().then(g => { if (!controller.signal.aborted) setBase(g); })
      .catch(() => { if (!controller.signal.aborted) setError('No se pudo cargar el mapa de departamentos. Recargá la página para reintentar.'); });
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
    return () => { clearInterval(timer); controller.abort(); };
  }, []);

  async function consultarAhora() {
    if (updating) return;
    setUpdating(true); setError('');
    try { setData(await actualizarSmnAlertas()); }
    catch (e) { setError(e.message); }
    finally { setUpdating(false); }
  }

  const infos = data ? Object.values(data.fuentes).flatMap(f => f.alertas).flatMap(a => a.infos.map((info, index) => ({ ...info, id: `${a.id}:${index}`, fuente: a.fuente, url: a.url })))
    .filter(i => Date.parse(i.fin) > Date.now()).sort((a, b) => order[a.categoria] - order[b.categoria]) : [];
  const features = base ? base.features.map(f => ({ ...f, properties: { ...f.properties, id: `base-${f.properties.id}` } })) : [];
  const datos = [];
  for (const info of infos) info.zonas.forEach((z, i) => {
    if (!z.geometry) return;
    const id = `${info.id}:${i}`;
    features.push({ type: 'Feature', geometry: z.geometry, properties: { id } });
    datos.push({ ...info, id, nombre: z.nombre });
  });
  const outdated = data ? Object.entries(data.fuentes).filter(([, f]) => f.desactualizado || f.error) : [];
  const last = data ? Object.values(data.fuentes).map(f => f.consultadoEn).filter(Boolean).sort().at(-1) : null;

  return <>
    <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading">
        <span className="editor-eyebrow">SMN · RSS/CAP</span>
        <h1>Alertas automáticas</h1>
        <p>Avisos oficiales del SMN, leídos automáticamente de su canal RSS/CAP cada 5 minutos. Herramienta de consulta: todavía no se publica en el mapa público.</p>
      </div>
      <p className="admin-panel__hint">
        {data ? `${data.alcance === 'argentina' ? 'Toda Argentina · prueba' : 'Misiones'} · última consulta ${last ? tiempoRelativo(last) : 'sin datos aún'}` : 'Consultando alertas oficiales del SMN…'}
      </p>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      {!error && outdated.length > 0 && <div className="alert alert--warn" role="status">{outdated.map(([s]) => s).join(' y ')}: actualización pendiente. Se muestran los últimos datos disponibles.</div>}

      <div className="admin-actions">
        <button className="btn btn--block" type="button" onClick={consultarAhora} disabled={updating}>{updating ? 'Consultando SMN…' : 'Consultar ahora'}</button>
      </div>

      <h2>Avisos vigentes ({infos.length})</h2>
      {infos.length === 0 && <p className="admin-panel__hint">No hay avisos vigentes en la respuesta del SMN.</p>}
      <div className="smn-avisos">
        {infos.map(info => <article key={info.id} className="smn-aviso" style={{ '--smn-color': data.colores[info.categoria] }}>
          <div className="smn-aviso__cabecera"><strong>{info.titulo}</strong><span className="smn-aviso__categoria">{info.categoria}</span></div>
          <p>{info.zonas.map(z => z.nombre).join(' · ')}</p>
          <p>{fecha(info.inicio)} — {fecha(info.fin)}</p>
          {info.descripcion && <p>{info.descripcion}</p>}
          {info.zonas.some(z => !z.geometry) && <p>Sin polígono disponible para dibujar en el mapa.</p>}
          {info.url && <a href={info.url} target="_blank" rel="noreferrer">Documento oficial SMN ↗</a>}
        </article>)}
      </div>
    </section>

    <div className="admin-map-area">
      {base ? <BaseMap poligonos={{ type: 'FeatureCollection', features }} datos={datos}
        colorDe={d => data.colores[d?.categoria]} regionLabel={data?.alcance === 'argentina' ? 'Argentina · prueba' : 'Misiones'}
        titulo="SMN · avisos vigentes" publicadoEn={last}
        leyenda={<div className="risk-legend"><strong>{infos.length} avisos vigentes</strong>
          <div className="risk-legend__scale">{Object.entries(data?.colores || {}).map(([name, color]) => <div key={name}><i style={{ background: color }} /><span>{name}</span></div>)}</div>
          <small>Gris: sin aviso vigente. Seleccioná un área para ver horarios e instrucciones.</small>
        </div>}
        renderInfo={(d, { onCerrar }) => <div className="municipio-popover" role="dialog" aria-label={d.titulo} style={{ maxHeight: '60vh', overflow: 'auto' }}>
          <button className="municipio-popover__close" onClick={onCerrar} aria-label="Cerrar">✕</button>
          <h3>{d.titulo} · {d.categoria}</h3><p>{d.nombre}</p>
          <p>Desde {fecha(d.inicio)} hasta {fecha(d.fin)} (Argentina)</p>
          <p>{d.descripcion}</p><p style={{ whiteSpace: 'pre-line' }}>{d.instrucciones}</p>
          <a href={d.url} target="_blank" rel="noreferrer">Documento oficial SMN</a>
        </div>} />
        : <div className="admin-map-area__vacio">{error || 'Preparando mapa…'}</div>}
    </div>
  </>;
}
