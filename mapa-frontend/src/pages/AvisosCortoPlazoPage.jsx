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
import { crearAvisoPorPasos, TITULO } from "../lib/asistenteAviso";

const COLOR_ACP = "#8b3fc4"; // mismo violeta que "Alertas automáticas (SMN)" para avisos ACP.

/** Avisos ACP vigentes del RSS/CAP del SMN, uno por cada zona con polígono
 * (a veces hay más de uno al mismo tiempo — el asistente deja elegir cuál). */
function avisosAcpDe(data) {
  if (!data) return [];
  const candidatos = [];
  for (const fuente of Object.values(data.fuentes || {})) {
    for (const alerta of fuente.alertas || []) {
      if (alerta.fuente !== "ACP") continue;
      alerta.infos.forEach((info, i) => {
        if (Date.parse(info.fin) <= Date.now()) return;
        info.zonas.forEach((zona, j) => {
          if (!zona.geometry) return;
          candidatos.push({
            id: `${alerta.id}:${i}:${j}`,
            titulo: info.titulo,
            zona: zona.nombre,
            fin: info.fin,
            poligono: zona.geometry.coordinates[0].slice(0, -1),
            texto: [info.descripcion, info.instrucciones].filter(Boolean).join("\n\n"),
          });
        });
      });
    }
  }
  return candidatos;
}

export default function AvisosCortoPlazoPage() {
  const [puntos, setPuntos] = useState([]);
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
  const [avisosAcp, setAvisosAcp] = useState([]);
  const [publicando, setPublicando] = useState(null); // id del aviso que se está publicando
  const [publicado, setPublicado] = useState(null); // último aviso publicado (mapa público)
  const mapaRef = useRef(null);

  useEffect(() => {
    api.getAvisosCortoPlazoHistorial().then((r) => setHistorial(r.historial)).catch(() => setHistorial([]));
    api.getMunicipiosGeojson().then(setMunicipios).catch(() => {});
    api.getAvisoCortoPlazoActual().then(setPublicado).catch(() => setPublicado(null));
  }, []);

  // Lista de avisos ACP vigentes: se refresca sola cada 60s (mismo intervalo
  // que "Alertas automáticas") para que "Crear placa" siempre ofrezca lo
  // último que llegó por RSS, sin depender de que alguien recargue la página.
  useEffect(() => {
    let cancelado = false;
    async function refrescar() {
      try { const data = await api.getSmnAlertas(); if (!cancelado) setAvisosAcp(avisosAcpDe(data)); }
      catch { /* deja la lista anterior */ }
    }
    refrescar();
    const timer = setInterval(refrescar, 60000);
    return () => { cancelado = true; clearInterval(timer); };
  }, []);

  function cambiarPuntos(nuevos) { setPuntos(nuevos); setImagenes(null); }

  // La vista previa NO guarda nada; recién al confirmar en el asistente se guarda (la misma imagen).
  const vistaPrevia = (valores) => api.generarAvisoCortoPlazo({ ...valores, imagen: mapaRef.current?.capturePng() || null, vistaPrevia: true });
  async function guardarPlaca(valores, token) {
    const placa = await api.generarAvisoCortoPlazo({ ...valores, confirmarToken: token });
    setPuntos(valores.poligono); setTexto(valores.texto); setFondo(valores.fondo);
    setImagenes({ feed: placa.feedUrl, historias: placa.historiasUrl, feedNombre: placa.feedNombre, historiasNombre: placa.historiasNombre });
    setVista("recomendaciones");
    setHistorial((h) => [{ ...placa, ...valores }, ...(h || [])]);
    setHistorialAbierto(true);
    return placa;
  }

  async function crearPlaca() {
    if (avisosAcp.length === 0 && puntos.length < 3) {
      notificar("error", "Todavía no hay avisos del SMN vigentes: dibujá la zona afectada en el mapa (al menos 3 puntos).");
      return;
    }
    setError(""); setMensaje("");
    await crearAvisoPorPasos({ inicial: { texto, fondo }, avisos: avisosAcp, puntosDibujados: puntos, onSeleccionarPoligono: cambiarPuntos, vistaPrevia, guardar: guardarPlaca });
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
          <p>Tocá «Crear placa» y elegí el aviso vigente del SMN: el polígono y el texto se completan solos. Si el SMN no trajo polígono, dibujalo a mano sobre los límites municipales.</p>
        </div>
        <PublicationStatus changed={hayCambiosSinPublicar} published={publicado}>
          {publicado ? `«${publicado.titulo}»` : null}
        </PublicationStatus>
        {error && <div className="risk-message risk-message--error" role="alert">{error}</div>}
        <button type="button" className="btn btn--block btn--primary asistente-cta" onClick={crearPlaca}>Crear placa</button>
        <p className="admin-panel__hint">
          {avisosAcp.length > 0
            ? `${avisosAcp.length} aviso(s) del SMN vigente(s) — tocá «Crear placa» para elegir cuál.`
            : "Sin avisos del SMN vigentes por ahora: dibujá la zona afectada en el mapa y tocá «Crear placa»."}
        </p>

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
      <PlacaPreview vista={vista} onVista={setVista} titulo="aviso a muy corto plazo" imagenes={undefined} recomendaciones={imagenes} labelRecomendaciones="Placa generada" epigrafe={`${TITULO}\n\n${texto}`}>
        <PolygonDrawMap ref={mapaRef} puntos={puntos} onChange={cambiarPuntos} municipios={municipios} colorPoligono={COLOR_ACP} />
      </PlacaPreview>
    </div>
  );
}
