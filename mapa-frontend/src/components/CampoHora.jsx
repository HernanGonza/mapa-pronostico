import { useEffect, useId, useRef, useState } from "react";
import { Clock } from "lucide";
import Icono from "./Icono";

const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTOS = ["00", "15", "30", "45"];

/**
 * Selector de hora: un botón con la hora elegida que abre una grilla con las 24 horas y los minutos
 * (de a 15). Mismo contrato que <input type="time">: `value` y `onChange(valor)` en HH:MM.
 * Se cierra al elegir los minutos, con Escape o al tocar afuera.
 */
export default function CampoHora({ label, value, onChange, disabled = false }) {
  const id = useId().replace(/:/g, "");
  const [abierto, setAbierto] = useState(false);
  const caja = useRef(null);
  const [hh = "00", mm = "00"] = (value || "00:00").split(":");

  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => { if (!caja.current?.contains(e.target)) setAbierto(false); };
    const tecla = (e) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("mousedown", fuera); document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", tecla); };
  }, [abierto]);

  return <div className="field campo-hora" ref={caja}>
    <label htmlFor={id}><span>{label}</span></label>
    <button id={id} type="button" className="campo-hora__boton" disabled={disabled} aria-haspopup="dialog" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
      <Icono icono={Clock} size={16} /><span>{hh}:{mm}</span>
    </button>
    {abierto && <div className="campo-hora__panel" role="dialog" aria-label="Elegir hora">
      <p className="campo-hora__titulo">Hora</p>
      <div className="campo-hora__horas">{HORAS.map((h) => <button key={h} type="button" className={h === hh ? "is-on" : ""} onClick={() => onChange(`${h}:${mm}`)}>{h}</button>)}</div>
      <p className="campo-hora__titulo">Minutos</p>
      <div className="campo-hora__minutos">{MINUTOS.map((m) => <button key={m} type="button" className={m === mm ? "is-on" : ""} onClick={() => { onChange(`${hh}:${m}`); setAbierto(false); }}>{m}</button>)}</div>
    </div>}
  </div>;
}
