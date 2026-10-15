import { useEffect, useId, useRef, useState } from "react";
import { CONDICIONES_POR_CATEGORIA, partesCondicion, unirCondiciones } from "../lib/condiciones";
import { iconosCondicion } from "../lib/iconoCondicion";

/**
 * Condiciones del tiempo: lista fija, se puede elegir más de una. Cada elegida es una ficha con su ícono (día y noche)
 * y una ×; el botón «+» abre la lista (agrupada) para sumar otra. El valor es el texto «A + B» que viaja por todo el
 * sistema (ver lib/condiciones.js). `compacto`: sólo íconos y el «+», para las tablas.
 */
export default function SelectorCondiciones({ valor, alCambiar, etiqueta = "Condición", compacto = false, deshabilitado = false, invalido = false }) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef(null);
  const id = useId();
  const elegidas = partesCondicion(valor);
  const ids = new Set(elegidas.map((c) => c.id));
  const iconos = new Map(iconosCondicion(valor).map((i) => [i.id, i]));

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e) => { if (!raiz.current?.contains(e.target)) setAbierto(false); };
    const tecla = (e) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("pointerdown", fuera); document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("pointerdown", fuera); document.removeEventListener("keydown", tecla); };
  }, [abierto]);

  const cambiar = (lista) => alCambiar(unirCondiciones(lista));
  const alternar = (c) => cambiar(ids.has(c.id) ? elegidas.filter((x) => x.id !== c.id) : [...elegidas, c]);

  return <div className={`cond-selector${compacto ? " cond-selector--compacto" : ""}${invalido ? " cond-selector--invalido" : ""}`} ref={raiz}>
    <div className="cond-selector__fichas">
      {elegidas.map((c) => <span key={c.id} className="cond-ficha" title={c.nombre}>
        <img src={iconos.get(c.id).dia} width={22} height={22} alt="" draggable={false} />
        {!compacto && <span>{c.nombre}</span>}
        {!deshabilitado && <button type="button" className="cond-ficha__quitar" aria-label={`Quitar ${c.nombre}`} onClick={() => cambiar(elegidas.filter((x) => x.id !== c.id))}>×</button>}
      </span>)}
      {!deshabilitado && <button type="button" className="cond-selector__mas" aria-haspopup="listbox" aria-expanded={abierto} aria-controls={id} aria-label={`${etiqueta}: ${elegidas.length ? "sumar otra condición" : "elegir"}`} onClick={() => setAbierto((a) => !a)}>
        {elegidas.length ? "+" : <>+ <span>Elegir</span></>}
      </button>}
    </div>
    {abierto && <div className="cond-selector__lista" id={id} role="listbox" aria-multiselectable="true" aria-label={etiqueta}>
      {CONDICIONES_POR_CATEGORIA.map((k) => <div key={k.id} className="cond-selector__grupo">
        <strong>{k.titulo}</strong>
        <div className="cond-selector__opciones">
          {k.condiciones.map((c) => <button key={c.id} type="button" role="option" aria-selected={ids.has(c.id)} className={`cond-opcion${ids.has(c.id) ? " cond-opcion--on" : ""}`} onClick={() => alternar(c)}>
            <img src={`/iconos/${c.dia}`} width={26} height={26} alt="" draggable={false} /><span>{c.nombre}</span>{ids.has(c.id) && <i aria-hidden="true">✓</i>}
          </button>)}
        </div>
      </div>)}
    </div>}
  </div>;
}
