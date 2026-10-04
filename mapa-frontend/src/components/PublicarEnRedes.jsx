import { useEffect, useState } from "react";
import * as api from "../api";
import { publicarEnRedes } from "../lib/publicarEnRedes";

const NOMBRE = { facebook: "Facebook", instagram: "Instagram", telegram: "Telegram" };
const hora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Botón que abre el flujo de publicación de una placa (feed y/o historias) en Facebook, Instagram y
 * Telegram desde el servidor, o WhatsApp Web con el mensaje listo. Los modales son SweetAlert2
 * (ver lib/publicarEnRedes.js). Los destinos sin credenciales figuran como "sin configurar"
 * (docs/redes-sociales.md).
 *
 * `unaVez`: si la placa ya salió en alguna red (según el registro del servidor; WhatsApp no
 * queda registrado), el botón queda deshabilitado y dice dónde y cuándo se publicó.
 * `alTerminar`: se llama al cerrar el asistente (para recargar lo que muestra la página).
 */
export default function PublicarEnRedes({ feedUrl, historiasUrl, epigrafe = "", etiqueta = "Publicar en redes", className = "btn", unaVez = false, alTerminar }) {
  const [ocupado, setOcupado] = useState(false);
  const [previas, setPrevias] = useState([]);
  const consultar = () => api.getRedesPublicaciones(feedUrl, historiasUrl).then((r) => setPrevias(r.publicaciones || [])).catch(() => {});
  useEffect(() => { if (unaVez) consultar(); }, [unaVez, feedUrl, historiasUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  async function abrir() {
    setOcupado(true);
    try { await publicarEnRedes({ feedUrl, historiasUrl, epigrafe }); }
    finally { setOcupado(false); if (unaVez) consultar(); alTerminar?.(); }
  }

  if (unaVez && previas.length) {
    const destinos = [...new Set(previas.map((p) => NOMBRE[p.destino] || p.destino))].join(", ");
    const ultima = previas[0]; // vienen de la más nueva a la más vieja
    return <button type="button" className={className} disabled title={`Publicado el ${hora(ultima.creadoEn)}${ultima.usuarioEmail ? ` por ${ultima.usuarioEmail}` : ""}`}>
      ✓ Publicado en redes · {destinos}
    </button>;
  }
  return <button type="button" className={className} disabled={ocupado} onClick={abrir}>{etiqueta}</button>;
}
