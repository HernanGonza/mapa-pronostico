import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import EmbedShare from "../components/EmbedShare";
import PronosticoExtendidoView from "../components/PronosticoExtendidoView";
import { getActual } from "../api";

export default function PronosticoExtendidoPage() {
  const [actual, setActual] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    getActual()
      .then(setActual)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, []);

  return (
    <div className="admin-layout">
      <BrandHeader subtitulo="Pronóstico de 3 días">
        <Link to="/panel/pronostico" className="btn-link">Ir a Pronóstico</Link>
        <Link to="/panel/mapas" className="btn-link">← Panel</Link>
      </BrandHeader>
      <div className="admin-panel" id="contenido-principal" tabIndex={-1}>
        <div className="editor-heading">
          <h1>Pronóstico de 3 días</h1>
          <p>
            Se arma solo con el .docx que ya subís en <Link to="/panel/pronostico">Pronóstico</Link>, cuando trae la sección
            "Pronóstico extendido". Es por zona (Sur/Centro/Norte), no por localidad.
          </p>
        </div>
        {error && <div className="alert alert--error" role="alert">{error}</div>}
        {cargando ? (
          <p>Cargando…</p>
        ) : (
          <PronosticoExtendidoView extendido={actual?.extendido} publicadoEn={actual?.publicadoEn} />
        )}
        <EmbedShare path="/embed/pronostico-3-dias" title="Pronóstico de 3 días · Misiones" />
      </div>
    </div>
  );
}
