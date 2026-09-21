import { useState } from "react";
import { publicarEnRedes } from "../lib/publicarEnRedes";

/**
 * Botón que abre el flujo de publicación de una placa (feed y/o historias) en Facebook, Instagram y
 * Telegram desde el servidor, o WhatsApp Web con el mensaje listo. Los modales son SweetAlert2
 * (ver lib/publicarEnRedes.js). Los destinos sin credenciales figuran como "sin configurar"
 * (docs/redes-sociales.md).
 */
export default function PublicarEnRedes({ feedUrl, historiasUrl, epigrafe = "", etiqueta = "Publicar en redes", className = "btn" }) {
  const [ocupado, setOcupado] = useState(false);
  async function abrir() {
    setOcupado(true);
    try { await publicarEnRedes({ feedUrl, historiasUrl, epigrafe }); }
    finally { setOcupado(false); }
  }
  return <button type="button" className={className} disabled={ocupado} onClick={abrir}>{etiqueta}</button>;
}
