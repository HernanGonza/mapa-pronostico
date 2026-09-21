import { useEffect, useRef, useState } from "react";
import { useNotificacion } from "../lib/useNotificacion";
import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import PlacaPreview from "../components/PlacaPreview";
import PublicarEnRedes from "../components/PublicarEnRedes";
import PolygonDrawMap from "../components/PolygonDrawMap";
import EmbedShare from "../components/EmbedShare";
import PublicationStatus from "../components/PublicationStatus";
import * as api from "../api";
import { confirmar, notificar } from "../lib/ui";
import { crearAvisoPorPasos } from "../lib/asistenteAviso";


export default function AvisosCortoPlazoPage() {
  const [puntos, setPuntos] = useState([]);
  const [titulo, setTitulo] = useState("Aviso a muy corto plazo");
  const [texto, setTexto] = useState("");
  const [fondo, setFondo] = useState("tormenta");
  const [imagenes, setImagenes] = useState(null);
  const [vista, setVista] = useState("mapa");
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  useNotificacion(mensaje);
  const [historial, setHistorial] = useState(null);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [municipios, setMunicipios] = useState(null);
  const [publicando, setPublicando] = useState(null); // id del aviso que se está publicando
  const [publicado, setPublicado] = useState(null); // último aviso publicado (mapa público)
  const mapaRef = useRef(null);

  useEffect(() => {
    api.getAvisosCortoPlazoHistorial().then((r) => setHistorial(r.historial)).catch(() => setHistorial([]));
    api.getMunicipiosGeojson().then(setMunicipios).catch(() => {});
    api.getAvisoCortoPlazoActual().then(setPublicado).catch(() => setPublicado(null));
  }, []);

  function cambiarPuntos(nuevos) { setPuntos(nuevos); setImagenes(null); }

  // La vista previa NO guarda nada; recién al confirmar en el asistente se guarda (la misma imagen).
  const vistaPrevia = (valores) => api.generarAvisoCortoPlazo({ poligono: puntos, ...valores, imagen: mapaRef.current?.capturePng() || null, vistaPrevia: true });
  async function guardarPlaca(valores, token) {
    const placa = await api.generarAvisoCortoPlazo({ poligono: puntos, ...valores, confirmarToken: token });
    setTitulo(valores.titulo); setTexto(valores.texto); setFondo(valores.fondo);
    setImagenes({ feed: placa.feedUrl, historias: placa.historiasUrl, feedNombre: placa.feedNombre, historiasNombre: placa.historiasNombre });
    setVista("recomendaciones");
    setHistorial((h) => [{ ...placa, poligono: puntos, ...valores }, ...(h || [])]);
    setHistorialAbierto(true);
    return placa;
  }

  async function crearPlaca() {
    if (puntos.length < 3) { notificar("error", "Primero dibujá la zona afectada en el mapa (al menos 3 puntos)."); return; }
    setError(""); setMensaje("");
    await crearAvisoPorPasos({ inicial: { titulo, texto, fondo }, vistaPrevia, guardar: guardarPlaca });
  }

  // Publicar es independiente de la sesión: cualquier aviso ya generado
  // (esta sesión o una anterior — viene del historial, que persiste en la
  // base) se puede publicar, no solo el que se acaba de generar.
  async function publicarAviso(id) {
    if (id == null) return;
    if (!(await confirmar({ titulo: "¿Publicar en el mapa público?", texto: "El mapa público pasará a mostrar este aviso en lugar del anterior.", confirmar: "Publicar" }))) return;
    setPublicando(id); setError(""); setMensaje("");
    try {
      const nuevo = await api.publicarAvisoCortoPlazo(id);
      setPublicado(nuevo);
      setMensaje("Publicado. El mapa público ya muestra este aviso.");
    } catch (e) { setError(e.message); }
    finally { setPublicando(null); }
  }

  const hayCambiosSinPublicar = !!historial?.length && historial[0].id != null && historial[0].id !== publicado?.id;

  return (
    <div className="admin-layout risk-layout meteo-layout">
      <BrandHeader subtitulo="Avisos a muy corto plazo"><Link to="/panel/mapas" className="btn-link">← Panel</Link></BrandHeader>
      <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
        <div className="editor-heading">
          <h1>Avisos a muy corto plazo</h1>
          <p>Dibujá en el mapa la zona afectada, sobre los límites municipales, y escribí el aviso. El mapa con el polígono queda en la placa, arriba del texto.</p>
        </div>
        <PublicationStatus changed={hayCambiosSinPublicar} published={publicado}>
          {publicado ? `«${publicado.titulo}»` : null}
        </PublicationStatus>
        {error && <div className="risk-message risk-message--error" role="alert">{error}</div>}
        <button type="button" className="btn btn--block btn--primary asistente-cta" onClick={crearPlaca}>Crear placa</button>
        <p className="admin-panel__hint">Dibujá la zona afectada en el mapa y tocá «Crear placa»: te guío paso a paso, con vista previa antes de generarla.</p>

        {historial && historial.length > 0 && (
          <details className="avisos-historial" open={historialAbierto} onToggle={(e) => setHistorialAbierto(e.target.open)}>
            <summary>Historial ({historial.length})</summary>
            <ul>
              {historial.map((h, i) => (
                <li key={h.id ?? i}>
                  <strong>{h.titulo}</strong> · {new Date(h.generadoEn).toLocaleString("es-AR")}
                  {h.generadoPorEmail && <> · {h.generadoPorEmail}</>}
                  <br /><a href={h.feedUrl} target="_blank" rel="noreferrer">feed</a> · <a href={h.historiasUrl} target="_blank" rel="noreferrer">historias</a>
                  <br />
                  <PublicarEnRedes feedUrl={h.feedUrl} historiasUrl={h.historiasUrl} epigrafe={`${h.titulo}\n\n${h.texto}`} />{" "}
                  {publicado?.id != null && publicado.id === h.id ? (
                    <span className="avisos-historial__publicado">Publicado en el mapa público</span>
                  ) : (
                    <button type="button" className="btn" disabled={h.id == null || publicando != null} title={h.id == null ? "Este aviso no se guardó en la base — no se puede publicar." : undefined} onClick={() => publicarAviso(h.id)}>
                      {publicando === h.id ? "Publicando…" : "Publicar en el mapa público"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
        <EmbedShare path="/embed/avisos-corto-plazo" title="Aviso a muy corto plazo · Misiones" />
      </section>
      <PlacaPreview vista={vista} onVista={setVista} titulo="aviso a muy corto plazo" imagenes={undefined} recomendaciones={imagenes} labelRecomendaciones="Placa generada" epigrafe={`${titulo}\n\n${texto}`}>
        <PolygonDrawMap ref={mapaRef} puntos={puntos} onChange={cambiarPuntos} municipios={municipios} />
      </PlacaPreview>
    </div>
  );
}
