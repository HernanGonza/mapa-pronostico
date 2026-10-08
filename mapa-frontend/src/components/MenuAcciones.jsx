import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Botón con menú desplegable (sin dependencias): agrupa acciones relacionadas para no llenar la tarjeta de botones.
 * `items`: [{ texto, alHacer, peligro?, deshabilitado?, separador? }]. Se cierra al elegir algo, al tocar afuera,
 * con Escape o al hacer scroll. La lista se dibuja sobre <body> (portal) para que no la corte ni la tape el panel.
 */
export default function MenuAcciones({ etiqueta, items, primario = false, titulo }) {
  const boton = useRef(null), lista = useRef(null);
  const [pos, setPos] = useState(null); // null = cerrado

  useEffect(() => {
    if (!pos) return undefined;
    const cerrar = () => setPos(null);
    const afuera = (e) => { if (!lista.current?.contains(e.target) && !boton.current?.contains(e.target)) cerrar(); };
    const esc = (e) => { if (e.key === "Escape") { cerrar(); boton.current?.focus(); } };
    document.addEventListener("mousedown", afuera);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => { document.removeEventListener("mousedown", afuera); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", cerrar, true); window.removeEventListener("resize", cerrar); };
  }, [pos]);

  const alternar = () => {
    if (pos) { setPos(null); return; }
    const r = boton.current.getBoundingClientRect(), ancho = 250, alto = items.length * 40 + 16, abajo = window.innerHeight - r.bottom;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)), ...(abajo >= alto || abajo >= r.top ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }) });
  };

  return <>
    <button ref={boton} type="button" className={`btn menu-acciones__boton ${primario ? "btn--primary" : ""}`} title={titulo} aria-haspopup="menu" aria-expanded={!!pos}
      onClick={(e) => { e.stopPropagation(); alternar(); }}>{etiqueta}</button>
    {pos && createPortal(<div ref={lista} className="menu-acciones__lista" role="menu" style={pos}>
      {items.map((it, i) => it.separador
        ? <hr key={i} />
        : <button key={it.texto} type="button" role="menuitem" className={it.peligro ? "menu-acciones__peligro" : ""} disabled={it.deshabilitado}
            onClick={() => { setPos(null); it.alHacer(); }}>{it.texto}</button>)}
    </div>, document.body)}
  </>;
}
