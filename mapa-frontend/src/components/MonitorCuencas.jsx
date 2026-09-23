const MONITOR_URL = 'https://sig.misiones.gob.ar/mapas/monitor/';
const fmt = (valor, decimales = 0) => Number.isFinite(valor) ? valor.toLocaleString('es-AR', { maximumFractionDigits: decimales }) : '—';
const fecha = valor => valor && Number.isFinite(Date.parse(valor))
  ? new Date(valor).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Sin medición';
const sinDatos = { codigo: 'sin_datos', etiqueta: 'Sin datos recientes', motivo: 'Esperando una lectura válida' };
export default function MonitorCuencas({ tarjetas, desactualizado = false }) {
  if (!tarjetas) return null;
  const items = ['parana', 'uruguay', 'iguazu'].filter(id => tarjetas[id]).map(id => ({ id, ...tarjetas[id] }));
  const avisos = items.filter(t => ['vigilancia', 'alerta', 'evacuacion', 'emergencia'].includes(t.estado?.codigo));
  return <div className="cuencas-claro">
    {avisos.length > 0 && <div className="cuencas-avisos" role="status">{avisos.map(t => <p key={t.id}><strong>{t.rio} · {t.estado.etiqueta}</strong> — {t.estado.motivo}{desactualizado ? ' (último estado recibido)' : ''}</p>)}</div>}
    <div className="cuencas-tarjetas">
      {items.map(t => {
        const s = desactualizado ? sinDatos : t.estado || sinDatos;
        return <article key={t.id} className={`cuencas-tarjeta cuencas-tarjeta--${s.codigo}`}>
          <div className="cuencas-tarjeta__cabecera"><h2>{t.rio}</h2><span className={`cuencas-estado cuencas-estado--${s.codigo}`}>{s.etiqueta}</span></div>
          <p className="cuencas-tarjeta__motivo">{s.motivo}</p>
          {t.coberturaIncompleta && s.codigo !== 'sin_datos' && <p className="cuencas-tarjeta__nota">Cobertura parcial: faltan lecturas locales recientes.</p>}
          <span className="cuencas-tarjeta__subtitulo">{t.subtitulo}</span>
          <span className="cuencas-tarjeta__valor">{fmt(t.valor)} <small>m³/s</small></span>
          <p className="cuencas-tarjeta__fecha">Medición: {fecha(t.fecha)}{!t.vigente && t.fecha ? ' · Atrasada' : ''}</p>
          {t.componentes?.map(c => <p key={c.nombre} className="cuencas-tarjeta__fecha">{c.nombre}: {fmt(c.valor)} m³/s · {fecha(c.fecha)}</p>)}
          {t.referenciaAlerta && <p className="cuencas-tarjeta__nota">Referencia para alertas: {t.referenciaAlerta.nombre}, {fmt(t.referenciaAlerta.valor)} m³/s · {fecha(t.referenciaAlerta.fecha)}{!t.referenciaAlerta.vigente ? ' · Sin dato reciente' : ''}</p>}
          {t.error && <p className="cuencas-tarjeta__nota">No se pudo renovar esta lectura.</p>}
          {t.localidades?.length > 0 && <ul className="cuencas-localidades">{t.localidades.map(l => <li key={l.id}>
            <div><strong>{l.nombre}</strong><span>{fmt(l.valor, 2)} m</span></div>
            <span>{l.vigente ? l.tendencia : 'Sin datos recientes'}{l.vigente && l.variacion !== null ? ` · ${l.variacion > 0 ? '+' : ''}${fmt(l.variacion * 100, 1)} cm/h` : ''}</span>
            <span className={`cuencas-estado cuencas-estado--${desactualizado ? 'sin_datos' : l.estado.codigo}`}>{desactualizado ? 'Actualización pendiente' : l.estado.etiqueta}</span>
            <time dateTime={l.fecha || undefined}>{fecha(l.fecha)}</time>
            {l.error && <small>No se pudo renovar esta lectura.</small>}
          </li>)}</ul>}
          <details className="cuencas-criterios"><summary>Cómo se interpreta</summary><p>{t.detalle}</p><p>{t.criterio}</p>
            {t.localidades?.map(l => <p key={l.id}>{l.nombre}: {l.alerta ? `alerta ${l.alerta} m; umbral de evacuación ${l.evacuacion} m${l.emergencia ? `; emergencia ${l.emergencia} m` : ''}.` : 'Sin umbral de altura definido en el detalle SIG.'} {l.nota}</p>)}
            <p>Ascenso local: vigilancia desde 4 cm/h; alerta desde 12 cm/h. Lecturas horarias consideradas recientes hasta 3 horas. Los estados son una interpretación de datos preliminares.</p>
          </details>
          <a className="cuencas-tarjeta__enlace" href={`${MONITOR_URL}rio-${t.id}/`} target="_blank" rel="noopener noreferrer">Ver detalle en SIG Misiones ↗</a>
        </article>;
      })}
    </div>
  </div>;
}
