import { useEffect, useState } from "react";
import PolygonDrawMap from "../components/PolygonDrawMap";
import { getAvisoCortoPlazoActual, getMunicipiosGeojson } from "../api";
import { tiempoRelativo, fechaLarga } from "../lib/tiempoRelativo";

// Página pensada para el <iframe> del sitio del ministerio — mismo patrón
// que EmbedRiesgoPage.jsx: solo lectura, muestra el último aviso
// publicado desde /panel/avisos-corto-plazo (mapa con el polígono sobre
// los límites municipales + el texto del aviso).
export default function EmbedAvisosCortoPlazoPage() {
  const [actual, setActual] = useState(null);
  const [municipios, setMunicipios] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    getMunicipiosGeojson().then((g) => { if (!cancelado) setMunicipios(g); }).catch(() => {});
    async function cargar() {
      try {
        const data = await getAvisoCortoPlazoActual();
        if (!cancelado) { setActual(data); setError(""); }
      } catch (e) { if (!cancelado) setError(e.message); }
      finally { if (!cancelado) setCargando(false); }
    }
    cargar();
    const timer = setInterval(cargar, 60 * 1000);
    return () => { cancelado = true; clearInterval(timer); };
  }, []);

  if (!actual) {
    return (
      <div className="base-map base-map--fallback">
        <div><strong>Aviso a muy corto plazo · Misiones</strong><p>{error || (cargando ? "Cargando…" : "Todavía no hay un aviso publicado.")}</p></div>
      </div>
    );
  }

  return (
    <div className="aviso-embed">
      {error && <div className="embed-warning" role="status">No se pudo actualizar. Se muestra el último aviso recibido.</div>}
      <div className="aviso-embed__mapa">
        <PolygonDrawMap puntos={actual.poligono} onChange={() => {}} municipios={municipios} readOnly />
      </div>
      <div className="aviso-embed__info">
        <h2>{actual.titulo}</h2>
        <p>{actual.texto}</p>
        <small>Publicado {tiempoRelativo(actual.publicadoEn)} · {fechaLarga(actual.publicadoEn)}</small>
      </div>
    </div>
  );
}
