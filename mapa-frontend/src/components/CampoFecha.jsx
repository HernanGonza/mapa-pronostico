import { useEffect, useId, useRef } from "react";

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const LOCALIZACION = {
  buttonLabel: "Elegir fecha", placeholder: "dd/mm/aaaa", selectedDateMessage: "La fecha elegida es",
  prevMonthLabel: "Mes anterior", nextMonthLabel: "Mes siguiente", monthSelectLabel: "Mes", yearSelectLabel: "Año",
  closeLabel: "Cerrar calendario", calendarHeading: "Elegir fecha",
  dayNames: DIAS, monthNames: MESES, monthNamesShort: MESES.map((m) => m.slice(0, 3)),
};
const pad = (n) => String(n).padStart(2, "0");
// El valor viaja siempre como AAAA-MM-DD (igual que <input type="date">); sólo se muestra como dd/mm/aaaa.
const ADAPTADOR = {
  parse(texto = "", crear) {
    const m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? crear(m[3], m[2], m[1]) : undefined;
  },
  format: (fecha) => `${pad(fecha.getDate())}/${pad(fecha.getMonth() + 1)}/${fecha.getFullYear()}`,
};

let definido;
function definirElemento() {
  definido ??= import("@duetds/date-picker/custom-element").then((m) => m.defineCustomElements?.());
  return definido;
}

/**
 * Selector de fecha (Duet Date Picker: componente web accesible, cargado
 * recién cuando aparece un campo de fecha). Reemplaza a <input type="date">
 * con la misma interfaz de valor: `value`/`min`/`max` en AAAA-MM-DD y
 * `onChange(valor)` con el nuevo AAAA-MM-DD (o "" si se borra).
 */
export default function CampoFecha({ label, value, onChange, min, max, disabled = false }) {
  const id = useId().replace(/:/g, "");
  const ref = useRef(null);
  const alCambiar = useRef(onChange);
  alCambiar.current = onChange;

  useEffect(() => {
    let vivo = true;
    let quitar = () => {};
    definirElemento().then(() => {
      const el = ref.current;
      if (!vivo || !el) return;
      el.localization = LOCALIZACION;
      el.dateAdapter = ADAPTADOR;
      const escuchar = (e) => alCambiar.current?.(e.detail.value || "");
      el.addEventListener("duetChange", escuchar);
      quitar = () => el.removeEventListener("duetChange", escuchar);
    });
    return () => { vivo = false; quitar(); };
  }, []);

  return <div className="field campo-fecha">
    <label htmlFor={id}><span>{label}</span></label>
    <duet-date-picker ref={ref} identifier={id} first-day-of-week="1" value={value || ""} min={min || undefined} max={max || undefined} disabled={disabled ? "" : undefined} />
  </div>;
}
