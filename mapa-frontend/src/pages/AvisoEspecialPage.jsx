import { useState } from "react";
import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import PublicarEnRedes from "../components/PublicarEnRedes";
import * as api from "../api";
import { crearAvisoEspecialPorPasos } from "../lib/asistenteAvisoEspecial";

/**
 * Aviso especial: aviso corto de texto libre con una captura de radar o satélite
 * (sin mapa ni polígono, a diferencia de los avisos a muy corto plazo). Se genera
 * con el asistente (vista previa → confirmar), queda guardado y se publica en redes
 * desde acá. No tiene mapa público ni vigencia.
 */
export default function AvisoEspecialPage() {
  const [ultimo, setUltimo] = useState(null); // { texto, emitidoEn, imagen, placa }

  // La vista previa NO guarda nada; recién al confirmar en el asistente se guarda la misma placa.
  const vistaPrevia = (valores) => api.generarAvisoEspecial(valores, { vistaPrevia: true });
  async function guardar(valores, token) {
    const placa = await api.generarAvisoEspecial(valores, { confirmarToken: token });
    setUltimo({ ...valores, placa });
    return placa;
  }

  // Al crear otro, arranca con el texto del anterior (suelen ser avisos de seguimiento), pero
  // con la hora de ahora y sin imagen: la captura casi siempre es nueva.
  const crear = () => crearAvisoEspecialPorPasos({ inicial: ultimo ? { texto: ultimo.texto, titulo: ultimo.titulo, subtitulo: ultimo.subtitulo, nivel: ultimo.nivel } : {}, vistaPrevia, guardar });
  const epigrafe = ultimo ? `${[ultimo.titulo, ultimo.subtitulo].filter(Boolean).join(" ")}\n\n${ultimo.texto}` : "";

  const placa = ultimo?.placa;
  return (
    <div className="admin-layout risk-layout meteo-layout">
      <BrandHeader subtitulo="Aviso especial"><Link to="/panel/mapas" className="btn-link">← Panel</Link></BrandHeader>
      <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
        <div className="editor-heading">
          <h1>Aviso especial</h1>
          <p>Para avisos cortos de texto libre (por ejemplo, tormentas formándose en Paraguay en dirección a Misiones) acompañados de una captura de radar o satélite. Genera las placas de feed e historias.</p>
        </div>
        <button type="button" className="btn btn--block btn--primary asistente-cta" onClick={crear}>Crear aviso especial</button>
        {ultimo && (
          <div className="avisos-lista avisos-lista--pendiente">
            <h2>Último aviso generado: {[ultimo.titulo, ultimo.subtitulo].filter(Boolean).join(" ")}</h2>
            <p className="avisos-lista__texto">{ultimo.texto}</p>
          </div>
        )}
      </section>
      <div className="admin-map-area placa-workspace">
        <div className="placa-content">
          <div className="placa-preview">
            {placa ? <>
              <PublicarEnRedes unaVez className="btn btn--primary" feedUrl={placa.feedUrl} historiasUrl={placa.historiasUrl} epigrafe={epigrafe} />
              <div className="placa-preview-grid">
                {[["feed", "Feed"], ["historias", "Historias"]].map(([formato, nombre]) => (
                  <figure key={formato}>
                    <a className="btn btn--primary" href={`${placa[`${formato}Url`]}?download=${encodeURIComponent(placa[`${formato}Nombre`])}`}>Descargar {formato}</a>
                    <img src={placa[`${formato}Url`]} alt={`Aviso especial para ${formato}`} />
                    <figcaption>{nombre}</figcaption>
                  </figure>
                ))}
              </div>
            </> : <div className="admin-map-area__vacio" role="status">Tocá «Crear aviso especial»: elegís el título y el nivel, escribís el texto, la hora de emisión y subís la captura. Acá vas a ver y descargar las placas.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
