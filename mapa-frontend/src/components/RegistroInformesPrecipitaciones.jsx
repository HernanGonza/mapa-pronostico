import { useCallback, useEffect, useState } from "react";
import PublicarEnRedes from "./PublicarEnRedes";
import * as api from "../api";
import { AR } from "../lib/precipitacionesCalculo";

/**
 * Registro de los informes de lluvias emitidos: una tarjeta por placa generada, con sus dos formatos (feed e historias),
 * dónde salió publicada y el botón para volver a publicarla (por ejemplo si falló la red).
 */
const NOMBRE = { facebook: "Facebook", instagram: "Instagram", telegram: "Telegram" };
const cuando = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: AR, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function Tarjeta({ placa, alPublicar, previas, alBorrar }) {
  const destinos = [...new Set((previas || []).map((p) => NOMBRE[p.destino] || p.destino))];
  return <li className="prec-reg-tarjeta">
    <div className="prec-reg-tarjeta__cab"><strong>{placa.periodo}</strong>
      <small>Emitida el {cuando(placa.generadoEn)} h{placa.generadoPorEmail ? ` · ${placa.generadoPorEmail}` : ""}</small></div>
    <div className="prec-reg-miniaturas">{[["feed", "Feed"], ["historias", "Historias"]].map(([f, n]) => <figure key={f}>
      <a href={placa[`${f}Url`]} target="_blank" rel="noopener noreferrer" title={`Abrir la placa de ${n.toLowerCase()} en grande`}><img loading="lazy" src={placa[`${f}Url`]} alt={`Placa ${placa.periodo}, ${n}`} /></a>
      <figcaption>{n}</figcaption></figure>)}</div>
    {previas == null ? null : destinos.length
      ? <span className="prec-reg-estado prec-reg-estado--ok" title={`Último envío: ${cuando(previas[0].creadoEn)} h`}>✓ Publicada en {destinos.join(", ")}</span>
      : <span className="prec-reg-estado prec-reg-estado--no">Todavía sin publicar en redes</span>}
    <div className="prec-reg-acciones">
      <PublicarEnRedes className="prec-btn prec-btn--primario" etiqueta={destinos.length ? "Republicar en redes" : "Publicar en redes"} feedUrl={placa.feedUrl} historiasUrl={placa.historiasUrl}
        epigrafe={`Monitoreo de precipitaciones · ${placa.periodo}\n\nDatos recopilados por la Dirección General de Alerta Temprana.`} alTerminar={alPublicar} />
      {[["feed", "Feed"], ["historias", "Historias"]].map(([f, n]) => <a key={f} className="prec-btn" href={`${placa[`${f}Url`]}?download=${encodeURIComponent(`precipitaciones-${f}-${placa.id}.png`)}`}>Descargar {n.toLowerCase()}</a>)}
      <button type="button" className="prec-btn prec-btn--peligro" onClick={() => alBorrar(placa)}>Borrar</button>
    </div>
  </li>;
}

export default function RegistroInformesPrecipitaciones({ version = 0 }) {
  const [lista, setLista] = useState(null), [error, setError] = useState("");
  const [previas, setPrevias] = useState({}); // id de placa → publicaciones en redes
  const cargar = useCallback(async () => {
    try {
      const h = await api.getHistorialPlacasPrecipitaciones();
      setLista(h); setError("");
      const pares = await Promise.all(h.map((p) => api.getRedesPublicaciones(p.feedUrl, p.historiasUrl).then((r) => [p.id, r.publicaciones || []]).catch(() => [p.id, undefined])));
      setPrevias(Object.fromEntries(pares.filter(([, v]) => v)));
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar, version]);
  async function borrar(p) {
    if (!window.confirm(`¿Borrar definitivamente el informe «${p.periodo}»? Se eliminan sus placas y no se puede deshacer. Lo ya publicado en redes no se toca.`)) return;
    try { await api.borrarPlacaPrecipitaciones(p.id); await cargar(); } catch (e) { setError(e.message); }
  }

  return <div className="prec-registro">
    <div className="editor-heading"><h1>Informes emitidos</h1><p>Cada informe de lluvias con su placa para redes. Si una publicación falló o hay que repetirla, se republica desde acá.</p></div>
    {error && <div className="alert alert--error" role="alert">{error}</div>}
    {lista === null ? (error ? null : <p className="admin-panel__hint" role="status">Cargando…</p>)
      : !lista.length ? <p className="admin-panel__hint">Todavía no se emitió ningún informe. Armá uno con «Armar informe» y, al generar la placa, queda registrado acá.</p>
      : <ul className="prec-reg-lista">{lista.map((p) => <Tarjeta key={p.id} placa={p} previas={previas[p.id]} alPublicar={cargar} alBorrar={borrar} />)}</ul>}
  </div>;
}
