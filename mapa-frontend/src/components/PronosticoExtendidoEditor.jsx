import { CONDICIONES_CANONICAS, colorPorCondicion, condicionCanonica, esCondicionConocida } from "../lib/condiciones";

const ZONA_NOMBRES = ["Sur", "Centro", "Norte"];
const MAX_DIAS = 3;

/** Extendido en blanco para arrancar a cargar a mano cuando el .docx no
 * trajo "PRONÓSTICO EXTENDIDO" — mismo shape que buildExtendedForecast. */
export function extendidoVacio() {
  return {
    zonas: ZONA_NOMBRES.map((zona) => ({ zona, dias: [{ etiqueta: "Hoy", fecha: null, tmin: "", tmax: "", condicion: "" }] })),
    informes: [{ dia: "Hoy", fecha: null, texto: "" }],
  };
}

function tempInvalida(v) {
  if (v == null || String(v).trim() === "") return true;
  const n = Number(v);
  return !Number.isInteger(n) || n < -15 || n > 55;
}

export function hayInvalidosExtendido(extendido) {
  if (!extendido?.zonas?.length) return true;
  return extendido.zonas.some((z) =>
    z.dias.some((d) => tempInvalida(d.tmin) || tempInvalida(d.tmax) || Number(d.tmin) > Number(d.tmax) || !esCondicionConocida(d.condicion))
  ) || extendido.zonas.some((z) => z.dias.some((d) => !d.etiqueta?.trim()));
}

export default function PronosticoExtendidoEditor({ extendido, onChange, disabled }) {
  const numDias = extendido.zonas[0]?.dias.length || 1;

  function actualizarDia(zonaIdx, diaIdx, campo, valor) {
    onChange({
      ...extendido,
      zonas: extendido.zonas.map((z, i) => (i !== zonaIdx ? z : { ...z, dias: z.dias.map((d, j) => (j !== diaIdx ? d : { ...d, [campo]: valor })) })),
    });
  }
  function actualizarEncabezado(diaIdx, campo, valor) {
    onChange({
      ...extendido,
      zonas: extendido.zonas.map((z) => ({ ...z, dias: z.dias.map((d, j) => (j !== diaIdx ? d : { ...d, [campo]: valor })) })),
      informes: extendido.informes.map((inf, j) => (j !== diaIdx ? inf : { ...inf, [campo === "etiqueta" ? "dia" : campo]: valor })),
    });
  }
  function actualizarInforme(diaIdx, texto) {
    onChange({ ...extendido, informes: extendido.informes.map((inf, j) => (j !== diaIdx ? inf : { ...inf, texto })) });
  }
  function agregarDia() {
    if (numDias >= MAX_DIAS) return;
    onChange({
      zonas: extendido.zonas.map((z) => ({ ...z, dias: [...z.dias, { etiqueta: "", fecha: "", tmin: "", tmax: "", condicion: "" }] })),
      informes: [...extendido.informes, { dia: "", fecha: "", texto: "" }],
    });
  }
  function quitarDia() {
    if (numDias <= 1) return;
    onChange({ zonas: extendido.zonas.map((z) => ({ ...z, dias: z.dias.slice(0, -1) })), informes: extendido.informes.slice(0, -1) });
  }

  return (
    <div className="extendido-editor">
      {Array.from({ length: numDias }).map((_, diaIdx) => (
        <fieldset className="extendido-editor__dia" key={diaIdx} disabled={disabled}>
          <legend>{diaIdx === 0 ? "Hoy" : extendido.zonas[0].dias[diaIdx]?.etiqueta || `Día ${diaIdx + 1}`}</legend>
          {diaIdx > 0 && (
            <div className="extendido-editor__encabezado">
              <label className="field"><span>Nombre del día</span><input value={extendido.zonas[0].dias[diaIdx]?.etiqueta || ""} placeholder="Sábado" onChange={(e) => actualizarEncabezado(diaIdx, "etiqueta", e.target.value)} /></label>
              <label className="field"><span>Fecha</span><input value={extendido.zonas[0].dias[diaIdx]?.fecha || ""} placeholder="13 de septiembre" onChange={(e) => actualizarEncabezado(diaIdx, "fecha", e.target.value)} /></label>
            </div>
          )}
          <div className="extendido-editor__zonas">
            {extendido.zonas.map((z, zonaIdx) => {
              const d = z.dias[diaIdx] || {};
              return (
                <div className="extendido-editor__zona" key={z.zona}>
                  <strong>{z.zona}</strong>
                  <label>Mín
                    <input type="number" aria-label={`Mínima ${z.zona}`} value={d.tmin ?? ""} className={tempInvalida(d.tmin) ? "is-invalid" : ""} onChange={(e) => actualizarDia(zonaIdx, diaIdx, "tmin", e.target.value)} />
                  </label>
                  <label>Máx
                    <input type="number" aria-label={`Máxima ${z.zona}`} value={d.tmax ?? ""} className={tempInvalida(d.tmax) ? "is-invalid" : ""} onChange={(e) => actualizarDia(zonaIdx, diaIdx, "tmax", e.target.value)} />
                  </label>
                  <label>Condición
                    <div className="cond-cell">
                      <span className="cond-swatch" style={{ background: colorPorCondicion(d.condicion) }} />
                      <select aria-label={`Condición ${z.zona}`} value={condicionCanonica(d.condicion) || ""} className={esCondicionConocida(d.condicion) ? "" : "is-invalid"} onChange={(e) => actualizarDia(zonaIdx, diaIdx, "condicion", e.target.value)}>
                        {!esCondicionConocida(d.condicion) && <option value="">{d.condicion || "(elegir)"}</option>}
                        {CONDICIONES_CANONICAS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </label>
                </div>
              );
            })}
          </div>
          <label className="field"><span>Informe narrativo</span><textarea rows={3} maxLength={800} value={extendido.informes[diaIdx]?.texto || ""} onChange={(e) => actualizarInforme(diaIdx, e.target.value)} placeholder="Nubosidad, lluvia esperada, viento, calidad del aire…" /></label>
        </fieldset>
      ))}
      <div className="admin-actions">
        <button type="button" className="btn" disabled={disabled || numDias >= MAX_DIAS} onClick={agregarDia}>Agregar día</button>
        <button type="button" className="btn" disabled={disabled || numDias <= 1} onClick={quitarDia}>Quitar último día</button>
      </div>
    </div>
  );
}
