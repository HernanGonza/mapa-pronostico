import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import BaseMap from './BaseMap';
import { API_URL } from '../config';
import { actualizarSmnAlertas, getAlertasMeteorologicasGeojson, getAlertasSmnPublicadasPanel, publicarAlertaSmn, despublicarAlertaSmn } from '../api';
import { confirmar } from '../lib/ui';
import EmbedShare from './EmbedShare';
import { tiempoRelativo } from '../lib/tiempoRelativo';

const AR = 'America/Argentina/Buenos_Aires';
const fecha = value => new Date(value).toLocaleString('es-AR', { timeZone: AR, hourCycle: 'h23' });
const horaCorta = value => new Date(value).toLocaleString('es-AR', { timeZone: AR, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const order = { Amarillo: 1, Naranja: 2, Rojo: 3, ACP: 4 };

// Días en hora argentina ("AAAA-MM-DD"). Cada emisión del SMN es un informe
// completo (reemplaza al anterior: tipo "Update") con áreas para hoy y para
// mañana. El backend ya manda sólo la última (ver ultimaEmision en
// lib/smn/cap.mjs); acá se elige el día y el mapa muestra sólo eso.
const diaAR = value => new Intl.DateTimeFormat('en-CA', { timeZone: AR }).format(new Date(value));
const sumarDia = (dia, n = 1) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
function diasDe(info) {
  const dias = [], fin = diaAR(info.fin);
  for (let d = diaAR(info.inicio); d <= fin && dias.length < 7; d = sumarDia(d)) dias.push(d);
  return dias;
}
function etiquetaDia(dia) {
  const hoy = diaAR(Date.now());
  const nombre = new Date(`${dia}T12:00:00Z`).toLocaleDateString('es-AR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' });
  return dia === hoy ? `Hoy · ${nombre}` : dia === sumarDia(hoy) ? `Mañana · ${nombre}` : nombre;
}

// Suena dos beeps cortos (sin depender de ningún archivo de audio).
function sonarAlarma(ctx) {
  const ahora = ctx.currentTime;
  [0, 0.3].forEach(offset => {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'square'; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ahora + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, ahora + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ahora + offset + 0.24);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(ahora + offset); osc.stop(ahora + offset + 0.25);
  });
}

// Única vía en producción: RSS/CAP del SMN (ver mapa-backend/src/lib/smn).
// Las otras vías que existían acá (API JSON con JWT y scraping con Chrome
// headless) se sacaron: nunca anduvieron de forma confiable y complicaban
// la página sin aportar datos reales.
//
// ACP (avisos a muy corto plazo, ~15 min de anticipación) usa el mismo
// canal RSS/CAP, pero su polígono no es confiable — a diferencia de SAT no
// se dibuja en el mapa público: acá sólo suena la alarma para que alguien
// lo vea y lo publique a mano en /panel/avisos-corto-plazo.
export default function SmnAlertas() {
  const [data, setData] = useState(null), [base, setBase] = useState(null), [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [sonidoListo, setSonidoListo] = useState(false);
  const [reconocidos, setReconocidos] = useState(() => new Set());
  // null = seguir la emisión más reciente / el primer día que traiga.
  const [emisionElegida, setEmisionElegida] = useState(null);
  const [diaElegido, setDiaElegido] = useState(null);
  // Alertas SAT publicadas en el embebido de alertas meteorológicas (vigentes).
  const [publicadas, setPublicadas] = useState(null);
  const [publicando, setPublicando] = useState(null);
  const audioCtxRef = useRef(null);
  const vistosAcpRef = useRef(new Set());

  function activarSonido() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
      sonarAlarma(audioCtxRef.current);
      setSonidoListo(true);
    } catch { /* sin soporte de audio en este navegador */ }
  }

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
    const refrescarPublicadas = () => getAlertasSmnPublicadasPanel().then(p => { if (!controller.signal.aborted) setPublicadas(p); }).catch(() => {});
    refresh(); refrescarPublicadas();
    const timer = setInterval(() => { refresh(); refrescarPublicadas(); }, 60000);
    return () => { clearInterval(timer); controller.abort(); };
  }, []);

  // Detecta avisos ACP nuevos (id nunca visto en esta pestaña) y hace sonar
  // la alarma. Corre en cada actualización de `data` (cada 60s o al tocar
  // "Consultar ahora"); no repite el sonido para un mismo aviso.
  useEffect(() => {
    if (!data) return;
    const activos = (data.fuentes.ACP?.alertas || []).flatMap(a => a.infos.map((info, i) => `${a.id}:${i}`));
    const nuevos = activos.filter(id => !vistosAcpRef.current.has(id));
    activos.forEach(id => vistosAcpRef.current.add(id));
    if (nuevos.length && sonidoListo && audioCtxRef.current) sonarAlarma(audioCtxRef.current);
  }, [data, sonidoListo]);

  async function publicar(info) {
    setPublicando(info.id); setError('');
    try { await publicarAlertaSmn(info.id); setPublicadas(await getAlertasSmnPublicadasPanel()); }
    catch (e) { setError(e.message); }
    finally { setPublicando(null); }
  }
  async function despublicar(p) {
    if (!(await confirmar({ titulo: '¿Sacar la alerta del mapa público?', texto: 'Deja de mostrarse ahora, sin esperar a que venza.', confirmar: 'Despublicar' }))) return;
    setPublicando(p.smnId); setError('');
    try { await despublicarAlertaSmn(p.id); setPublicadas(await getAlertasSmnPublicadasPanel()); }
    catch (e) { setError(e.message); }
    finally { setPublicando(null); }
  }

  async function consultarAhora() {
    if (updating) return;
    setUpdating(true); setError('');
    try { setData(await actualizarSmnAlertas()); }
    catch (e) { setError(e.message); }
    finally { setUpdating(false); }
  }

  const todas = data ? Object.values(data.fuentes).flatMap(f => f.alertas).flatMap(a => a.infos.map((info, index) => ({ ...info, id: `${a.id}:${index}`, fuente: a.fuente, url: a.url, emitidoEn: a.emitidoEn })))
    .filter(i => Date.parse(i.fin) > Date.now()).sort((a, b) => order[a.categoria] - order[b.categoria]) : [];
  const sat = todas.filter(i => i.fuente !== 'ACP');
  const acp = todas.filter(i => i.fuente === 'ACP');
  const emisiones = [...new Set(sat.map(i => i.emitidoEn).filter(Boolean))].sort().reverse();
  const emision = emisiones.includes(emisionElegida) ? emisionElegida : emisiones[0] || null;
  const deEmision = sat.filter(i => i.emitidoEn === emision);
  const hoy = diaAR(Date.now());
  const dias = [...new Set(deEmision.flatMap(diasDe))].sort();
  if (acp.length && !dias.includes(hoy)) dias.unshift(hoy); // los ACP son de ahora mismo
  const dia = dias.includes(diaElegido) ? diaElegido : dias[0] || null;
  // Lo que se ve en el mapa y en la lista: la emisión y el día elegidos (+ los ACP, si el día es hoy).
  const infos = [...deEmision.filter(i => diasDe(i).includes(dia)), ...(dia === hoy ? acp : [])];
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
  const acpSinReconocer = acp.filter(i => !reconocidos.has(i.id));

  return <>
    <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading">
        <span className="editor-eyebrow">SMN · RSS/CAP</span>
        <h1>Alertas automáticas</h1>
        <p>Avisos oficiales del SMN, leídos automáticamente de su canal RSS/CAP cada 5 minutos: alertas (SAT) y avisos a muy corto plazo (ACP, ~15 min de anticipación). Tocá «Publicar en el mapa público» en cada alerta que quieras mostrar en el embebido de alertas meteorológicas: se ve hasta que termina y se saca sola.</p>
      </div>
      <p className="admin-panel__hint">
        {data ? `${data.alcance === 'argentina' ? 'Toda Argentina · prueba' : 'Misiones'} · última consulta ${last ? tiempoRelativo(last) : 'sin datos aún'}` : 'Consultando alertas oficiales del SMN…'}
      </p>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      {!error && outdated.length > 0 && <div className="alert alert--warn" role="status">{outdated.map(([s]) => s).join(' y ')}: actualización pendiente. Se muestran los últimos datos disponibles.</div>}

      {acpSinReconocer.length > 0 && <div className="smn-alarma" role="alert">
        <strong>⚠ {acpSinReconocer.length} aviso(s) a muy corto plazo del SMN</strong>
        <p>Llegan con poca anticipación y el polígono no es confiable: revisá el texto abajo y, si corresponde, dibujá el área a mano y publicá en <Link to="/panel/avisos-corto-plazo">Avisos a muy corto plazo</Link>.</p>
        <button type="button" className="btn" onClick={() => setReconocidos(r => new Set([...r, ...acpSinReconocer.map(i => i.id)]))}>Reconocer</button>
      </div>}
      <div className="admin-actions">
        <button className="btn btn--block" type="button" onClick={consultarAhora} disabled={updating}>{updating ? 'Consultando SMN…' : 'Consultar ahora'}</button>
        <button className="btn btn--block" type="button" onClick={activarSonido}>{sonidoListo ? '🔔 Sonido de alarma activado' : '🔈 Activar sonido de alarma'}</button>
      </div>
      {!sonidoListo && <p className="admin-panel__hint">El sonido lo tiene que activar una persona (los navegadores bloquean el audio automático); dejalo activado mientras esta pestaña quede abierta.</p>}

      {emisiones.length === 1 && <p className="smn-seleccion smn-seleccion__emision">Emisión del SMN de las {horaCorta(emisiones[0])} · reemplaza a las anteriores</p>}
      {emisiones.length > 1 && <div className="smn-seleccion">
        <label className="smn-seleccion__emision">Emisión del SMN
          <select value={emision || ''} onChange={e => { setEmisionElegida(e.target.value); setDiaElegido(null); }}>
            {emisiones.map((em, i) => <option key={em} value={em}>{horaCorta(em)}{i === 0 ? ' · la más reciente' : ' · reemplazada'}</option>)}
          </select>
        </label>
        {emision !== emisiones[0] && <p className="admin-panel__hint">Estás viendo una emisión vieja: el SMN la reemplazó por la de las {horaCorta(emisiones[0])}.</p>}
      </div>}
      {dias.length > 0 && <div className="placa-toolbar smn-seleccion__dias" role="group" aria-label="Día">
        {dias.map(d => <button type="button" key={d} className="btn" aria-pressed={d === dia} onClick={() => setDiaElegido(d)}>{etiquetaDia(d)}</button>)}
      </div>}

      {publicadas?.length > 0 && <div className="avisos-lista">
        <h2>Publicadas en el mapa público ({publicadas.length})</h2>
        <ul>{publicadas.map(p => <li key={p.id}>
          <strong style={{ borderLeft: `6px solid ${p.color || '#999'}`, paddingLeft: 8 }}>{p.titulo} · {p.categoria}</strong>
          <p className="avisos-lista__texto">{p.zonas.map(z => z.nombre).join(' · ')} · {horaCorta(p.inicio)} a {horaCorta(p.fin)}</p>
          <small>Publicada el {horaCorta(p.publicadoEn)}{p.publicadoPorEmail && <> · {p.publicadoPorEmail}</>} · se saca sola el {horaCorta(p.vigenteHasta)}</small>
          <div className="avisos-lista__acciones"><button type="button" className="btn btn--ghost" disabled={publicando != null} onClick={() => despublicar(p)}>{publicando === p.smnId ? 'Despublicando…' : 'Despublicar'}</button></div>
        </li>)}</ul>
      </div>}
      <EmbedShare path="/embed/alertas-meteorologicas" title="Alertas meteorológicas · Misiones" />

      <h2>{dia ? `Avisos · ${etiquetaDia(dia)}` : 'Avisos vigentes'} ({infos.length})</h2>
      {infos.length === 0 && <p className="admin-panel__hint">No hay avisos vigentes en la respuesta del SMN.</p>}
      <div className="smn-avisos">
        {infos.map(info => <article key={info.id} className="smn-aviso" style={{ '--smn-color': data.colores[info.categoria] }}>
          <div className="smn-aviso__cabecera"><strong>{info.titulo}</strong><span className="smn-aviso__categoria">{info.categoria === 'ACP' ? 'ACP · muy corto plazo' : info.categoria}</span></div>
          <p>{info.zonas.map(z => z.nombre).join(' · ')}</p>
          <p>{fecha(info.inicio)} — {fecha(info.fin)}</p>
          {info.descripcion && <p>{info.descripcion}</p>}
          {info.zonas.some(z => !z.geometry) && <p>Sin polígono disponible{info.fuente === 'ACP' ? <> — dibujalo a mano en <Link to="/panel/avisos-corto-plazo">Avisos a muy corto plazo</Link></> : ' para dibujar en el mapa.'}</p>}
          {info.url && <a href={info.url} target="_blank" rel="noreferrer">Documento oficial SMN ↗</a>}
          {info.fuente !== 'ACP' && (() => {
            const pub = publicadas?.find(p => p.smnId === info.id);
            if (pub) return <p className="smn-aviso__publicada">✓ Publicada en el mapa público hasta el {horaCorta(pub.vigenteHasta)}</p>;
            const sinArea = !info.zonas.some(z => z.geometry);
            return <button type="button" className="btn btn--primary" disabled={sinArea || publicando != null || publicadas === null} onClick={() => publicar(info)}>
              {publicando === info.id ? 'Publicando…' : sinArea ? 'Sin área: no se puede publicar' : 'Publicar en el mapa público'}</button>;
          })()}
        </article>)}
      </div>
    </section>

    <div className="admin-map-area">
      {base ? <BaseMap poligonos={{ type: 'FeatureCollection', features }} datos={datos}
        colorDe={d => data.colores[d?.categoria]} regionLabel={data?.alcance === 'argentina' ? 'Argentina · prueba' : 'Misiones'}
        titulo={dia ? `SMN · ${etiquetaDia(dia)}` : 'SMN · avisos vigentes'} publicadoEn={emision || last}
        leyenda={<div className="risk-legend"><strong>{infos.length} {infos.length === 1 ? 'aviso' : 'avisos'}{dia ? ` · ${etiquetaDia(dia)}` : ' vigentes'}</strong>
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
