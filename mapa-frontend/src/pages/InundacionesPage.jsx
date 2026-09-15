import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";

// Placeholder: todavía no hay placa base ni mapa de inundaciones (diseño
// pendiente). La tarjeta del panel y esta ruta ya están listas para que,
// cuando lleguen los assets, se sume el editor de zonas + generador de
// placas siguiendo el mismo patrón que alertas meteorológicas / riesgo de
// incendios (ver AlertasMeteorologicasPage.jsx y RiesgoIncendiosPage.jsx).
export default function InundacionesPage() {
  return (
    <div className="admin-layout risk-layout">
      <BrandHeader subtitulo="Inundaciones"><Link to="/panel/mapas" className="btn-link">← Panel</Link></BrandHeader>
      <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
        <div className="editor-heading">
          <h1>Inundaciones</h1>
          <p>Esta sección está en preparación.</p>
        </div>
        <p>
          Todavía no tenemos la placa base ni el mapa de referencia para alertas por inundación.
          En cuanto estén los assets de diseño, acá se va a poder editar el estado por zona y
          generar las placas para redes, igual que en Alertas meteorológicas y Riesgo de incendios.
        </p>
      </section>
    </div>
  );
}
