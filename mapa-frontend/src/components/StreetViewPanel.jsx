const GKEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

/**
 * Panel de vista a nivel calle de un municipio.
 *
 * - Con `VITE_GOOGLE_MAPS_KEY`: embebe Google Street View (Maps Embed API,
 *   sin límite de uso).
 * - Sin key: botón que abre Google Street View en una pestaña nueva.
 *
 * Preparado para cambiar a 3D fotorrealista (Map Tiles API + deck.gl) más
 * adelante — el contenedor `.sv-panel__view` es el mismo.
 */
export default function StreetViewPanel({ nombre, lngLat, onClose }) {
  const [lng, lat] = lngLat;
  const embedUrl =
    GKEY &&
    `https://www.google.com/maps/embed/v1/streetview?key=${GKEY}` +
      `&location=${lat},${lng}&heading=210&pitch=0&fov=90`;
  const externalUrl = `https://www.google.com/maps/@${lat},${lng},3a,75y,210h,90t/data=!3m1!1e3`;

  return (
    <div className="sv-panel" role="dialog" aria-label={`Vista de calle de ${nombre}`}>
      <div className="sv-panel__head">
        <div>
          <span className="sv-panel__eyebrow">Vista a nivel calle</span>
          <h3>{nombre}</h3>
        </div>
        <button className="sv-panel__close" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
      </div>

      <div className="sv-panel__view">
        {embedUrl ? (
          <iframe
            title={`Street View de ${nombre}`}
            src={embedUrl}
            loading="lazy"
            allowFullScreen
          />
        ) : (
          <div className="sv-panel__nokey">
            <p>
              Para ver la calle embebida hace falta una clave de Google Maps
              (<code>VITE_GOOGLE_MAPS_KEY</code>).
            </p>
            <a
              className="btn btn--primary"
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir en Google Street View
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
