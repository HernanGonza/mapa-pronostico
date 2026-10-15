import { partesCondicion } from "./condiciones";

/**
 * Condición del tiempo → ícono. Son los del Servicio Meteorológico Nacional (cuadro «Referencias» de smn.gob.ar/pronostico):
 * cada condición del catálogo (lib/condiciones.js) tiene su ícono de día y de noche, en public/iconos/smn (PNG).
 *
 * Esto es SOLO para el mapa interactivo / la web. El PNG cuadrado para redes sigue usando los íconos propios del
 * backend (data/materiales/imgs), no se toca.
 */
const FALLBACK = "not-available.svg";
const url = (archivo) => `/iconos/${archivo}`; // `archivo` ya trae la carpeta y la extensión («smn/3.png»)

/** Las URLs de los íconos de una condición (o de varias, «A + B»): [{ id, nombre, dia, noche }] con `dia`/`noche` ya como URL. */
export function iconosCondicion(condicion) {
  return partesCondicion(condicion).map((c) => ({ id: c.id, nombre: c.nombre, dia: url(c.dia), noche: url(c.noche) }));
}

/** Devuelve la URL del SVG para una condición; con varias, la de la primera. `momento`: "dia" o "noche". */
export function iconoCondicionUrl(condicion, momento = "dia") {
  const [primera] = iconosCondicion(condicion);
  return primera ? primera[momento === "noche" ? "noche" : "dia"] : url(FALLBACK);
}
