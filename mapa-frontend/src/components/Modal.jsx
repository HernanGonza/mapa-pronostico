import { useEffect, useRef } from "react";

/** Ventana modal con el <dialog> nativo (foco atrapado, Esc cierra, el fondo no se toca). */
export default function Modal({ abierto, alCerrar, titulo, children, ancho = 640 }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return <dialog ref={ref} className="modal-eco" style={{ "--ancho-modal": `${ancho}px` }} onClose={alCerrar} onClick={(e) => { if (e.target === ref.current) alCerrar(); }} aria-label={titulo}>
    {abierto && <div className="modal-eco__caja">
      <header><h2>{titulo}</h2><button type="button" className="prec-btn" onClick={alCerrar} aria-label="Cerrar">✕</button></header>
      <div className="modal-eco__cuerpo">{children}</div>
    </div>}
  </dialog>;
}
