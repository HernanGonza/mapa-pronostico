import { useEffect, useRef } from "react";

export default function PublicationReview({ busy, onConfirm, onCancel, children }) {
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="risk-review" aria-label="Revisar publicación">
    <h2 ref={heading} tabIndex={-1}>Revisar publicación</h2>
    {children}
    <p>Al confirmar se actualizará el mapa público.</p>
    <div className="admin-actions">
      <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={onConfirm}>
        {busy ? "Procesando…" : "Confirmar y publicar"}
      </button>
      <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={onCancel}>Seguir editando</button>
    </div>
  </section>;
}
