import { useEffect, useState } from "react";
import WeatherIcon from "../components/WeatherIcon";
import { porDia } from "../components/PronosticoExtendidoView";
import { getActual } from "../api";
import { fechaLarga, tiempoRelativo } from "../lib/tiempoRelativo";
import "./tvExtendido.css";

/**
 * Pronóstico extendido para la tele (/tv/extendido, es lo que /tv muestra en la rotación en lugar del embebido).
 * En la tele no se puede tocar para cambiar de día, así que acá se ven los tres a la vez: hoy, mañana y pasado,
 * cada uno con las zonas (temperatura y estado del tiempo) y el panorama del día.
 */
export default function TvExtendidoPage() {
  const [actual, setActual] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      try { const data = await getActual(); if (!cancelado) setActual(data); }
      catch { /* queda lo último que se pudo leer */ }
      finally { if (!cancelado) setCargando(false); }
    }
    cargar();
    const timer = setInterval(cargar, 5 * 60 * 1000);
    return () => { cancelado = true; clearInterval(timer); };
  }, []);

  const dias = porDia(actual?.extendido).slice(0, 3);
  if (cargando || !dias.length) {
    return <div className="tvext-raiz"><div className="tvext tvext--vacio"><strong>Pronóstico de 3 días · Misiones</strong><p>{cargando ? "Cargando…" : "Todavía no hay un pronóstico extendido publicado."}</p></div></div>;
  }
  // Un mismo tamaño de letra para los tres panoramas, más chico cuanto más largo es el más largo.
  const largo = Math.max(...dias.map((d) => d.informe?.trim().length || 0));
  const letra = largo > 900 ? 1.75 : largo > 780 ? 1.9 : largo > 650 ? 2.05 : 2.25;
  return <div className="tvext-raiz"><div className="tvext">
    <header className="tvext__cabecera">
      <h1>Pronóstico de 3 días</h1>
      {actual?.publicadoEn && <span>Actualizado {tiempoRelativo(actual.publicadoEn)} · {fechaLarga(actual.publicadoEn)}</span>}
    </header>
    <div className="tvext__dias">
      {dias.map((d, i) => <section className="tvext__dia" key={d.etiqueta + i} aria-label={d.etiqueta}>
        <h2><strong>{d.etiqueta}</strong>{d.fecha && <small>{d.fecha}</small>}</h2>
        <ul className="tvext__zonas">
          {d.zonas.map((z) => <li key={z.zona}>
            <WeatherIcon condicion={z.condicion} size={64} />
            <div><strong>{z.zona}</strong><small>{z.condicion?.charAt(0)}{z.condicion?.slice(1).toLowerCase()}</small></div>
            <span className="tvext__temp"><b>{z.tmax}°</b> / {z.tmin}°</span>
          </li>)}
        </ul>
        {d.informe && <p className="tvext__informe" style={{ fontSize: `calc(${letra} * var(--u))` }}>{d.informe.trim()}</p>}
      </section>)}
    </div>
  </div></div>;
}
