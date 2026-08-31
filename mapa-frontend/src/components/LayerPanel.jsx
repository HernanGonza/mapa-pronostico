import { useMemo } from "react";

/**
 * Panel de capas de clima + línea de tiempo.
 * `capas` es un objeto { viento, nubes, lluvia, temp } de booleanos.
 */
const DEFS = [
  { id: "nubes", label: "Nubosidad" },
  { id: "lluvia", label: "Lluvia" },
  { id: "viento", label: "Viento" },
  { id: "temp", label: "Temperatura" },
];

function etiquetaHora(iso) {
  if (!iso) return "";
  // Open-Meteo entrega una fecha local sin offset. La fijamos en -03:00
  // para que un visitante fuera de Argentina no vea otra hora.
  const tieneZona = /[zZ]|[+-]\d\d:\d\d$/.test(iso);
  const localArgentina = tieneZona
    ? iso
    : `${iso}${iso.length === 16 ? ":00" : ""}-03:00`;
  const d = new Date(localArgentina);
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function LayerPanel({
  capas,
  onToggle,
  horas,
  hora,
  horaAhora,
  onHora,
}) {
  const min = 0;
  const max = horas ? horas.length - 1 : 0;
  const marca = useMemo(() => etiquetaHora(horas?.[hora]), [horas, hora]);
  const esAhora = hora === horaAhora;

  return (
    <div className="layer-panel">
      <div className="layer-panel__toggles">
        {DEFS.map((c) => (
          <button
            key={c.id}
            className={`layer-chip ${capas[c.id] ? "layer-chip--on" : ""}`}
            onClick={() => onToggle(c.id)}
            aria-pressed={capas[c.id]}
          >
            <span className={`layer-chip__dot layer-chip__dot--${c.id}`} />
            {c.label}
          </button>
        ))}
      </div>

      {horas && horas.length > 1 && (
        <div className="layer-panel__tiempo">
          <input
            type="range"
            min={min}
            max={max}
            value={hora}
            onChange={(e) => onHora(Number(e.target.value))}
            className="layer-panel__slider"
          />
          <div className="layer-panel__hora">
            <span>{marca}</span>
            {!esAhora && (
              <button className="layer-panel__ahora" onClick={() => onHora(horaAhora)}>
                Ahora
              </button>
            )}
            {esAhora && <span className="layer-panel__badge">ahora</span>}
          </div>
        </div>
      )}
    </div>
  );
}
