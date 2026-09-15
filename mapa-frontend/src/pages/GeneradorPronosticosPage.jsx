import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";

// Placeholder: todavía no hay recolector de fuentes. La idea es que acá
// se centralicen los datos de las distintas fuentes que hoy alimentan el
// pronóstico a mano (Alerta Temprana, SMN, etc.), antes de armar el
// reporte — no reemplaza a "Pronóstico" (/panel/mapas/pronóstico), que
// sigue siendo donde se sube el .docx y se publica.
export default function GeneradorPronosticosPage() {
  return (
    <div className="admin-layout">
      <BrandHeader subtitulo="Generador de pronósticos">
        <Link to="/panel" className="btn-link">← Panel</Link>
      </BrandHeader>
      <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
        <div className="editor-heading">
          <h1>Generador de pronósticos</h1>
          <p>Esta sección está en preparación.</p>
        </div>
        <p>
          Acá se va a centralizar la recolección de datos de las distintas fuentes que se usan
          para armar el pronóstico (Alerta Temprana, SMN y otras), antes de que Pronóstico las
          use para generar el mapa y las placas.
        </p>
      </section>
    </div>
  );
}
