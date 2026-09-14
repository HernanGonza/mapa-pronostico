import { useEffect, useState } from 'react';

export default function PlacaPreview({ placa, vista, onVista, titulo, children }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!placa) { setUrl(null); return; }
    const nuevaUrl = URL.createObjectURL(placa.blob);
    setUrl(nuevaUrl);
    return () => URL.revokeObjectURL(nuevaUrl);
  }, [placa]);

  return <div className="admin-map-area placa-workspace">
    <div className="placa-toolbar" role="group" aria-label="Vista del reporte">
      <button className="btn" aria-pressed={vista === 'mapa'} onClick={() => onVista('mapa')}>Mapa manual</button>
      <button className="btn" aria-pressed={vista === 'placa'} onClick={() => onVista('placa')}>Placa para redes</button>
    </div>
    <div className="placa-content">
      <div className="placa-map" style={{ visibility: vista === 'mapa' ? 'visible' : 'hidden' }} aria-hidden={vista !== 'mapa'} inert={vista !== 'mapa' ? '' : undefined}>{children}</div>
      {vista === 'placa' && <div className="placa-preview">
        {placa && url ? <>
          <a className="btn btn--primary" href={url} download={placa.nombre}>Descargar placa PNG</a>
          <figure><figcaption>{titulo}</figcaption><img src={url} alt={`Vista previa de la placa de ${titulo}`} /></figure>
        </> : <div className="admin-map-area__vacio">Revisá los datos y presioná «Generar placa para redes» para ver y descargar la imagen.</div>}
      </div>}
    </div>
  </div>;
}
