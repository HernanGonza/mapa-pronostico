import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import SmnAlertas from "../components/SmnAlertas";

// Antes vivía adentro de Alertas meteorológicas (tab "SMN automático").
// Se separó a su propia tarjeta del panel a pedido del usuario — todavía
// no está pensado cómo se va a usar/publicar, por ahora es solo la
// herramienta de consulta que ya existía.
export default function AlertasAutomaticasPage() {
  return (
    <div className="panel-layout">
      <BrandHeader subtitulo="Alertas automáticas · SMN">
        <Link to="/panel/mapas" className="btn-link">
          ← Panel
        </Link>
      </BrandHeader>
      <div id="contenido-principal" tabIndex={-1} style={{ minHeight: "calc(100vh - var(--header-h))" }}>
        <SmnAlertas />
      </div>
    </div>
  );
}
