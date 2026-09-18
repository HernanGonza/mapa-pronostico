import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PointsMap from "../components/PointsMap";
import EmbedShare from "../components/EmbedShare";
import BrandHeader from "../components/BrandHeader";
import { extraerFocos, focosAGeojson } from "../lib/alertasIncendio";
import { useAlertasIncendioActual } from "../lib/useAlertasIncendioActual";
import { tiempoRelativo, fechaLarga } from "../lib/tiempoRelativo";

function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AlertasIncendiosPage() {
  const { actual, error: errorCarga, cargando } = useAlertasIncendioActual();
  const [error, setError] = useState(null);
  const mapaRef = useRef(null);

  const focos = useMemo(() => extraerFocos(actual?.datos), [actual?.datos]);
  const puntos = useMemo(() => focosAGeojson(focos), [focos]);

  async function onCapturar() {
    if (!mapaRef.current) return;
    setError(null);
    try {
      const dataUrl = await mapaRef.current.capturePng();
      if (!dataUrl) throw new Error("El mapa todavía no está listo");
      const blob = await (await fetch(dataUrl)).blob();
      descargarBlob(blob, `puntos_calor_${Date.now()}.png`);
    } catch (err) {
      setError(err.message);
    }
  }

  const relativo = tiempoRelativo(actual?.recuperadoEn);

  return (
    <div className="admin-layout">
      <BrandHeader subtitulo="Puntos de calor · NASA FIRMS">
        <Link to="/panel/mapas" className="btn-link">
          ← Panel
        </Link>
      </BrandHeader>

      <div className="admin-panel" id="contenido-principal" tabIndex={-1}>
        <div className="editor-heading"><span className="editor-eyebrow">DETECCIONES SATELITALES · NASA FIRMS</span><h1>Puntos de calor</h1><p>Anomalías térmicas detectadas por satélite. Un punto no confirma por sí solo un incendio; puede corresponder a otras fuentes de calor. Los datos recibidos se actualizan automáticamente en el mapa.</p></div>
        <h2>Recepción automática</h2>
        <p className="admin-panel__hint">{cargando ? "Consultando detecciones…" : actual ? "Mapa público actualizado con la última tanda recibida." : "Esperando la primera tanda de detecciones."}</p>
        {(error || errorCarga) && <div className="alert alert--error">{error || errorCarga}</div>}

        {actual && (
          <>
            <h2 style={{ marginTop: 22 }}>Última tanda</h2>
            <p className="admin-panel__hint">
              Recibida y publicada <b>{relativo}</b> · {fechaLarga(actual.recuperadoEn)}
              <br />
              {focos.length} punto(s) con coordenadas reconocidas.
            </p>

            <div className="admin-actions">
              <button className="btn btn--block" onClick={onCapturar} disabled={cargando}>
                Capturar el mapa como se ve acá
              </button>
            </div>
          </>
        )}
        <EmbedShare path="/embed/alertas-incendios" title="Puntos de calor de Misiones" />
      </div>

      <div className="admin-map-area">
        <PointsMap
          ref={mapaRef}
          puntos={puntos}
          titulo="Puntos de calor"
          enableCapture
        />
      </div>
    </div>
  );
}
