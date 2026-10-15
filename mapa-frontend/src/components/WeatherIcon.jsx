import { iconosCondicion, iconoCondicionUrl } from "../lib/iconoCondicion";

/**
 * Ícono de condición del tiempo (los del SMN, uno de día y otro de noche).
 * Con varias condiciones («Nublado + Chaparrones») se muestran todas, una al lado de la otra, achicadas para que
 * entren en el mismo ancho. `momento`: "dia" (por defecto) o "noche".
 */
export default function WeatherIcon({ condicion, size = 40, title, momento = "dia" }) {
  const iconos = iconosCondicion(condicion);
  const texto = title ?? condicion ?? undefined;
  if (iconos.length < 2) {
    return <img className="weather-icon" src={iconoCondicionUrl(condicion, momento)} width={size} height={size} alt={texto ?? ""} title={texto} draggable={false} />;
  }
  const chico = Math.round(size * (iconos.length === 2 ? 0.62 : 0.5));
  return <span className="weather-icon-grupo" style={{ width: size, minHeight: size }} title={texto}>
    {iconos.map((i) => <img key={i.id} className="weather-icon" src={i[momento === "noche" ? "noche" : "dia"]} width={chico} height={chico} alt={i.nombre} draggable={false} />)}
  </span>;
}
