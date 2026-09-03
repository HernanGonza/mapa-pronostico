import WeatherIcon from "./WeatherIcon";

// Placeholder mientras no haya una fuente de datos para el extendido —
// se muestra igual la estructura de 3 días para que quede lista cuando
// Alerta Temprana empiece a mandarlo.
const DIAS_EXTENDIDO = [0, 1, 2];

export default function MunicipioInfo({ municipio, onCerrar }) {
  if (!municipio) return null;
  const { nombre, esOficial, estacionReferencia, distanciaKm, pronostico } =
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

      <div className="municipio-popover__extendido">
        <span className="municipio-popover__extendido-titulo">
          Próximos días
        </span>
        <div className="municipio-popover__extendido-dias">
          {DIAS_EXTENDIDO.map((i) => (
            <div className="municipio-popover__dia" key={i}>
              <span className="municipio-popover__dia-nombre">—</span>
              <span className="municipio-popover__dia-temp">—°/—°</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
