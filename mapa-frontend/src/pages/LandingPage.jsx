import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide";
import Icono from "../components/Icono";
import WeatherIcon from "../components/WeatherIcon";
import { getActual } from "../api";
import { normalize } from "../lib/normalizeText";

// Localidades que se destacan en la portada, en este orden (si el pronóstico las trae).
const DESTACADAS = ["posadas", "puerto iguazu", "obera", "eldorado", "bernardo de irigoyen", "san vicente"];

function elegirDestacadas(filas) {
  const validas = (filas || []).filter((f) => f?.LOCALIDAD && Number.isFinite(Number(f.TMAX)));
  const porNombre = new Map(validas.map((f) => [normalize(f.LOCALIDAD), f]));
  const elegidas = DESTACADAS.map((n) => porNombre.get(n)).filter(Boolean);
  return (elegidas.length >= 3 ? elegidas : validas).slice(0, 6);
}

const fechaLarga = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  return Number.isNaN(+d) ? "" : d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
};

/**
 * Pantalla de presentación, previa al login. Marca institucional fija (verde
 * oscuro + logos en blanco), independiente del tema claro/oscuro: es una
 * portada, no una pantalla de trabajo. Muestra el pronóstico publicado hoy
 * (público, el mismo que consume el mapa embebido) si existe.
 */
export default function LandingPage() {
  const [pronostico, setPronostico] = useState(null);
  useEffect(() => { getActual().then(setPronostico).catch(() => {}); }, []);
  const destacadas = elegirDestacadas(pronostico?.filas);

  return (
    <div className="landing">
      <div className="landing__aurora" aria-hidden="true"><i /><i /><i /></div>
      <main className="landing__hero" id="contenido-principal" tabIndex={-1}>
        <img src="/brand/alerta-temprana.png" alt="" className="landing__icono" width={168} height={168} />
        <span className="landing__etiqueta">Dirección General de Alerta Temprana · Misiones</span>
        <h1>Sistema Integrado Alerta Temprana</h1>
        <p>Mapas, pronósticos y alertas para anticiparnos al clima de la provincia.</p>
        <Link to="/login" className="btn btn--primary landing__cta">Ingresar <Icono icono={ArrowRight} size={18} /></Link>

        {destacadas.length > 0 && <section className="landing__hoy" aria-label="Pronóstico publicado">
          <h2>Pronóstico{pronostico?.fechaPronostico ? ` · ${fechaLarga(pronostico.fechaPronostico)}` : ""}</h2>
          <ul>
            {destacadas.map((f, i) => <li key={f.LOCALIDAD} style={{ "--i": i }}>
              <WeatherIcon condicion={f.CONDICION} size={46} />
              <span className="landing__loc">{f.LOCALIDAD}</span>
              <span className="landing__temps"><b className="temp-max">{Math.round(f.TMAX)}°</b><b className="temp-min">{Math.round(f.TMIN)}°</b></span>
              <small>{f.CONDICION}</small>
            </li>)}
          </ul>
        </section>}
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
