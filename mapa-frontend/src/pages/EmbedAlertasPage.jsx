import { useEffect, useMemo, useState } from "react";
import PointsMap from "../components/PointsMap";
import { getAlertasIncendioActual } from "../api";
import { DATOS_DEMO_ALERTAS, extraerFocos, focosAGeojson } from "../lib/alertasIncendio";

export default function EmbedAlertasPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    let timer;
    let base;
    async function cargar() {
      try {
        const actual = await getAlertasIncendioActual();
        if (!cancelado) { setData({ actual, base: true }); setError(""); }
      } catch (err) {
        if (!cancelado) setError(err.message);
      } finally {
        if (!cancelado) {
          setCargando(false);
          timer = setTimeout(cargar, 60000);
        }
      }
    }
    cargar();
    return () => { cancelado = true; clearTimeout(timer); };
  }, []);

  const puntos = useMemo(() => focosAGeojson(extraerFocos(data?.actual?.datos || DATOS_DEMO_ALERTAS)), [data?.actual]);
  if (!data?.base) return (
    <div className="base-map base-map--fallback"><div>
      <strong>Alertas de incendios · Misiones</strong>
      <p>{error || "Cargando mapa…"}</p>
    </div></div>
  );
  return <div className="embed-risk">
    {(error || !data?.actual) && <div className="embed-warning" role="status">{error ? "No se pudo actualizar. " : "Vista de prueba. "}Se muestran focos de ejemplo hasta recibir el JSON real.</div>}
    <PointsMap puntos={puntos} titulo="Alertas de incendios" />
  </div>;
}
