import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import { confirmar } from "../lib/ui";

const DESTINOS = [
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["telegram", "Telegram"],
];
const FORMATOS = [
  ["feed", "Feed"],
  ["historias", "Historias"],
];
const NOMBRE = Object.fromEntries([...DESTINOS, ...FORMATOS]);
const MAX_INSTAGRAM = 2200;

/**
 * Botón + diálogo para publicar una placa ya generada (feed y/o historias) en
 * Facebook, Instagram y Telegram desde el servidor, o abrir WhatsApp Web con
 * el mensaje listo. Los destinos sin credenciales en el backend aparecen
 * deshabilitados (ver docs/redes-sociales.md).
 */
export default function PublicarEnRedes({ feedUrl, historiasUrl, epigrafe: epigrafeInicial = "", etiqueta = "Publicar en redes", className = "btn" }) {
  const dialogo = useRef(null);
  const [abierto, setAbierto] = useState(false);
  const [estado, setEstado] = useState(null);
  const [previas, setPrevias] = useState([]);
  const [destinos, setDestinos] = useState({});
  const [formatos, setFormatos] = useState({ feed: true, historias: true });
  const [epigrafe, setEpigrafe] = useState(epigrafeInicial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [repetidas, setRepetidas] = useState(null);
  const [resultados, setResultados] = useState(null);

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  function abrir() {
    setEpigrafe(epigrafeInicial); setError(""); setRepetidas(null); setResultados(null); setPrevias([]);
    setAbierto(true);
    api.getRedesEstado().then((e) => {
      setEstado(e);
      setDestinos({ facebook: e.facebook, instagram: e.instagram, telegram: e.telegram });
    }).catch((err) => { setEstado({}); setError(err.message); });
    api.getRedesPublicaciones(feedUrl, historiasUrl).then((r) => setPrevias(r.publicaciones)).catch(() => {});
  }

  const elegidosD = DESTINOS.map(([id]) => id).filter((id) => destinos[id]);
  const elegidosF = FORMATOS.map(([id]) => id).filter((id) => formatos[id]);
  const excedeInstagram = destinos.instagram && formatos.feed && epigrafe.length > MAX_INSTAGRAM;
  const puede = !busy && elegidosD.length > 0 && elegidosF.length > 0 && !excedeInstagram;

  async function publicar(forzar = false) {
    const lista = new Intl.ListFormat("es", { style: "long", type: "conjunction" });
    const donde = lista.format(elegidosD.map((id) => NOMBRE[id]));
    const que = lista.format(elegidosF.map((id) => NOMBRE[id].toLowerCase()));
    // Con `forzar` la persona ya decidió repetir tras el aviso de duplicado: no se le pregunta otra vez.
    const ok = forzar || await confirmar({
      titulo: "¿Publicar ahora?", texto: `Se va a publicar ${que} en ${donde}. Desde el sistema no se puede deshacer: para borrarlo hay que hacerlo a mano en cada red.`,
      confirmar: "Publicar", peligro: true, target: dialogo.current,
    });
    if (!ok) return;
    setBusy(true); setError(""); setRepetidas(null); setResultados(null);
    try {
      const r = await api.publicarEnRedes({ feedUrl, historiasUrl, epigrafe, destinos: elegidosD, formatos: elegidosF, forzar });
      setResultados(r.resultados);
      api.getRedesPublicaciones(feedUrl, historiasUrl).then((x) => setPrevias(x.publicaciones)).catch(() => {});
    } catch (e) {
      if (e.yaPublicado) setRepetidas(e.yaPublicado); else setError(e.message);
    } finally { setBusy(false); }
  }

  // WhatsApp Web no permite adjuntar una imagen por enlace: el mensaje lleva
  // el epígrafe y las URLs públicas de las placas (WhatsApp muestra la vista previa).
  function abrirWhatsApp() {
    const enlaces = [formatos.feed && feedUrl, formatos.historias && historiasUrl].filter(Boolean);
    const texto = [epigrafe.trim(), ...enlaces].filter(Boolean).join("\n\n");
    const params = new URLSearchParams({ text: texto });
    if (estado?.whatsappNumero) params.set("phone", estado.whatsappNumero);
    window.open(`https://web.whatsapp.com/send?${params}`, "_blank", "noopener");
  }

  const cerrar = () => { if (!busy) setAbierto(false); };
  const hayFallos = resultados?.some((r) => !r.ok);

  return <>
    <button type="button" className={className} onClick={abrir}>{etiqueta}</button>
    <dialog ref={dialogo} className="redes-dialogo" aria-labelledby="redes-titulo" onCancel={(e) => { if (busy) e.preventDefault(); }} onClose={() => setAbierto(false)}>
      {abierto && <div className="redes-dialogo__cuerpo">
        <h2 id="redes-titulo">Publicar en redes</h2>

        <div className="redes-dialogo__previa">
          {FORMATOS.map(([id, label]) => <figure key={id}><img src={id === "feed" ? feedUrl : historiasUrl} alt={`Vista previa ${label}`} /><figcaption>{label}</figcaption></figure>)}
        </div>

        <fieldset className="redes-dialogo__grupo" disabled={busy}>
          <legend>Formato</legend>
          {FORMATOS.map(([id, label]) => <label key={id}><input type="checkbox" checked={!!formatos[id]} onChange={(e) => setFormatos({ ...formatos, [id]: e.target.checked })} /> {label}</label>)}
        </fieldset>

        <fieldset className="redes-dialogo__grupo" disabled={busy}>
          <legend>Destino</legend>
          {DESTINOS.map(([id, label]) => {
            const disponible = !!estado?.[id];
            return <label key={id} className={disponible ? "" : "redes-dialogo__off"}>
              <input type="checkbox" checked={!!destinos[id]} disabled={!disponible} onChange={(e) => setDestinos({ ...destinos, [id]: e.target.checked })} />
              {" "}{label}{estado && !disponible && " (sin configurar)"}
            </label>;
          })}
        </fieldset>

        <label className="field">
          <span>Epígrafe (se publica junto al feed; las historias no llevan texto)</span>
          <textarea rows={6} value={epigrafe} disabled={busy} onChange={(e) => setEpigrafe(e.target.value)} />
        </label>
        <p className={`meteo-count${excedeInstagram ? " redes-dialogo__excede" : ""}`}>{epigrafe.length}/{MAX_INSTAGRAM} caracteres (límite de Instagram)</p>

        {previas.length > 0 && <p className="redes-dialogo__aviso" role="status">
          Ya publicada: {previas.map((p) => `${NOMBRE[p.destino]} ${NOMBRE[p.formato].toLowerCase()} (${new Date(p.creadoEn).toLocaleString("es-AR")})`).join(" · ")}.
        </p>}

        {error && <div className="risk-message risk-message--error" role="alert">{error}</div>}

        {repetidas && <div className="redes-dialogo__aviso" role="alert">
          <p>Esta placa ya se publicó en: {repetidas.map((p) => `${NOMBRE[p.destino]} ${NOMBRE[p.formato].toLowerCase()} (${new Date(p.creadoEn).toLocaleString("es-AR")}${p.usuarioEmail ? `, ${p.usuarioEmail}` : ""})`).join(" · ")}. ¿Publicarla de nuevo?</p>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => publicar(true)}>Publicar de nuevo igualmente</button>
        </div>}

        {resultados && <ul className="redes-dialogo__resultados" aria-live="polite">
          {resultados.map((r) => <li key={`${r.destino}-${r.formato}`} className={r.ok ? "ok" : "fallo"}>
            <strong>{r.ok ? "✓" : "✗"} {NOMBRE[r.destino]} · {NOMBRE[r.formato]}</strong>
            {r.ok ? (r.permalink ? <> — <a href={r.permalink} target="_blank" rel="noreferrer">ver publicación</a></> : " — publicado") : <> — {r.error}</>}
          </li>)}
        </ul>}
        {hayFallos && <p className="redes-dialogo__aviso">Lo que salió bien ya está publicado. Para reintentar solo lo que falló, desmarcá los destinos o formatos que ya salieron.</p>}

        <div className="redes-dialogo__acciones">
          <button type="button" className="btn btn--primary" disabled={!puede} onClick={() => publicar(false)}>
            {busy ? "Publicando…" : `Publicar en ${elegidosD.length || "…"} destino${elegidosD.length === 1 ? "" : "s"}`}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={abrirWhatsApp} title="Abre WhatsApp Web con el mensaje y los enlaces a las imágenes">Enviar por WhatsApp</button>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={cerrar}>Cerrar</button>
        </div>
        <p className="redes-dialogo__nota">Publicar es definitivo desde el sistema: para borrar una publicación hay que hacerlo a mano en cada red.</p>
      </div>}
    </dialog>
  </>;
}
