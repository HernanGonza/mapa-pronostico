import { MorphIcon } from "morphicons/react";

/**
 * Ícono de trazo (Lucide) que se transforma en otro cuando cambia `icono`
 * (Morphicons: sin dependencias de runtime, resorte físico). Sirve también
 * como ícono estático. Decorativo por defecto: si el ícono es la única
 * etiqueta de un botón, ponerle `aria-label` al botón, no acá.
 */
export default function Icono({ icono, size = 20, strokeWidth = 1.75, spring = "snappy", ...resto }) {
  return <MorphIcon icon={icono} size={size} strokeWidth={strokeWidth} spring={spring} aria-hidden="true" focusable="false" {...resto} />;
}
