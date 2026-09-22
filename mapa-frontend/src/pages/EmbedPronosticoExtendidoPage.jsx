import { useEffect, useState } from "react";
import PronosticoExtendidoView from "../components/PronosticoExtendidoView";
import { getActual } from "../api";

// Página pensada para el <iframe> del sitio del ministerio — mismo patrón
// que EmbedRiesgoPage.jsx: solo lectura, muestra lo último publicado
// desde /panel/pronostico (campo `extendido`, si el .docx lo trajo).
export default function EmbedPronosticoExtendidoPage() {
  const params = new URLSearchParams(window.location.search);
  const completo = params.get("completo") === "1";
  const diaInicial = Math.max(0, Math.min(2, Number(params.get("dia")) || 0));
  const [actual, setActual] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      try {
        const data = await getActual();
        if (!cancelado) { setActual(data); setError(""); }
      } catch (e) { if (!cancelado) setError(e.message); }
      finally { if (!cancelado) setCargando(false); }
    }
    cargar();
    const timer = setInterval(cargar, 5 * 60 * 1000);
    return () => { cancelado = true; clearInterval(timer); };
  }, []);

  if (cargando) return <div className="base-map base-map--fallback"><div><strong>Pronóstico de 3 días · Misiones</strong><p>Cargando…</p></div></div>;

  return (
    <div className={`embed-risk embed-risk--pronostico${completo ? " embed-risk--informe-completo" : ""}`}>
      {error && <div className="embed-warning" role="status">No se pudo actualizar. Se muestra el último reporte recibido.</div>}
      <PronosticoExtendidoView extendido={actual?.extendido} publicadoEn={actual?.publicadoEn} embebido={!completo} diaInicial={diaInicial} />
    </div>
  );
}
