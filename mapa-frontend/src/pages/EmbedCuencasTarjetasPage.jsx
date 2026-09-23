import { useEffect, useState } from "react";
import MonitorCuencas from "../components/MonitorCuencas";
import { getCuencas } from "../api";
import { tiempoRelativo } from "../lib/tiempoRelativo";

// Página pensada para ir en el <iframe> del sitio del ministerio — las 3
// tarjetas (Paraná/Uruguay/Iguazú) sueltas, sin el mapa (ver
// EmbedCuencasMapaPage para el mapa aparte).
export default function EmbedCuencasTarjetasPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      try {
        const actual = await getCuencas();
        if (!cancelado) { setData(actual); setError(""); }
      } catch (e) { if (!cancelado) setError(e.message); }
      finally { if (!cancelado) setCargando(false); }
    }
    cargar(); const timer = setInterval(cargar, 60 * 1000);
    return () => { cancelado = true; clearInterval(timer); };
  }, []);
  if (!data?.tarjetas) return <main className="cuencas-tarjetas-embed cuencas-claro"><p role="status">{error || (cargando ? "Cargando…" : "Todavía no hay datos disponibles.")}</p></main>;
  return <main className="cuencas-tarjetas-embed cuencas-claro">
    {(error || data.error || data.desactualizado) && <div className="embed-warning" role="status">{data.error || "Actualización pendiente. Se muestran los últimos datos recibidos."}</div>}
    <MonitorCuencas tarjetas={data.tarjetas} desactualizado={Boolean(error || data.desactualizado)} />
    {data.consultadoEn && <p className="cuencas-tarjetas-embed__fecha">Última consulta {tiempoRelativo(data.consultadoEn)}</p>}
  </main>;
}
