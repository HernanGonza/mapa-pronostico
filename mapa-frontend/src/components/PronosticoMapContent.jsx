import MunicipioInfo from "./MunicipioInfo";
import { colorPorCondicion, LEYENDA } from "../lib/condiciones";
export const colorPronostico = dato => colorPorCondicion(dato?.pronostico?.CONDICION);
export const infoPronostico = (dato, { onCerrar, fecha }) => <MunicipioInfo municipio={dato} onCerrar={onCerrar} fecha={fecha} />;
/** Referencias de color como franja fina abajo, de lado a lado (igual que alertas y riesgo de incendios). */
export function LeyendaPronostico() {
  return <div className="risk-legends risk-legends--pie"><div className="risk-legend">
    <strong>Condiciones del tiempo</strong>
    <div className="risk-legend__scale risk-legend__scale--condiciones">{LEYENDA.map(c => <div key={c.id}><i style={{ background: c.color }} /><span title={c.label}>{c.label}</span></div>)}</div>
  </div></div>;
}
