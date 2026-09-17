import { Link } from "react-router-dom";

/**
 * Pantalla de presentación, previa al login — primera pantalla que ve
 * cualquiera que entre al sitio. Marca institucional fija (verde oscuro +
 * logos en blanco), independiente del tema claro/oscuro del resto del
 * panel: es una portada, no una pantalla de trabajo.
 */
export default function LandingPage() {
  return (
    <div className="landing">
      <main className="landing__hero" id="contenido-principal" tabIndex={-1}>
        <img src="/brand/alerta-temprana.png" alt="" className="landing__icono" width={290} height={290} />
        <h1>Sistema Integrado Alerta Temprana</h1>
        <p>Mapas, pronósticos y alertas de la Dirección General de Alerta Temprana de Misiones.</p>
        <Link to="/login" className="btn btn--primary landing__cta">Ingresar</Link>
      </main>

      <footer className="landing__footer">
        <div className="landing__marca">
          <img src="/brand/ecologia-flor.png" alt="" width={34} height={34} />
          <div className="landing__wordmark">
            <strong>Ecología</strong>
            <span>Misiones</span>
          </div>
        </div>
        <div className="landing__sep" aria-hidden />
        <img src="/brand/logo-ordenamiento.png" alt="Subsecretaría de Ordenamiento Territorial" className="landing__ordenamiento" />
      </footer>
    </div>
  );
}
