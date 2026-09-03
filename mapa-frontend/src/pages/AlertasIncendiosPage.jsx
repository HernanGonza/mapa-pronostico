import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PointsMap from "../components/PointsMap";
import BrandHeader from "../components/BrandHeader";
import {
  recuperarAlertasIncendio,
  getAlertasIncendioActual,
  getMundoGeojson,
  getGeo,
} from "../api";
import { extraerFocos, focosAGeojson } from "../lib/alertasIncendio";
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
  const [mundo, setMundo] = useState(null);
  const [paisesLabels, setPaisesLabels] = useState(null);
  const [provincias, setProvincias] = useState(null);
  const [provinciasLabels, setProvinciasLabels] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const mapaRef = useRef(null);

  useEffect(() => {
    getMundoGeojson().then(setMundo).catch(() => {});
    getGeo("paises-labels").then(setPaisesLabels).catch(() => {});
    getGeo("provincias").then(setProvincias).catch(() => {});
    getGeo("provincias-labels").then(setProvinciasLabels).catch(() => {});
    getAlertasIncendioActual().then(setActual).catch(() => {});
  }, []);

  const focos = actual ? extraerFocos(actual.datos) : [];

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
      const dataUrl = mapaRef.current.capturePng();
      if (!dataUrl) throw new Error("El mapa todavía no está listo");
      const blob = await (await fetch(dataUrl)).blob();
      descargarBlob(blob, `alertas_incendio_${Date.now()}.png`);
    } catch (err) {
      setError(err.message);
    }
  }

  const relativo = tiempoRelativo(actual?.recuperadoEn);

  return (
    <div className="admin-layout">
      <BrandHeader subtitulo="Alertas de incendios · NASA FIRMS">
        <Link to="/panel" className="btn-link">
          ← Volver a la botonera
        </Link>
      </BrandHeader>

      <div className="admin-panel">
        <h2>1 · Recuperar</h2>
        <p className="admin-panel__hint">
          Le pide al sistema de alertas el último JSON de focos y lo publica:
          /embed/alertas-incendios va a mostrar esta tanda hasta la próxima vez
          que se apriete este botón.
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
      </div>

      <div className="admin-map-area">
        <PointsMap
          ref={mapaRef}
          mundoGeojson={mundo}
          paisesLabels={paisesLabels}
          provincias={provincias}
          provinciasLabels={provinciasLabels}
          puntos={focosAGeojson(focos)}
          titulo="Alertas de incendios"
          enableCapture
        />
      </div>
    </div>
  );
}
