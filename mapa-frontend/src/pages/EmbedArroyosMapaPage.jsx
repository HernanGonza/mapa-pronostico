import { useEffect, useState } from "react";
import ArroyosMap from "../components/ArroyosMap";
import TarjetaArroyo from "../components/TarjetaArroyo";
import { getArroyosPublico } from "../api";

// Para el <iframe> del sitio del ministerio: el mapa de arroyos; al tocar un punto se abre su tarjeta,
// que cambia de color según los umbrales. Mismo patrón que EmbedCuencasMapaPage.
export default function EmbedArroyosMapaPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState(null);
  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      try { const actual = await getArroyosPublico(); if (!cancelado) { setData(actual); setError(""); } }
      catch (e) { if (!cancelado) setError(e.message); }
    }
    cargar(); const t = setInterval(cargar, 5 * 60 * 1000);
    return () => { cancelado = true; clearInterval(t); };
  }, []);
  if (!data) return <div className="base-map base-map--fallback cuencas-claro"><div><strong>Arroyos de Misiones</strong><p>{error || "Cargando mapa…"}</p></div></div>;
  const elegido = data.puntos.find((p) => p.id === sel);
  return <div className="embed-risk cuencas-claro">
    {error && <div className="embed-warning" role="status">No se pudo actualizar. Se muestran los últimos datos recibidos.</div>}
    <ArroyosMap embed puntos={data.puntos} seleccionadoId={sel} onSeleccionar={setSel} />
    {elegido && <div className="arroyos-embed-tarjeta"><TarjetaArroyo p={elegido} publico onCerrar={() => setSel(null)} /></div>}
  </div>;
}
