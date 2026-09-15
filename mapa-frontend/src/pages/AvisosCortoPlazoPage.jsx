import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import PlacaPreview from "../components/PlacaPreview";
import PolygonDrawMap from "../components/PolygonDrawMap";
import * as api from "../api";

const EMOJIS = [["⚠️", "Advertencia"], ["⛈️", "Tormenta"], ["🌧️", "Lluvia"], ["💨", "Viento"], ["🏠", "Casa"], ["🚫", "Prohibido"], ["✅", "Recomendación"], ["📞", "Teléfono"]];

export default function AvisosCortoPlazoPage() {
  const [puntos, setPuntos] = useState([]);
  const [titulo, setTitulo] = useState("Aviso a muy corto plazo");
  const [texto, setTexto] = useState("");
  const [fondo, setFondo] = useState("tormenta");
  const [imagenes, setImagenes] = useState(null);
  const [vista, setVista] = useState("mapa");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historial, setHistorial] = useState(null);
  const textoRef = useRef(null);

  useEffect(() => {
    api.getAvisosCortoPlazoHistorial().then((r) => setHistorial(r.historial)).catch(() => setHistorial([]));
  }, []);

  function cambiarPuntos(nuevos) { setPuntos(nuevos); setImagenes(null); }

  async function generar() {
    setBusy(true); setError("");
    try {
      const placa = await api.generarAvisoCortoPlazo({ poligono: puntos, titulo, texto, fondo });
      setImagenes({ feed: placa.feedUrl, historias: placa.historiasUrl, feedNombre: placa.feedNombre, historiasNombre: placa.historiasNombre });
      setVista("recomendaciones");
      setHistorial((h) => [{ ...placa, poligono: puntos, titulo, texto, fondo }, ...(h || [])]);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function insertarIcono(icono) {
    const campo = textoRef.current, inicio = campo?.selectionStart ?? texto.length, fin = campo?.selectionEnd ?? inicio;
    const nuevo = texto.slice(0, inicio) + icono + texto.slice(fin);
    if (nuevo.length > 2400) return;
    setTexto(nuevo); setImagenes(null);
    requestAnimationFrame(() => { campo?.focus(); campo?.setSelectionRange(inicio + icono.length, inicio + icono.length); });
  }

  const puedeGenerar = puntos.length >= 3 && texto.trim() && titulo.trim();

  return (
    <div className="admin-layout risk-layout meteo-layout">
      <BrandHeader subtitulo="Avisos a muy corto plazo"><Link to="/panel/mapas" className="btn-link">← Panel</Link></BrandHeader>
      <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
        <div className="editor-heading">
          <h1>Avisos a muy corto plazo</h1>
          <p>Dibujá en el mapa la zona afectada (es sólo de referencia, no se publica) y escribí el aviso. Se genera una placa de texto libre para redes, igual que las recomendaciones de alertas meteorológicas.</p>
        </div>
        {error && <div className="risk-message risk-message--error" role="alert">{error}</div>}
        <label className="field"><span>Título de la placa</span><input value={titulo} maxLength={60} disabled={busy} onChange={(e) => { setTitulo(e.target.value); setImagenes(null); }} /></label>
        <label className="field"><span>Fondo</span><select value={fondo} disabled={busy} onChange={(e) => { setFondo(e.target.value); setImagenes(null); }}><option value="tormenta">Tormenta</option><option value="nubes">Nubes</option></select></label>
        <label className="field"><span>Texto del aviso</span><textarea ref={textoRef} value={texto} rows={10} maxLength={2400} disabled={busy} placeholder="Escribí acá el aviso a muy corto plazo…" onChange={(e) => { setTexto(e.target.value); setImagenes(null); }} /></label>
        <div className="meteo-emojis" role="group" aria-label="Insertar icono en el texto">
          {EMOJIS.map(([icono, nombre]) => <button key={nombre} type="button" className="btn" aria-label={`Insertar ${nombre}`} title={nombre} disabled={busy} onClick={() => insertarIcono(icono)}>{icono}</button>)}
        </div>
        <p className="meteo-count">{texto.length}/2400 caracteres</p>
        <button type="button" className="btn btn--block btn--primary" disabled={busy || !puedeGenerar} onClick={generar}>
          {busy ? "Procesando…" : puntos.length < 3 ? "Dibujá al menos 3 puntos en el mapa" : "Generar placa para redes"}
        </button>

        {historial && historial.length > 0 && (
          <details className="avisos-historial">
            <summary>Historial ({historial.length})</summary>
            <ul>
              {historial.map((h, i) => (
                <li key={h.id ?? i}>
                  <strong>{h.titulo}</strong> · {new Date(h.generadoEn).toLocaleString("es-AR")}
                  {h.generadoPorEmail && <> · {h.generadoPorEmail}</>}
                  <br /><a href={h.feedUrl} target="_blank" rel="noreferrer">feed</a> · <a href={h.historiasUrl} target="_blank" rel="noreferrer">historias</a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <PlacaPreview vista={vista} onVista={setVista} titulo="aviso a muy corto plazo" imagenes={undefined} recomendaciones={imagenes} labelRecomendaciones="Placa generada">
        <PolygonDrawMap puntos={puntos} onChange={cambiarPuntos} />
      </PlacaPreview>
    </div>
  );
}
