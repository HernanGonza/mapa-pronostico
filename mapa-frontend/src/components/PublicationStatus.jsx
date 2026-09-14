export default function PublicationStatus({ changed, published, children }) {
  return <div className="publication-status" role="status">
    <span className={`publication-status__badge ${changed ? "is-draft" : published ? "is-published" : ""}`}>
      {changed ? "Cambios sin publicar" : published ? "Publicado" : "Sin publicar"}
    </span>
    {children && <span>{children}</span>}
  </div>;
}
