import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import MonitorCuencas from "../components/MonitorCuencas";
import CuencasMap from "../components/CuencasMap";
import { getCuencas, actualizarCuencas } from "../api";
import { tiempoRelativo } from "../lib/tiempoRelativo";

export default function CuencasPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy) return; busy = true;
      try { const next = await getCuencas(); if (!controller.signal.aborted) { setData(next); setError(""); } }
      catch (e) { if (!controller.signal.aborted) setError(e.message); }
      finally { busy = false; }
    }
    refresh();
    const timer = setInterval(refresh, 5 * 60 * 1000);
    return () => { clearInterval(timer); controller.abort(); };
  }, []);

  async function consultarAhora() {
    if (updating) return;
    setUpdating(true); setError("");
    try { setData(await actualizarCuencas()); }
    catch (e) { setError(e.message); }
    finally { setUpdating(false); }
  }

  return <div className="admin-layout">
    <BrandHeader subtitulo="Monitor de cuencas">
      <Link to="/panel/mapas" className="btn-link">← Panel</Link>
    </BrandHeader>
    <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading">
        <span className="editor-eyebrow">SIG Misiones · sig.misiones.gob.ar</span>
        <h1>Monitor de cuencas</h1>
        <p>Defluente de las represas de Itaipú, Salto Caxias, Foz do Chapecó y Capanema, y altura de los ríos Paraná, Uruguay e Iguazú. Re-servido desde el Monitor Hidrológico de Misiones (no publica en nuestro mapa público).</p>
      </div>
      <p className="admin-panel__hint">
        {data ? `Última consulta ${data.consultadoEn ? tiempoRelativo(data.consultadoEn) : "sin datos aún"}` : "Consultando…"}
      </p>
      {(error || data?.error) && <div className="alert alert--error" role="alert">{error || data.error}</div>}
      {!error && !data?.error && data?.desactualizado && <div className="alert alert--warn" role="status">Actualización pendiente. Se muestran los últimos datos disponibles.</div>}
      <div className="admin-actions">
        <button className="btn btn--block" type="button" onClick={consultarAhora} disabled={updating}>{updating ? "Consultando…" : "Consultar ahora"}</button>
      </div>
      <MonitorCuencas tarjetas={data?.tarjetas} />
      <p className="admin-panel__hint">Tocá una tarjeta para abrir el Monitor Hidrológico oficial en una pestaña nueva.</p>
    </section>
    <div className="admin-map-area">
      {data?.puertos ? <CuencasMap represas={data.represas} puertos={data.puertos} titulo="Monitor de cuencas" />
        : <div className="admin-map-area__vacio">{error || "Preparando mapa…"}</div>}
    </div>
  </div>;
}
