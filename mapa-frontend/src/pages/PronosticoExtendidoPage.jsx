import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import EmbedShare from "../components/EmbedShare";
import PublicationStatus from "../components/PublicationStatus";
import { publicarExtendidoPorPasos } from "../lib/asistentesPronostico";
import { useNotificacion } from "../lib/useNotificacion";
import PronosticoExtendidoView from "../components/PronosticoExtendidoView";
import PronosticoExtendidoEditor, { extendidoVacio, hayInvalidosExtendido } from "../components/PronosticoExtendidoEditor";
import { getActual, publicar } from "../api";

export default function PronosticoExtendidoPage() {
  const [actual, setActual] = useState(null);
  const [extendido, setExtendido] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [mensajeOk, setMensajeOk] = useState(null);
  const [cargando, setCargando] = useState(true);
  const publicando = false;
  useNotificacion(mensajeOk);

  useEffect(() => {
    getActual()
      .then((data) => {
        setActual(data);
        setExtendido(data?.extendido || extendidoVacio());
        setDirty(false);
      })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, []);

  function onChangeExtendido(nuevo) {
    setExtendido(nuevo);
    setDirty(true);
    setMensajeOk(null);
  }

  async function publicarAhora() {
    setError(""); setMensajeOk(null);
    const payload = await publicar(actual.filas, actual.fechaPronostico, extendido);
    setActual(payload);
    setDirty(false);
    setMensajeOk("Publicado. El mapa público ya muestra esta versión.");
  }
  const revisarYPublicar = () => publicarExtendidoPorPasos({ publicar: publicarAhora });

  const invalido = extendido ? hayInvalidosExtendido(extendido) : true;

  return (
    <div className="admin-layout admin-layout--sin-mapa">
      <BrandHeader subtitulo="Pronóstico de 3 días">
        <Link to="/panel/pronostico" className="btn-link">Ir a Pronóstico</Link>
        <Link to="/panel/mapas" className="btn-link">← Panel</Link>
      </BrandHeader>
      <div className="admin-panel" id="contenido-principal" tabIndex={-1}>
        <div className="editor-heading">
          <h1>Pronóstico de 3 días</h1>
          <p>
            Se arma solo con el .docx que subís en <Link to="/panel/pronostico">Pronóstico</Link>, cuando trae la sección
            "Pronóstico extendido" — pero se puede corregir o completar acá antes de publicar. Es por zona (Sur/Centro/Norte), no por localidad.
          </p>
        </div>
        {error && <div className="alert alert--error" role="alert">{error}</div>}
        {cargando ? (
          <p>Cargando…</p>
        ) : !actual ? (
          <p className="admin-panel__hint">
            Todavía no se publicó ningún pronóstico. Subí y publicá un .docx primero en{" "}
            <Link to="/panel/pronostico">Pronóstico</Link> — el de 3 días se publica junto a ese.
          </p>
        ) : (
          <>
            <PublicationStatus changed={dirty} published={actual} />
            <PronosticoExtendidoEditor extendido={extendido} onChange={onChangeExtendido} disabled={publicando} />

            {invalido && (
              <div className="alert alert--warn">
                Hay temperaturas fuera de rango, mínimas mayores que máximas, condiciones sin reconocer o días sin nombre. Corregilos para poder publicar.
              </div>
            )}

            <div className="admin-acciones">
              <button type="button" className="btn btn--primary btn--block" disabled={publicando || invalido || !dirty} onClick={revisarYPublicar}>Revisar y publicar</button>
            </div>

            <h2 style={{ marginTop: 22 }}>Vista previa</h2>
            <PronosticoExtendidoView extendido={extendido} publicadoEn={dirty ? null : actual?.publicadoEn} />
          </>
        )}
        <EmbedShare path="/embed/pronostico-3-dias" title="Pronóstico de 3 días · Misiones" />
      </div>
    </div>
  );
}
