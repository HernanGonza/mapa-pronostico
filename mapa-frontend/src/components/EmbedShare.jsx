import { useState } from "react";
export default function EmbedShare({ path, title, kind = 'mapa', height, heading, hint, linkLabel, openLabel }) {
  const [copiado, setCopiado] = useState("");
  const [error, setError] = useState("");
  const [vistaAbierta, setVistaAbierta] = useState(false);
  const historico = kind === 'historico';
  const url = `${window.location.origin}${path}`;
  const alto = height ?? (historico ? 900 : 720);
  const code = `<iframe src="${url}" title="${title}" width="100%" height="${alto}" style="border:0" loading="lazy"></iframe>`;
  async function copiar(texto, tipo) {
    try { await navigator.clipboard.writeText(texto); setCopiado(tipo); setError(""); }
    catch { setCopiado(""); setError("Seleccioná el enlace o el código y copialo con Ctrl+C."); }
  }
  return <div className="risk-share"><h2>{heading ?? (historico ? 'Cuadro estadístico para el sitio web' : 'Mapa para el sitio web')}</h2>
    <p className="admin-panel__hint">{hint ?? (historico ? 'Este cuadro está disponible siempre y consulta los datos actuales al abrirse. Copiá el enlace o el iframe para mostrarlo en el sitio.' : 'El enlace y el código muestran la última versión publicada.')}</p>
    <label>{linkLabel ?? (historico ? 'Enlace al histórico público' : 'Enlace al mapa publicado')}<input readOnly value={url} onFocus={e => e.target.select()} /></label>
    <a href={url} target="_blank" rel="noreferrer">{openLabel ?? (historico ? 'Abrir cuadro estadístico ↗' : 'Abrir mapa publicado ↗')}</a>
    <button type="button" className="btn btn--block" onClick={() => copiar(url, "enlace")}>{copiado === "enlace" ? "Enlace copiado" : "Copiar enlace"}</button>
    <label>Código para embeber<textarea readOnly value={code} onFocus={e => e.target.select()} /></label>
    <button type="button" className="btn btn--block" onClick={() => copiar(code, "codigo")}>{copiado === "codigo" ? "Código copiado" : "Copiar código para embeber"}</button>
    {historico && <>
      <button type="button" className="btn btn--block" onClick={() => setVistaAbierta(v => !v)} aria-expanded={vistaAbierta}>
        {vistaAbierta ? 'Cerrar vista pública' : 'Ver el cuadro público'}
      </button>
      {vistaAbierta && <iframe className="historico-compartir__vista" src={url} title="Vista pública del histórico" loading="lazy" />}
    </>}
    {error && <p role="status" className="admin-panel__hint">{error}</p>}
  </div>;
}
