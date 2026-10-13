import { useEffect, useState } from "react";
import { getPublicado } from "../api";

const AR = "America/Argentina/Buenos_Aires";
const dma = (f) => String(f).slice(0, 10).split("-").reverse().join("/");
const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: AR, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** De dónde salió lo publicado (el pronóstico se puede publicar desde dos lados). */
export const ORIGEN_TEXTO = { ensamble: "Hecho en el ensamble", panel: "Cargado en Previsión del tiempo" };
export const origenDe = (meta) => ORIGEN_TEXTO[meta?.origen] || "Origen no registrado";

/** Lo que hay publicado ahora; se vuelve a pedir cuando cambia `version` (por ejemplo, al publicar). */
export function usePublicado(version) {
  const [meta, setMeta] = useState(undefined); // undefined = cargando, null = nada publicado
  useEffect(() => {
    let vivo = true;
    getPublicado().then((m) => vivo && setMeta(m), () => vivo && setMeta(null));
    return () => { vivo = false; };
  }, [version]);
  return meta;
}

/**
 * La tarjeta del pronóstico publicado: siempre una sola (se actualiza varias veces por día), con desde dónde se hizo y quién lo publicó,
 * para saber que ya hay algo y no armar otro. Mismo formato que las tarjetas de las alertas.
 */
export default function PronosticoPublicado({ meta, aviso = null }) {
  if (meta === undefined) return null;
  return <div className="avisos-lista pronostico-publicado">
    <h2>Publicado en el mapa público</h2>
    {meta === null
      ? <p className="admin-panel__hint">Todavía no se publicó ningún pronóstico.</p>
      : <ul><li className="alerta-tarjeta">
        <div className="alerta-tarjeta__cab">
          <strong>Pronóstico del {dma(meta.fechaPronostico || meta.publicadoEn)}</strong>
          <span className="alerta-tarjeta__estado">Se ve ahora</span>
          <span className={`pronostico-origen pronostico-origen--${meta.origen || "nd"}`}>{origenDe(meta)}</span>
        </div>
        <div className="alerta-tarjeta__resumen">
          <span>{meta.localidades} localidades</span>
          <span>{meta.conExtendido ? "Con pronóstico de 3 días" : "Sin pronóstico de 3 días"}{meta.conTextos ? " y textos de los días" : ""}</span>
        </div>
        <small>Publicado el {fechaHora(meta.publicadoEn)}{meta.publicadoPor ? <> por {meta.publicadoPor}</> : null}</small>
        {aviso}
      </li></ul>}
  </div>;
}
