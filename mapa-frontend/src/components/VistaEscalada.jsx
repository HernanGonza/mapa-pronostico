import { useEffect, useRef, useState } from "react";

/** Iframe de tamaño fijo (la /tv es 1920×1080) escalado para entrar en el área disponible. */
export default function VistaEscalada({ src, ancho, alto, titulo }) {
  const caja = useRef(null);
  const [escala, setEscala] = useState(0.4);
  useEffect(() => {
    const el = caja.current;
    if (!el) return undefined;
    const medir = () => setEscala(Math.min(el.clientWidth / ancho, el.clientHeight / alto));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ancho, alto]);
  return <div ref={caja} className="demo-vista__escalada">
    <iframe src={src} title={titulo} style={{ width: ancho, height: alto, transform: `scale(${escala})` }} />
  </div>;
}
