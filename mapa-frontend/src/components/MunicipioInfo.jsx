import { useEffect, useState } from "react";
import { getSolDeMunicipio, getLunaDeMunicipio } from "../api";
import WeatherIcon from "./WeatherIcon";
import { iconosCondicion } from "../lib/iconoCondicion";

/** Dato astronómico del municipio en la fecha del pronóstico (`pedir` = getSolDeMunicipio o getLunaDeMunicipio); si no hay dato, no se muestra nada. */
function useAstro(pedir, id, fecha) {
  const [dato, setDato] = useState(null);
  useEffect(() => {
    let vigente = true;
    setDato(null);
    if (id) pedir(id, fecha).then((d) => vigente && setDato(d), () => {});
    return () => { vigente = false; };
  }, [pedir, id, fecha]);
  return dato;
}

export default function MunicipioInfo({ municipio, onCerrar, fecha }) {
  const sol = useAstro(getSolDeMunicipio, municipio?.id, fecha);
  const luna = useAstro(getLunaDeMunicipio, municipio?.id, fecha);
  if (!municipio) return null;
  const { nombre, esOficial, estacionReferencia, distanciaKm, pronostico, extendido = [], alerta, alertasProximas = [] } =
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

      {/* ¿Tiene alerta meteorológica ahora? (`alerta` es null si no; si el dato no vino, no se dice nada.) */}
      {alerta !== undefined && (alerta
        ? <p className="municipio-popover__alerta municipio-popover__alerta--con" style={{ "--nivel": alerta.color }}><i aria-hidden="true" /><span><b>{alerta.nombre}</b>{alerta.hasta ? ` · hasta el ${new Date(alerta.hasta).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} h` : ""}</span></p>
        : <p className="municipio-popover__alerta"><i aria-hidden="true" /><span>Sin alertas vigentes</span></p>)}

      {pronostico ? (
        <div className="municipio-popover__prono">
          <div className="municipio-popover__temps">
            <span className="municipio-popover__tmin">{pronostico.TMIN}°</span>
            <span className="municipio-popover__tmax">{pronostico.TMAX}°</span>
          </div>
          {/* Una fila por cada condición (pueden ser varias): ícono de día, de noche y el estado. */}
          <div className="municipio-popover__conds">
            <div className="municipio-popover__conds-cab"><span>Día</span><span>Noche</span><span>Estado</span></div>
            {iconosCondicion(pronostico.CONDICION).map((c) => (
              <div className="municipio-popover__cond-fila" key={c.id}>
                <img className="weather-icon" src={c.dia} width={40} height={40} alt="" draggable={false} />
                <img className="weather-icon" src={c.noche} width={40} height={40} alt="" draggable={false} />
                <span className="municipio-popover__cond">{c.nombre}</span>
              </div>
            ))}
            {!iconosCondicion(pronostico.CONDICION).length && <div className="municipio-popover__cond">{pronostico.CONDICION}</div>}
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

      {/* La luna, debajo del sol: cuándo sale, cuándo se pone y en qué fase está. */}
      {luna && (
        <div className="municipio-popover__luna">
          <div className="municipio-popover__sol">
            <span className="municipio-popover__sol-item" role="group" aria-label={`Salida de la luna: ${luna.sale || "no sale este día"}`}>
              <img className="weather-icon" src="/iconos/moonrise.svg" width={30} height={30} alt="" draggable={false} />
              <b>{luna.sale || "—"}</b><span>Sale la luna</span>
            </span>
            <span className="municipio-popover__sol-item" role="group" aria-label={`Puesta de la luna: ${luna.sePone || "no se pone este día"}`}>
              <img className="weather-icon" src="/iconos/moonset.svg" width={30} height={30} alt="" draggable={false} />
              <b>{luna.sePone || "—"}</b><span>Se pone</span>
            </span>
          </div>
          {/* El ícono es de hemisferio norte: acá la luna creciente se ve iluminada del lado contrario, por eso se espeja. */}
          <span className="municipio-popover__sol-item municipio-popover__fase" role="group" aria-label={`${luna.fase}, ${luna.iluminacion} % iluminada`}>
            <img className="weather-icon municipio-popover__fase-icono" src={`/iconos/${luna.icono}.svg`} width={30} height={30} alt="" draggable={false} />
            <b>{luna.fase}</b><span>{luna.iluminacion} % iluminada</span>
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
                <span className="municipio-popover__dia-temp">{d.tmin != null ? `${d.tmin}°` : "—"}/{d.tmax != null ? `${d.tmax}°` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alertas ya publicadas para los próximos días (aunque todavía no se vean en el mapa). */}
      {alertasProximas.length > 0 && (
        <ul className="municipio-popover__proximas">
          {alertasProximas.map((a) => (
            <li key={a.fecha} className="municipio-popover__alerta municipio-popover__alerta--con" style={{ "--nivel": a.color }}>
              <i aria-hidden="true" /><span><b>{a.etiqueta}</b> · {a.nombre}{a.cuando ? ` · ${a.cuando}${a.cuando.startsWith("durante") ? "" : " h"}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
