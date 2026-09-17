import { useEffect, useState } from "react";
import SerieClimaticaChart from "../components/SerieClimaticaChart";
import { getEstacionesClimaticas, getSerieClimatica, getEventosClimaticosPublicos } from "../api";

// Página pensada para el <iframe> del sitio del ministerio — mismo patrón
// que EmbedAvisosCortoPlazoPage.jsx: solo lectura, muestra la serie
// climática histórica de la estación elegida + los eventos meteorológicos
// puntuales que el panel ya publicó (ver HistoricoPage).
export default function EmbedHistoricoPage() {
  const [estaciones, setEstaciones] = useState([]);
  const [estacion, setEstacion] = useState("");
  const [serie, setSerie] = useState(null);
  const [eventos, setEventos] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getEstacionesClimaticas().then((r) => { setEstaciones(r.estaciones); if (r.estaciones.length) setEstacion(r.estaciones[0]); }).catch(() => {});
    getEventosClimaticosPublicos().then((r) => setEventos(r.eventos)).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!estacion) return;
    getSerieClimatica(estacion).then((r) => setSerie(r.serie)).catch((e) => setError(e.message));
  }, [estacion]);

  return (
    <div className="historico-embed">
      <div className="historico-embed__clima">
        <div className="historico-embed__encabezado">
          <h2>Clima histórico</h2>
          {estaciones.length > 0 && (
            <select value={estacion} onChange={(e) => setEstacion(e.target.value)}>
              {estaciones.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          )}
        </div>
        {error && <div className="embed-warning" role="status">{error}</div>}
        <SerieClimaticaChart serie={serie || []} />
      </div>
      <div className="historico-embed__eventos">
        <h2>Eventos meteorológicos</h2>
        {eventos === null ? <p role="status">Cargando…</p> : eventos.length === 0 ? (
          <p>Todavía no se publicó ningún evento.</p>
        ) : (
          <ul className="historico-embed__lista">
            {eventos.map((ev) => (
              <li key={ev.id}>
                {ev.imagenes?.[0] && <img src={ev.imagenes[0].url} alt="" />}
                <div>
                  <strong>{ev.titulo}</strong>
                  <p>{ev.fechaInicio}{ev.departamento && ` · ${ev.departamento}`}</p>
                  <p>{ev.descripcion}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
