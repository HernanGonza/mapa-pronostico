import { useEffect, useRef, useState } from "react";
import { animate } from "motion";

/**
 * Número que cuenta hasta su valor (motion, ~2 kB). Sin animación si la
 * persona pidió movimiento reducido. Formatea en es-AR.
 */
export default function Numero({ valor, decimales = 0, sufijo = "" }) {
  const [mostrado, setMostrado] = useState(valor);
  const previo = useRef(valor);
  useEffect(() => {
    if (!Number.isFinite(valor)) { setMostrado(valor); previo.current = valor; return undefined; }
    const desde = Number.isFinite(previo.current) ? previo.current : 0;
    previo.current = valor;
    if (desde === valor || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setMostrado(valor); return undefined; }
    const anim = animate(desde, valor, { duration: 0.8, ease: [0.16, 1, 0.3, 1], onUpdate: setMostrado });
    return () => anim.stop();
  }, [valor]);
  const texto = Number.isFinite(mostrado)
    ? mostrado.toLocaleString("es-AR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
    : "—";
  return <>{texto}{sufijo}</>;
}
