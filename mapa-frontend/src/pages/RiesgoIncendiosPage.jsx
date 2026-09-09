import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import EmbedShare from "../components/EmbedShare";
import BrandHeader from "../components/BrandHeader";
import RiesgoMap from "../components/RiesgoMap";
import { getRiesgoCatalogo, getDepartamentosGeojson, getRiesgoActual, publicarRiesgo, renderRiesgoPng } from "../api";

export default function RiesgoIncendiosPage() {
  const [catalogo, setCatalogo] = useState(null);
  const [geo, setGeo] = useState(null);
  const [zonas, setZonas] = useState([]);
  const [publicado, setPublicado] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [intento, setIntento] = useState(0);
  const mapaRef = useRef(null);
  const [fecha, setFecha] = useState(() => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date()));
  async function exportarInstitucional() {
    setOcupado(true); setError("");
    try {
      const blob = await renderRiesgoPng(zonas, fecha);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `riesgo-incendios-${fecha}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMensaje("Imagen institucional descargada.");
    } catch (e) { setError(e.message); }
    finally { setOcupado(false); }
  }
  useEffect(() => {
    let cancelado = false;
    setError("");
    Promise.all([getRiesgoCatalogo(), getDepartamentosGeojson(), getRiesgoActual()])
      .then(([cat, geometria, actual]) => {
        if (cancelado) return;
        setCatalogo(cat); setGeo(geometria); setPublicado(actual);
        setZonas(cat.departamentos.map(d => ({ id: d.id, categoria: actual?.zonas.find(z => String(z.id) === String(d.id))?.categoria || "" })));
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
  function cambiar(id, categoria) {
    setZonas(prev => prev.map(z => z.id === id ? { ...z, categoria } : z));
    setConfirmando(false); setMensaje("");
  }
  async function guardar() {
    setOcupado(true); setError("");
    try {
      const nuevo = await publicarRiesgo(zonas);
      setPublicado(nuevo); setZonas(nuevo.zonas); setConfirmando(false);
      setMensaje("Publicado. El mapa público ya muestra estas categorías.");
    } catch (e) { setError(e.message); }
    finally { setOcupado(false); }
  }
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
    <BrandHeader subtitulo="Riesgo de incendios forestales"><Link to="/panel" className="btn-link">← Panel</Link></BrandHeader>
    <section className="admin-panel">
      <div className="editor-heading"><span className="editor-eyebrow">REPORTE POR DEPARTAMENTO</span><h1>Riesgo de incendios</h1>
        <p>Elegí el nivel de cada zona. Los cambios se ven en el mapa antes de publicar.</p></div>
      {error && <div className="risk-message risk-message--error" role="alert">{error}{!catalogo && <button className="btn" onClick={() => setIntento(i => i + 1)}>Reintentar</button>}</div>}
      {mensaje && <p className="risk-message" role="status">{mensaje}</p>}
      {!catalogo ? <p>Cargando departamentos…</p> : <>
        <div className="risk-progress"><strong>{completos} / {zonas.length} zonas</strong><span>{sucio ? "Cambios sin publicar" : publicado ? "Publicado" : "Sin publicar"}</span></div>
        <div className="risk-zones">{catalogo.departamentos.map(d => {
          const categoria = zonas.find(z => String(z.id) === String(d.id))?.categoria || "";
          const color = catalogo.categorias.find(c => c.nombre === categoria)?.color || "#d5dbd5";
          return <label className="risk-zone" key={d.id}><span><i style={{ background: color }} />{d.nombre}</span>
            <select aria-label={`Riesgo de ${d.nombre}`} value={categoria} disabled={ocupado} onChange={e => cambiar(d.id, e.target.value)}>
              <option value="">Elegir nivel…</option>{catalogo.categorias.map(c => <option key={c.nombre}>{c.nombre}</option>)}
            </select></label>;
        })}</div>
        {confirmando && <div className="risk-review"><h2>Revisar publicación</h2><p>Se actualizarán {cambios.length} departamentos en el mapa público.</p>
          <ul>{cambios.map(z => <li key={z.id}><b>{catalogo.departamentos.find(d => String(d.id) === String(z.id))?.nombre}</b>: {publicado?.zonas.find(p => String(p.id) === String(z.id))?.categoria || "Sin asignar"} → {z.categoria}</li>)}</ul>
          <button className="btn btn--primary btn--block" disabled={ocupado} onClick={guardar}>Confirmar y publicar</button>
          <button className="btn btn--block" disabled={ocupado} onClick={() => setConfirmando(false)}>Seguir editando</button>
        </div>}
        <div className="admin-actions">
          <label className="field"><span>Fecha de la imagen institucional</span><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} disabled={ocupado} /></label>
          {!confirmando && <button className="btn btn--primary btn--block" disabled={ocupado || completos !== zonas.length || !sucio} onClick={() => setConfirmando(true)}>Revisar y publicar</button>}
          <button className="btn btn--block" disabled={ocupado || completos !== zonas.length || !fecha} onClick={exportarInstitucional}>{ocupado ? "Procesando…" : "Descargar imagen institucional"}</button>
          <button className="btn btn--block" disabled={ocupado || completos !== zonas.length} onClick={exportar}>Capturar mapa actual</button>
          {sucio && <p className="admin-panel__hint">La descarga reflejará el borrador visible. Publicá para actualizar el mapa del sitio.</p>}
        </div>
      </>}
        <EmbedShare path="/embed/riesgo-incendios" title="Riesgo de incendios forestales de Misiones" />
    </section>
    <div className="admin-map-area">{geo && catalogo ? <RiesgoMap ref={mapaRef} geo={geo} zonas={zonas} catalogo={catalogo} publicadoEn={sucio ? null : publicado?.publicadoEn} enableCapture /> : <div className="admin-map-area__vacio">Preparando mapa de Misiones…</div>}</div>
  </div>;
}
