import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PointsMap from "../components/PointsMap";
import EmbedShare from "../components/EmbedShare";
import BrandHeader from "../components/BrandHeader";
import {
  recuperarAlertasIncendio,
  publicarAlertasIncendio,
  getAlertasIncendioActual,
} from "../api";
import { DATOS_DEMO_ALERTAS, extraerFocos, focosAGeojson } from "../lib/alertasIncendio";
import { tiempoRelativo, fechaLarga } from "../lib/tiempoRelativo";

function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AlertasIncendiosPage() {
  const [actual, setActual] = useState(null); // { recuperadoEn, datos }
  const [cargando, setCargando] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [error, setError] = useState(null);
  const mapaRef = useRef(null);

  useEffect(() => {
    let cancelado = false;
    getAlertasIncendioActual().then((actualData) => {
      if (cancelado) return;
      setActual(actualData);
    }).catch(() => {});
    // El webhook puede recibir una tanda mientras el panel está abierto.
    const timer = setInterval(() => getAlertasIncendioActual().then(data => {
      if (!cancelado) setActual(data);
    }).catch(() => {}), 60000);
    return () => { cancelado = true; clearInterval(timer); };
  }, []);

  const focos = useMemo(() => extraerFocos(actual?.datos || DATOS_DEMO_ALERTAS), [actual?.datos]);
  const puntos = useMemo(() => focosAGeojson(focos), [focos]);

  async function onRecuperar() {
    setCargando(true);
    setError(null);
    try {
      const payload = await recuperarAlertasIncendio();
      setActual(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function onCapturar() {
    if (!mapaRef.current) return;
    setError(null);
    try {
      const dataUrl = await mapaRef.current.capturePng();
      if (!dataUrl) throw new Error("El mapa todavía no está listo");
      const blob = await (await fetch(dataUrl)).blob();
      descargarBlob(blob, `alertas_incendio_${Date.now()}.png`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onPublicar() {
    const datos = actual?.datos || DATOS_DEMO_ALERTAS;
    setPublicando(true); setError(null);
    try { setActual(await publicarAlertasIncendio(datos)); }
    catch (err) { setError(err.message); }
    finally { setPublicando(false); }
  }

  const relativo = tiempoRelativo(actual?.recuperadoEn);

  return (
    <div className="admin-layout">
      <BrandHeader subtitulo="Alertas de incendios · NASA FIRMS">
        <Link to="/panel/mapas" className="btn-link">
          ← Panel
        </Link>
      </BrandHeader>

      <div className="admin-panel" id="contenido-principal" tabIndex={-1}>
        <div className="editor-heading"><span className="editor-eyebrow">FOCOS SATELITALES · NASA FIRMS</span><h1>Alertas de incendios</h1><p>Recuperá las últimas alertas y revisá los focos en el mapa.</p></div>
        {!actual && <p className="alertas-demo-aviso" role="status">Vista de prueba: esperando el primer JSON real.</p>}
        <h2>1 · Recuperar</h2>
        <p className="admin-panel__hint">
          Recuperar las alertas actualiza el mapa público. Esta tanda permanece
          visible hasta la próxima actualización.
        </p>

        {error && <div className="alert alert--error">{error}</div>}

        <div className="admin-actions">
          <button
            className="btn btn--primary btn--block"
            onClick={onRecuperar}
            disabled={cargando}
          >
            {cargando ? "Recuperando…" : "Recuperar últimas alertas"}
          </button>
        </div>
        <div className="admin-actions">
          <button className="btn btn--primary btn--block" onClick={onPublicar} disabled={publicando}>
            {publicando ? "Publicando…" : "Publicar alertas"}
          </button>
        </div>

        {actual && (
          <>
            <h2 style={{ marginTop: 22 }}>2 · Estado</h2>
            <p className="admin-panel__hint">
              Recuperado <b>{relativo}</b> · {fechaLarga(actual.recuperadoEn)}
              <br />
              {focos.length} foco(s) con coordenadas reconocidas.
            </p>

            <div className="admin-actions">
              <button className="btn btn--block" onClick={onCapturar} disabled={cargando}>
                Capturar el mapa como se ve acá
              </button>
              <button className="btn btn--block" disabled title="Pendiente: generador de imagen en el servidor">
                Imagen para redes (servidor) — pendiente
              </button>
            </div>
          </>
        )}
        <EmbedShare path="/embed/alertas-incendios" title="Alertas de incendios de Misiones" />
      </div>

      <div className="admin-map-area">
        <PointsMap
          ref={mapaRef}
          puntos={puntos}
          titulo="Alertas de incendios"
          enableCapture
        />
      </div>
    </div>
  );
}
