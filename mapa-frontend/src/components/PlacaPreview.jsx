import { useEffect, useState } from 'react';
import PublicarEnRedes from './PublicarEnRedes';

export default function PlacaPreview({ placa, imagenes, recomendaciones, vista, onVista, titulo, children, labelRecomendaciones = 'Recomendaciones', epigrafe }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!placa) { setUrl(null); return; }
    const nuevaUrl = URL.createObjectURL(placa.blob);
    setUrl(nuevaUrl);
    return () => URL.revokeObjectURL(nuevaUrl);
  }, [placa]);
  const conjunto = vista === 'recomendaciones' ? recomendaciones : imagenes;
  const vistas = [['mapa', 'Mapa manual']];
  if (imagenes !== undefined) vistas.push(['placa', 'Placa para redes']);
  if (recomendaciones !== undefined) vistas.push(['recomendaciones', labelRecomendaciones]);

  return <div className="admin-map-area placa-workspace">
    <div className="placa-toolbar" role="group" aria-label="Vista del reporte">
      {vistas.map(([id, label]) => <button type="button" key={id} className="btn" aria-pressed={vista === id} onClick={() => onVista(id)}>{label}</button>)}
    </div>
    <div className="placa-content">
      <div className="placa-map" style={{ visibility: vista === 'mapa' ? 'visible' : 'hidden' }} aria-hidden={vista !== 'mapa'} inert={vista !== 'mapa' ? '' : undefined}>{children}</div>
      {vista !== 'mapa' && <div className="placa-preview">
        {conjunto ? <>
        <PublicarEnRedes className="btn btn--primary" feedUrl={conjunto.feed} historiasUrl={conjunto.historias} epigrafe={epigrafe ?? `${titulo.charAt(0).toUpperCase()}${titulo.slice(1)} · Ministerio de Ecología y RNR de Misiones`} />
        <div className="placa-preview-grid">
          {['feed', 'historias'].map(formato => <figure key={formato}>
            <a className="btn btn--primary" href={`${conjunto[formato]}?download=${encodeURIComponent(conjunto[`${formato}Nombre`])}`}>Descargar {formato}</a>
            <img src={conjunto[formato]} alt={`Vista previa de ${vista === 'recomendaciones' ? 'recomendaciones' : titulo} para ${formato}`} />
            <figcaption>{formato === 'feed' ? 'Feed' : 'Historias'}</figcaption>
          </figure>)}
        </div></> : placa && url && vista === 'placa' ? <>
          <a className="btn btn--primary" href={url} download={placa.nombre}>Descargar placa PNG</a>
          <figure><figcaption>{titulo}</figcaption><img src={url} alt={`Vista previa de la placa de ${titulo}`} /></figure>
        </> : <div className="admin-map-area__vacio" role="status">{vista === 'recomendaciones' ? 'Escribí el texto y presioná «Generar placa de recomendaciones» para ver y descargar las imágenes.' : 'Revisá los datos y presioná «Generar placa para redes» para ver y descargar la imagen.'}</div>}
      </div>}
    </div>
  </div>;
}
