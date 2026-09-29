import { useEffect, useState } from "react";
import PolygonDrawMap from "../components/PolygonDrawMap";
import { getAvisosCortoPlazoVigentes, getMunicipiosGeojson } from "../api";
import { tiempoRelativo } from "../lib/tiempoRelativo";

const hora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Página pensada para el <iframe> del sitio del ministerio — mismo patrón
// que EmbedRiesgoPage.jsx: solo lectura, muestra los avisos publicados
// desde /panel/avisos-corto-plazo que siguen vigentes (puede haber varios, o
// ninguno: entonces lo dice). Se refresca cada minuto, así un aviso que
// vence desaparece solo aunque nadie recargue la página.
export default function EmbedAvisosCortoPlazoPage() {
  const [avisos, setAvisos] = useState(null);
  const [municipios, setMunicipios] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelado = false;
    getMunicipiosGeojson().then((g) => { if (!cancelado) setMunicipios(g); }).catch(() => {});
    async function cargar() {
      try {
        const data = await getAvisosCortoPlazoVigentes();
        if (!cancelado) { setAvisos(data); setError(""); }
      } catch (e) { if (!cancelado) setError(e.message); }
    }
    cargar();
    const timer = setInterval(cargar, 60 * 1000);
    return () => { cancelado = true; clearInterval(timer); };
  }, []);

  // Si un aviso vence entre dos consultas, se saca igual en el momento.
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 15 * 1000); return () => clearInterval(t); }, []);
  const vigentes = (avisos || []).filter((a) => Date.parse(a.vigenteHasta) > ahora);

  return (
    <div className="aviso-embed">
      {error && avisos && <div className="embed-warning" role="status">No se pudo actualizar. Se muestra lo último recibido.</div>}
      <div className="aviso-embed__mapa">
        <PolygonDrawMap poligonos={vigentes.map((a) => a.poligono)} onChange={() => {}} municipios={municipios} readOnly colorPoligono="#8b3fc4" />
      </div>
      <div className="aviso-embed__info">
        {avisos === null ? (
          <p className="aviso-embed__vacio">{error ? "No se pudieron cargar los avisos." : "Cargando…"}</p>
        ) : vigentes.length === 0 ? (
          <div className="aviso-embed__vacio">
            <h2>Sin avisos a muy corto plazo</h2>
            <p>No hay avisos vigentes para Misiones en este momento.</p>
          </div>
        ) : vigentes.map((a) => (
          <article key={a.id} className="aviso-embed__aviso">
            <h2>{a.titulo}</h2>
            <p>{a.texto}</p>
            <small>Vigente hasta el {hora(a.vigenteHasta)} · publicado {tiempoRelativo(a.publicadoEn)}</small>
          </article>
        ))}
      </div>
    </div>
  );
}
