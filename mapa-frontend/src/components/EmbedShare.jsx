import { useState } from "react";
export default function EmbedShare({ path, title }) {
  const [copiado, setCopiado] = useState("");
  const [error, setError] = useState("");
  const url = `${window.location.origin}${path}`;
  const code = `<iframe src="${url}" title="${title}" width="100%" height="720" style="border:0" loading="lazy"></iframe>`;
  async function copiar(texto, tipo) {
    try { await navigator.clipboard.writeText(texto); setCopiado(tipo); setError(""); }
    catch { setCopiado(""); setError("Seleccioná el enlace o el código y copialo con Ctrl+C."); }
  }
  return <div className="risk-share"><h2>Mapa para el sitio web</h2>
    <p className="admin-panel__hint">El enlace y el código muestran la última versión publicada.</p>
    <label>Enlace al mapa publicado<input readOnly value={url} onFocus={e => e.target.select()} /></label>
    <a href={url} target="_blank" rel="noreferrer">Abrir mapa publicado ↗</a>
    <button type="button" className="btn btn--block" onClick={() => copiar(url, "enlace")}>{copiado === "enlace" ? "Enlace copiado" : "Copiar enlace"}</button>
    <label>Código para embeber<textarea readOnly value={code} onFocus={e => e.target.select()} /></label>
    <button type="button" className="btn btn--block" onClick={() => copiar(code, "codigo")}>{copiado === "codigo" ? "Código copiado" : "Copiar código para embeber"}</button>
    {error && <p role="status" className="admin-panel__hint">{error}</p>}
  </div>;
}
