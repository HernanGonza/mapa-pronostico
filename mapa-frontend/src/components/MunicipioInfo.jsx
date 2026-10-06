import { useEffect, useState } from "react";
import { getSolDeMunicipio } from "../api";
import WeatherIcon from "./WeatherIcon";

/** Amanecer y anochecer del municipio en la fecha del pronóstico; si no hay dato, no se muestra nada. */
function useSol(id, fecha) {
  const [sol, setSol] = useState(null);
  useEffect(() => {
    let vigente = true;
    setSol(null);
    if (id) getSolDeMunicipio(id, fecha).then((d) => vigente && setSol(d), () => {});
    return () => { vigente = false; };
  }, [id, fecha]);
  return sol;
}

export default function MunicipioInfo({ municipio, onCerrar, fecha }) {
  const sol = useSol(municipio?.id, fecha);
  if (!municipio) return null;
  const { nombre, esOficial, estacionReferencia, distanciaKm, pronostico, extendido = [] } =
    municipio;

  return (
    <div
      className="municipio-popover"
      role="dialog"
      aria-label={`Pronóstico de ${nombre}`}
    >
      <button
        className="municipio-popover__close"
        onClick={onCerrar}
        aria-label="Cerrar"
      >
        ✕
      </button>
      <h3 className="municipio-popover__nombre">{nombre}</h3>

      {!esOficial && estacionReferencia && (
        <p className="municipio-popover__ref">
          Dato de la estación más cercana: <b>{estacionReferencia}</b> (
          {distanciaKm} km)
        </p>
      )}
      {esOficial && (
        <p className="municipio-popover__ref municipio-popover__ref--oficial">
          Estación oficial de Alerta Temprana
        </p>
      )}

      {pronostico ? (
        <div className="municipio-popover__prono">
          <WeatherIcon condicion={pronostico.CONDICION} size={56} />
          <div>
            <div className="municipio-popover__temps">
              <span className="municipio-popover__tmin">
                {pronostico.TMIN}°
              </span>
              <span className="municipio-popover__tmax">
                {pronostico.TMAX}°
              </span>
            </div>
            <div className="municipio-popover__cond">
              {pronostico.CONDICION}
            </div>
          </div>
        </div>
      ) : (
        <p className="municipio-popover__ref">
          Sin pronóstico publicado todavía.
        </p>
      )}

      {sol && (
        <div className="municipio-popover__sol">
          <span className="municipio-popover__sol-item" role="group" aria-label={`Salida del sol: ${sol.amanecer}`}>
            <img className="weather-icon" src="/iconos/sunrise.svg" width={30} height={30} alt="" draggable={false} />
            <b>{sol.amanecer}</b><span>Amanecer</span>
          </span>
          <span className="municipio-popover__sol-item" role="group" aria-label={`Puesta del sol: ${sol.anochecer}`}>
            <img className="weather-icon" src="/iconos/sunset.svg" width={30} height={30} alt="" draggable={false} />
            <b>{sol.anochecer}</b><span>Anochecer</span>
          </span>
        </div>
      )}

      {/* Pronóstico extendido de la zona (norte, centro o sur) de la localidad de referencia. */}
      {extendido.length > 0 && (
        <div className="municipio-popover__extendido">
          <span className="municipio-popover__extendido-titulo">
            Próximos días{pronostico?.ZONA ? ` · zona ${pronostico.ZONA.toLowerCase()}` : ""}
          </span>
          <div className="municipio-popover__extendido-dias">
            {extendido.map((d) => (
              <div className="municipio-popover__dia" key={d.etiqueta + (d.fecha || "")} title={d.condicion}>
                <span className="municipio-popover__dia-nombre">{d.etiqueta}</span>
                <WeatherIcon condicion={d.condicion} size={32} title={d.condicion} />
                <span className="municipio-popover__dia-temp">{d.tmin}°/{d.tmax}°</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
