import { enDemo } from "../lib/demo";

/** Sello visible en toda página abierta en modo demostración (?demo=1): los datos de prueba no se confunden con reales. */
// Sólo en la ventana principal: adentro de /tv o de la página de demostración, los mapas en
// iframe no repiten el sello (ya lo muestra la página que los contiene).
export default function SelloDemo() {
  let principal = true;
  try { principal = window.self === window.top; } catch { principal = false; }
  return enDemo() && principal ? <div className="demo-sello" role="status">DEMOSTRACIÓN · datos de prueba</div> : null;
}
