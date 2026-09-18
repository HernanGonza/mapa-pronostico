const MONITOR_URL = {
  parana: 'https://sig.misiones.gob.ar/mapas/monitor/rio-parana/',
  uruguay: 'https://sig.misiones.gob.ar/mapas/monitor/rio-uruguay/',
  iguazu: 'https://sig.misiones.gob.ar/mapas/monitor/rio-iguazu/',
};

const fmt = valor => Math.round(valor).toLocaleString('es-AR');

// Reproduce las 3 tarjetas "Río Paraná/Uruguay/Iguazú" del Monitor
// Hidrológico de sig.misiones.gob.ar (no hay iframe recortable: esa página
// arma esas tarjetas ella misma a partir de datos públicos, así que el
// backend re-sirve los mismos datos — ver mapa-backend/src/lib/cuencas).
// Cada tarjeta linkea al detalle propio de esa cuenca en el sitio de
// origen (mismo destino al que lleva esa página al tocar cada río).
export default function MonitorCuencas({ tarjetas }) {
  if (!tarjetas) return null;
  return <div className="cuencas-tarjetas">
    {['parana', 'uruguay', 'iguazu'].map(id => {
      const t = tarjetas[id];
      return <a key={id} className="cuencas-tarjeta" href={MONITOR_URL[id]} target="_blank" rel="noopener noreferrer">
        <strong>{t.rio}</strong>
        <span className="cuencas-tarjeta__subtitulo">{t.subtitulo}</span>
        <span className="cuencas-tarjeta__valor">{fmt(t.valor)} <small>m³/s</small></span>
        {t.detalle && <span className="cuencas-tarjeta__detalle">{t.detalle}</span>}
      </a>;
    })}
  </div>;
}
