import { useEffect, useState } from "react";
import RiesgoMap from "../components/RiesgoMap";
import { getRiesgoCatalogo, getDepartamentosGeojson, getRiesgoActual } from "../api";

export default function EmbedRiesgoPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let cancelado = false;
    let base;
    async function cargar() {
      try {
        if (!base) base = await Promise.all([getRiesgoCatalogo(), getDepartamentosGeojson()]);
        const actual = await getRiesgoActual();
        if (!cancelado) { setData({ catalogo: base[0], geo: base[1], actual }); setError(""); }
      } catch (e) { if (!cancelado) setError(e.message); }
      finally { if (!cancelado) setCargando(false); }
    }
    cargar(); const timer = setInterval(cargar, 60000);
    return () => { cancelado = true; clearInterval(timer); };
  }, []);
  if (!data?.actual) return <div className="base-map base-map--fallback"><div><strong>Riesgo de incendios forestales · Misiones</strong><p>{error || (cargando ? "Cargando mapa…" : "Todavía no hay un reporte publicado.")}</p></div></div>;
  return <div className="embed-risk">{error && <div className="embed-warning" role="status">No se pudo actualizar. Se muestra el último reporte recibido.</div>}
    <RiesgoMap geo={data.geo} zonas={data.actual.zonas} catalogo={data.catalogo} publicadoEn={data.actual.publicadoEn} />
  </div>;
}
