import { useState } from "react";
import { LEYENDA, SIN_DATO } from "../lib/condiciones";

/**
 * Leyenda del mapa: qué significa cada color y la altura de las columnas.
 * Colapsable — en pantallas chicas arranca cerrada para no tapar el mapa.
 */
export default function Legend({ startOpen = true }) {
  const [open, setOpen] = useState(startOpen);

  return (
    <div className={`legend ${open ? "legend--open" : ""}`}>
      <button
        className="legend__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>Referencias</span>
        <span className="legend__chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="legend__body">
          <ul className="legend__list">
            {LEYENDA.map((g) => (
              <li key={g.id}>
                <span
                  className="legend__swatch"
                  style={{ background: g.color }}
                />
                {g.label}
              </li>
            ))}
            <li>
              <span
                className="legend__swatch legend__swatch--plain"
                style={{ background: SIN_DATO.color }}
              />
              {SIN_DATO.label}
            </li>
          </ul>
          <p className="legend__note">
            La altura de cada municipio representa su temperatura máxima
            prevista.
          </p>
        </div>
      )}
    </div>
  );
}
