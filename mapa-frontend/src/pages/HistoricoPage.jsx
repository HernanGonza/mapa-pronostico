import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";

// Placeholder: todavía no hay pantalla de registro histórico ni
// estadísticas. La idea es que acá se pueda consultar todo lo publicado
// y generado (pronósticos, placas, alertas) con estadísticas sobre esos
// datos — hoy viven en la base pero no hay forma de verlos desde el panel.
export default function HistoricoPage() {
  return (
    <div className="admin-layout">
      <BrandHeader subtitulo="Registro histórico y estadísticas">
        <Link to="/panel" className="btn-link">← Panel</Link>
      </BrandHeader>
      <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
        <div className="editor-heading">
          <h1>Registro histórico y estadísticas</h1>
          <p>Esta sección está en preparación.</p>
        </div>
        <p>
          Acá se va a poder consultar todo lo que se publicó y generó desde el sistema
          (pronósticos, alertas, placas para redes) con estadísticas sobre esos datos.
        </p>
      </section>
    </div>
  );
}
