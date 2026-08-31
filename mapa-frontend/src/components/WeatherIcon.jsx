import { iconoCondicionUrl } from "../lib/iconoCondicion";

/**
 * Ícono animado de condición climática (Meteocons). El SVG anima solo
 * (SMIL) incluso servido como <img>.
 *
 * TODO: para `prefers-reduced-motion` habría que servir la variante
 * estática — las animaciones SMIL no se pueden pausar por CSS. Por ahora
 * el movimiento es sutil (gotas/rayos) y se deja siempre activo.
 */
export default function WeatherIcon({ condicion, size = 40, title }) {
  return (
    <img
      className="weather-icon"
      src={iconoCondicionUrl(condicion)}
      width={size}
      height={size}
      alt={title ?? condicion ?? ""}
      title={title ?? condicion ?? undefined}
      draggable={false}
    />
  );
}
