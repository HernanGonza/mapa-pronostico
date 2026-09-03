import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";

/**
 * Hoy este mapa lo genera un sistema aparte (Java) que todavía no está
 * integrado. Shell con las mismas opciones que el resto (publicar, imagen
 * para redes, capturar) ya armado y deshabilitado, para no tener que
 * rehacer la página cuando se conecte el generador — solo falta cablear
 * los datos.
 */
export default function RiesgoIncendiosPage() {
  return (
    <div className="admin-layout">
      <BrandHeader subtitulo="Riesgo de incendios forestales">
        <Link to="/panel" className="btn-link">
          ← Volver a la botonera
        </Link>
      </BrandHeader>

      <div className="admin-panel">
        <h2>Pendiente de integración</h2>
        <p className="admin-panel__hint">
          Este mapa lo genera hoy un sistema aparte, en Java. Falta integrarlo
          acá para poder publicarlo, generar la imagen para redes y capturarlo
          — las mismas opciones que tiene el mapa de pronóstico.
        </p>

        <div className="admin-actions">
          <button className="btn btn--primary btn--block" disabled>
            Publicar (actualiza el mapa público)
          </button>
          <button className="btn btn--block" disabled>
            Imagen para redes (servidor)
          </button>
          <button className="btn btn--block" disabled>
            Capturar el mapa como se ve acá
          </button>
        </div>
      </div>

      <div className="admin-map-area">
        <div className="admin-map-area__vacio">Todavía no hay generador conectado.</div>
      </div>
    </div>
  );
}
