import { useMemo } from "react";
import PointsMap from "../components/PointsMap";
import { extraerFocos, focosAGeojson } from "../lib/alertasIncendio";
import { useAlertasIncendioActual } from "../lib/useAlertasIncendioActual";

export default function EmbedAlertasPage() {
  const { actual, error, cargando } = useAlertasIncendioActual();
  const puntos = useMemo(() => focosAGeojson(extraerFocos(actual?.datos)), [actual?.datos]);
  return <div className="embed-risk">
    {(error || !actual) && <div className="embed-warning" role="status">{error || (cargando ? "Cargando detecciones…" : "Esperando detecciones del sistema.")}</div>}
    <PointsMap puntos={puntos} titulo="Focos de calor" />
  </div>;
}
