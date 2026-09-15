import { useState } from "react";
import WeatherIcon from "./WeatherIcon";
import { fechaLarga, tiempoRelativo } from "../lib/tiempoRelativo";

/** Reordena {zonas:[{zona,dias:[...]}], informes:[...]} a una lista por
 * día (Hoy/Sábado/Domingo), cada uno con las 3 zonas + el informe
 * narrativo de ese día — así arriba y abajo hablan del mismo día. */
function porDia(extendido) {
  const zonas = extendido?.zonas || [];
  const informes = extendido?.informes || [];
  const maxDias = Math.max(0, ...zonas.map((z) => z.dias.length));
  const dias = [];
  for (let i = 0; i < maxDias; i++) {
    const referencia = zonas.find((z) => z.dias[i])?.dias[i];
    if (!referencia) continue;
    dias.push({
      etiqueta: referencia.etiqueta,
      fecha: referencia.fecha,
      zonas: zonas.map((z) => ({ zona: z.zona, ...z.dias[i] })).filter((z) => z.tmin !== undefined),
      informe: informes[i]?.texto || null,
    });
  }
  return dias;
}

export default function PronosticoExtendidoView({ extendido, publicadoEn }) {
  const [abierto, setAbierto] = useState(0);
  const dias = porDia(extendido);

  if (!dias.length) {
    return (
      <div className="base-map base-map--fallback">
        <div>
          <strong>Pronóstico de 3 días · Misiones</strong>
          <p>Todavía no hay un pronóstico extendido publicado.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="extendido">
      <div className="extendido__head">
        <h2>Pronóstico de 3 días</h2>
        {publicadoEn && <span className="extendido__actualizado">Actualizado {tiempoRelativo(publicadoEn)} · {fechaLarga(publicadoEn)}</span>}
      </div>

      <div className="extendido__dias" role="tablist" aria-label="Elegir día">
        {dias.map((d, i) => (
          <button key={d.etiqueta + i} type="button" role="tab" aria-selected={abierto === i} className={`extendido__dia-tab${abierto === i ? " is-active" : ""}`} onClick={() => setAbierto(i)}>
            <strong>{d.etiqueta}</strong>
            {d.fecha && <small>{d.fecha}</small>}
          </button>
        ))}
      </div>

      {dias[abierto] && (
        <div className="extendido__panel">
          <div className="extendido__zonas">
            {dias[abierto].zonas.map((z) => (
              <div className="extendido__zona" key={z.zona}>
                <WeatherIcon condicion={z.condicion} size={48} />
                <strong>{z.zona}</strong>
                <span className="extendido__temp">
                  <b>{z.tmax}°</b> / {z.tmin}°
                </span>
                <small>{z.condicion?.charAt(0)}{z.condicion?.slice(1).toLowerCase()}</small>
              </div>
            ))}
          </div>
          {dias[abierto].informe && (
            <p className="extendido__informe">{dias[abierto].informe}</p>
          )}
        </div>
      )}
    </div>
  );
}
