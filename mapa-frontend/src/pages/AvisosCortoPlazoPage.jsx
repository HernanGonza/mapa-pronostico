import { useEffect, useState } from "react";
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
import { crearAvisoPorPasos, publicarAvisoPorPasos, TITULO } from "../lib/asistenteAviso";

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
  const [municipios, setMunicipios] = useState(null);
  const [avisosAcp, setAvisosAcp] = useState([]);
  // Sólo lo que importa acá: los avisos vigentes en el mapa público y la placa
  // recién generada (sin publicar). El historial va a vivir en el histórico.
  const [vigentes, setVigentes] = useState(null);
  const [generada, setGenerada] = useState(null); // { ...placa, finSmn }
  const [despublicando, setDespublicando] = useState(null);

  const cargarVigentes = () => api.getAvisosCortoPlazoVigentes().then(setVigentes).catch((e) => { setVigentes([]); setError(e.message); });
  useEffect(() => {
    api.getMunicipiosGeojson().then(setMunicipios).catch(() => {});
    cargarVigentes();
    // Refresca para que un aviso que venció desaparezca de la lista solo.
    const timer = setInterval(cargarVigentes, 60000);
    return () => clearInterval(timer);
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

  // La vista previa NO guarda nada; recién al confirmar en el asistente se guarda la misma placa.
  const vistaPrevia = (valores) => api.generarAvisoCortoPlazo({ ...valores, vistaPrevia: true });
  async function guardarPlaca(valores, token, { finSmn }) {
    const placa = await api.generarAvisoCortoPlazo({ ...valores, confirmarToken: token });
    setPuntos(valores.poligono); setTexto(valores.texto); setFondo(valores.fondo);
    setImagenes({ feed: placa.feedUrl, historias: placa.historiasUrl, feedNombre: placa.feedNombre, historiasNombre: placa.historiasNombre });
    setVista("recomendaciones");
    setGenerada({ ...placa, ...valores, finSmn });
    return placa;
  }

  async function crearPlaca() {
    if (avisosAcp.length === 0 && puntos.length < 3) {
      notificar("error", "Todavía no hay avisos del SMN vigentes: dibujá la zona afectada en el mapa (al menos 3 puntos).");
      return;
    }
    setError(""); setMensaje("");
    // `poligono` va en el estado inicial (no sólo en el paso "elegir aviso"):
    // si no hay avisos del SMN vigentes, ese paso se salta entero y el único
    // origen del polígono es lo ya dibujado a mano en el mapa de la página.
    await crearAvisoPorPasos({ inicial: { texto, fondo, poligono: puntos }, avisos: avisosAcp, puntosDibujados: puntos, onSeleccionarPoligono: cambiarPuntos, publicados: vigentes || [], vistaPrevia, guardar: guardarPlaca, publicar: (placa, finSmn) => abrirPublicar(placa, { finSmn }) });
  }

  // Publicar (o cambiarle la vigencia a uno ya publicado) es un asistente con el paso de vigencia.
  function abrirPublicar(aviso, { finSmn = null, vigenteHasta = null } = {}) {
    setError(""); setMensaje("");
    return publicarAvisoPorPasos({
      aviso, finSmn, vigenteHasta,
      publicar: async (id, hasta) => { const r = await api.publicarAvisoCortoPlazo(id, hasta); await cargarVigentes(); return r; },
    });
  }

  async function despublicar(aviso) {
    if (!(await confirmar({ titulo: "¿Sacar el aviso del mapa público?", texto: "Deja de mostrarse ahora, sin esperar a que venza.", confirmar: "Despublicar" }))) return;
    setDespublicando(aviso.id); setError("");
    try { await api.despublicarAvisoCortoPlazo(aviso.id); await cargarVigentes(); setMensaje("Listo: el aviso ya no se muestra en el mapa público."); }
    catch (e) { setError(e.message); }
    finally { setDespublicando(null); }
  }

  const hora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const generadaSinPublicar = generada?.id != null && !vigentes?.some((v) => v.id === generada.id);

  return (
    <div className="admin-layout risk-layout meteo-layout">
      <BrandHeader subtitulo="Avisos a muy corto plazo"><Link to="/panel/mapas" className="btn-link">← Panel</Link></BrandHeader>
      <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
        <div className="editor-heading">
          <h1>Avisos a muy corto plazo</h1>
          <p>Tocá «Crear placa» y elegí el aviso vigente del SMN: el polígono y el texto se completan solos. Si el SMN no trajo polígono, dibujalo a mano sobre los límites municipales.</p>
        </div>
        <PublicationStatus changed={generadaSinPublicar} published={vigentes?.length > 0}>
          {vigentes === null ? null : vigentes.length ? `${vigentes.length} aviso${vigentes.length === 1 ? "" : "s"} vigente${vigentes.length === 1 ? "" : "s"}` : "Sin avisos vigentes en el mapa público"}
        </PublicationStatus>
        {error && <div className="risk-message risk-message--error" role="alert">{error}</div>}
        <button type="button" className="btn btn--block btn--primary asistente-cta" onClick={crearPlaca}>Crear placa</button>
        <p className="admin-panel__hint">
          {avisosAcp.length > 0
            ? `${avisosAcp.length} aviso(s) del SMN vigente(s) — tocá «Crear placa» para elegir cuál.`
            : "Sin avisos del SMN vigentes por ahora: dibujá la zona afectada en el mapa y tocá «Crear placa»."}
        </p>

        {generadaSinPublicar && (
          <div className="avisos-lista avisos-lista--pendiente">
            <h2>Placa generada, sin publicar</h2>
            <p className="avisos-lista__texto">{generada.texto}</p>
            <button type="button" className="btn btn--primary" onClick={() => abrirPublicar(generada, { finSmn: generada.finSmn })}>Publicar en el mapa público</button>
          </div>
        )}

        {vigentes?.length > 0 && (
          <div className="avisos-lista">
            <h2>Vigentes en el mapa público</h2>
            <ul>
              {vigentes.map((a) => (
                <li key={a.id}>
                  <strong>Hasta el {hora(a.vigenteHasta)}</strong>
                  <p className="avisos-lista__texto">{a.texto}</p>
                  <small>Publicado el {hora(a.publicadoEn)}{a.generadoPorEmail && <> · {a.generadoPorEmail}</>} · <a href={a.feedUrl} target="_blank" rel="noreferrer">feed</a> · <a href={a.historiasUrl} target="_blank" rel="noreferrer">historias</a></small>
                  <div className="avisos-lista__acciones">
                    <button type="button" className="btn" onClick={() => abrirPublicar(a, { vigenteHasta: a.vigenteHasta })}>Cambiar vigencia</button>
                    <PublicarEnRedes feedUrl={a.feedUrl} historiasUrl={a.historiasUrl} epigrafe={`${a.titulo}\n\n${a.texto}`} />
                    <button type="button" className="btn btn--ghost" disabled={despublicando != null} onClick={() => despublicar(a)}>{despublicando === a.id ? "Despublicando…" : "Despublicar"}</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <EmbedShare path="/embed/avisos-corto-plazo" title="Aviso a muy corto plazo · Misiones" />
      </section>
      <PlacaPreview vista={vista} onVista={setVista} titulo="aviso a muy corto plazo" imagenes={undefined} recomendaciones={imagenes} labelRecomendaciones="Placa generada" epigrafe={`${TITULO}\n\n${texto}`}>
        <PolygonDrawMap puntos={puntos} onChange={cambiarPuntos} municipios={municipios} colorPoligono={COLOR_ACP} />
      </PlacaPreview>
    </div>
  );
}
