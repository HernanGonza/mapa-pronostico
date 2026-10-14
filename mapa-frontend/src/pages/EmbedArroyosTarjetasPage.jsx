import { useEffect, useState } from "react";
import TarjetaArroyo from "../components/TarjetaArroyo";
import { getArroyosPublico } from "../api";
import { tiempoRelativo } from "../lib/tiempoRelativo";

// Para el <iframe> del sitio del ministerio: las tarjetas de los arroyos, sin el mapa.
export default function EmbedArroyosTarjetasPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      try { const actual = await getArroyosPublico(); if (!cancelado) { setData(actual); setError(""); } }
      catch (e) { if (!cancelado) setError(e.message); }
    }
    cargar(); const t = setInterval(cargar, 5 * 60 * 1000);
    return () => { cancelado = true; clearInterval(t); };
  }, []);
  if (!data) return <main className="cuencas-tarjetas-embed cuencas-claro"><p role="status">{error || "Cargando…"}</p></main>;
  return <main className="cuencas-tarjetas-embed cuencas-claro">
    {error && <div className="embed-warning" role="status">No se pudo actualizar. Se muestran los últimos datos recibidos.</div>}
    <div className="cuencas-tarjetas">{data.puntos.map((p) => <TarjetaArroyo key={p.id} p={p} publico />)}</div>
    {data.consultadoEn && <p className="cuencas-tarjetas-embed__fecha">Última consulta {tiempoRelativo(data.consultadoEn)} · Datos crudos de la Red Hidrológica Nacional, sin validar.</p>}
  </main>;
}
