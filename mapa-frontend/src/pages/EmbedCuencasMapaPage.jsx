import { useEffect, useState } from "react";
import CuencasMap from "../components/CuencasMap";
import { getCuencas } from "../api";

// Página pensada para ir en el <iframe> del sitio del ministerio — mismo
// patrón que EmbedRiesgoPage.jsx, pero solo el mapa del Monitor de cuencas
// (las 3 tarjetas van en un iframe aparte, ver EmbedCuencasTarjetasPage).
export default function EmbedCuencasMapaPage() {
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
    cargar(); const timer = setInterval(cargar, 5 * 60 * 1000);
    return () => { cancelado = true; clearInterval(timer); };
  }, []);
  if (!data?.puertos) return <div className="base-map base-map--fallback"><div><strong>Monitor de cuencas · Misiones</strong><p>{error || (cargando ? "Cargando mapa…" : "Todavía no hay datos disponibles.")}</p></div></div>;
  return <div className="embed-risk">{error && <div className="embed-warning" role="status">No se pudo actualizar. Se muestran los últimos datos recibidos.</div>}
    <CuencasMap represas={data.represas} puertos={data.puertos} titulo="Monitor de cuencas" />
  </div>;
}
