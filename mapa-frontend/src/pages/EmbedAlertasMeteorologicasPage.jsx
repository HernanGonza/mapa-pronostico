import { useEffect, useState } from "react";
import RiesgoMap from "../components/RiesgoMap";
import { getAlertasMeteorologicasCatalogo, getAlertasMeteorologicasGeojson, getAlertasMeteorologicasActual } from "../api";

// Página pensada para ir en el <iframe> del sitio del ministerio — mismo
// patrón que EmbedRiesgoPage.jsx: solo lectura, muestra lo último
// publicado desde /panel/alertas-meteorologicas.
export default function EmbedAlertasMeteorologicasPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let cancelado = false;
    let base;
    async function cargar() {
      try {
        if (!base) base = await Promise.all([getAlertasMeteorologicasCatalogo(), getAlertasMeteorologicasGeojson()]);
        const actual = await getAlertasMeteorologicasActual();
        if (!cancelado) { setData({ catalogo: base[0], geo: base[1], actual }); setError(""); }
      } catch (e) { if (!cancelado) setError(e.message); }
      finally { if (!cancelado) setCargando(false); }
    }
    cargar(); const timer = setInterval(cargar, 60000);
    return () => { cancelado = true; clearInterval(timer); };
  }, []);
  if (!data?.actual?.zonas) return <div className="base-map base-map--fallback"><div><strong>Alertas meteorológicas · Misiones</strong><p>{error || (cargando ? "Cargando mapa…" : "Todavía no hay un reporte publicado.")}</p></div></div>;
  return <div className="embed-risk">{error && <div className="embed-warning" role="status">No se pudo actualizar. Se muestra el último reporte recibido.</div>}
    <RiesgoMap geo={data.geo} zonas={data.actual.zonas} catalogo={data.catalogo} publicadoEn={data.actual.publicadoEn} />
  </div>;
}
