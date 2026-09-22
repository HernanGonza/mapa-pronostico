import PublicationStatus from "../components/PublicationStatus";
import { useNotificacion } from "../lib/useNotificacion";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import EmbedShare from "../components/EmbedShare";
import BrandHeader from "../components/BrandHeader";
import PlacaPreview from "../components/PlacaPreview";
import { editarNivelesRiesgo, crearPlacaRiesgo, publicarRiesgoPorPasos } from "../lib/asistentesRiesgo";
import RiesgoMap from "../components/RiesgoMap";
import { getRiesgoCatalogo, getDepartamentosGeojson, getRiesgoActual, getRiesgoAutomatico, publicarRiesgo, generarRiesgoPlaca } from "../api";

export default function RiesgoIncendiosPage() {
  const [catalogo, setCatalogo] = useState(null);
  const [geo, setGeo] = useState(null);
  const [zonas, setZonas] = useState([]);
  const [publicado, setPublicado] = useState(null);
  const [automatico, setAutomatico] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  useNotificacion(mensaje);
  const [ocupado, setOcupado] = useState(false);
  const [intento, setIntento] = useState(0);
  const [imagenes, setImagenes] = useState(null);
  const [vista, setVista] = useState("mapa");
  const mapaRef = useRef(null);
  const [fecha, setFecha] = useState(() => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date()));
  useEffect(() => { setImagenes(null); }, [zonas, fecha]);
  useEffect(() => {
    let cancelado = false;
    setError("");
    Promise.all([getRiesgoCatalogo(), getDepartamentosGeojson(), getRiesgoActual(), getRiesgoAutomatico().catch(() => null)])
      .then(([cat, geometria, actual, calculado]) => {
        if (cancelado) return;
        setCatalogo(cat); setGeo(geometria); setPublicado(actual); setAutomatico(calculado);
        // El borrador arranca con la sugerencia del cálculo automático (índice
        // FWI, ver riesgoIncendiosIndiceService.js) y si no hay, con lo ya
        // publicado — pero sigue siendo sólo eso, una sugerencia: "Editar
        // niveles" permite corregir cualquier departamento a mano, y nada se
        // publica solo (ver "Revisar y publicar").
        const categoriaDe = (id) =>
          calculado?.zonas.find(z => String(z.id) === String(id))?.categoria ||
          actual?.zonas.find(z => String(z.id) === String(id))?.categoria || "";
        setZonas(cat.departamentos.map(d => ({ id: d.id, categoria: categoriaDe(d.id) })));
      }).catch(e => { if (!cancelado) setError(e.message); });
    return () => { cancelado = true; };
  }, [intento]);
  const completos = zonas.filter(z => z.categoria).length;
  const cambios = zonas.filter(z => z.categoria !== (publicado?.zonas.find(p => String(p.id) === String(z.id))?.categoria || ""));
  const sucio = cambios.length > 0;
  useEffect(() => {
    if (!sucio) return;
    const aviso = e => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sucio]);
  async function guardar() {
    const nuevo = await publicarRiesgo(zonas);
    setPublicado(nuevo); setZonas(nuevo.zonas);
  }
  const nombreDe = (id) => catalogo?.departamentos.find(d => String(d.id) === String(id))?.nombre || String(id);
  const detalleCambios = cambios.map(z => ({ nombre: nombreDe(z.id), antes: publicado?.zonas.find(p => String(p.id) === String(z.id))?.categoria || "Sin asignar", despues: z.categoria }));
  const editarNiveles = () => editarNivelesRiesgo({ catalogo, zonas, aplicar: setZonas });
  const crearPlaca = () => crearPlacaRiesgo({
    catalogo, zonas, fecha,
    vistaPrevia: (zs, f) => generarRiesgoPlaca(zs, f, { vistaPrevia: true }),
    guardar: async (zs, f, token) => {
      const placa = await generarRiesgoPlaca(zs, f, { confirmarToken: token });
      setZonas(zs); setFecha(f);
      setImagenes({ feed: placa.feedUrl, historias: placa.historiasUrl, feedNombre: placa.feedNombre, historiasNombre: placa.historiasNombre });
      setVista("placa");
      return placa;
    },
  });
  const revisarYPublicar = () => publicarRiesgoPorPasos({ cambios: detalleCambios, sinPublicar: !publicado, publicar: async () => { await guardar(); setMensaje("Publicado. El mapa público ya muestra estas categorías."); } });
  async function exportar() {
    setOcupado(true); setError("");
    try {
      const url = await mapaRef.current?.capturarConOverlay();
      if (!url) throw new Error("El mapa todavía no está listo.");
      const a = document.createElement("a"); a.href = url;
      a.download = `riesgo-incendios-${sucio || !publicado ? "borrador-" : ""}${new Date().toISOString().slice(0, 10)}.png`; a.click();
      setMensaje("Captura del mapa descargada.");
    } catch (e) { setError(e.message); }
    finally { setOcupado(false); }
  }
  return <div className="admin-layout risk-layout">
    <BrandHeader subtitulo="Riesgo de incendios forestales"><Link to="/panel/mapas" className="btn-link">← Panel</Link></BrandHeader>
    <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading"><h1>Riesgo de incendios</h1>
        <p>Elegí el nivel de cada zona. Los cambios se ven en el mapa antes de publicar.</p></div>
      {error && <div className="risk-message risk-message--error" role="alert">{error}{!catalogo && <button className="btn" onClick={() => setIntento(i => i + 1)}>Reintentar</button>}</div>}
      {!catalogo ? <p>Cargando departamentos…</p> : <>
        {automatico
          ? <p className="admin-panel__hint">Niveles sugeridos automáticamente el {new Date(automatico.fecha).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit" })} a partir del índice de riesgo de incendios (FWI) — revisalos en «Editar niveles» antes de publicar.</p>
          : <p className="admin-panel__hint">Todavía no hay un cálculo automático disponible: elegí los niveles a mano en «Editar niveles».</p>}
        <PublicationStatus changed={sucio} published={publicado}>{completos} / {zonas.length} departamentos</PublicationStatus>
        <div className="admin-acciones">
          <button className="btn btn--primary btn--block" disabled={ocupado} onClick={editarNiveles}>Editar niveles</button>
          <button className="btn btn--block" disabled={ocupado} onClick={crearPlaca}>Crear placa para redes</button>
          <button className="btn btn--block" disabled={ocupado || completos !== zonas.length || !sucio} onClick={revisarYPublicar}>Revisar y publicar</button>
          <button className="btn btn--ghost btn--block" disabled={ocupado || completos !== zonas.length} onClick={exportar}>{ocupado ? "Procesando…" : "Capturar mapa actual"}</button>
        </div>
        <p className="admin-panel__hint">{sucio ? "Hay cambios sin publicar: el mapa de la derecha muestra el borrador." : "El mapa de la derecha coincide con lo publicado."}</p>
      </>}
        <EmbedShare path="/embed/riesgo-incendios" title="Riesgo de incendios forestales de Misiones" />
    </section>
    <PlacaPreview imagenes={imagenes} vista={vista} onVista={setVista} titulo="riesgo de incendios">{geo && catalogo ? <RiesgoMap ref={mapaRef} geo={geo} zonas={zonas} catalogo={catalogo} publicadoEn={sucio ? null : publicado?.publicadoEn} enableCapture /> : <div className="admin-map-area__vacio">Preparando mapa de Misiones…</div>}</PlacaPreview>
  </div>;
}
