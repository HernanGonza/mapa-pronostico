import MunicipioInfo from "./MunicipioInfo";
import { colorPorCondicion, LEYENDA } from "../lib/condiciones";
export const colorPronostico = dato => colorPorCondicion(dato?.pronostico?.CONDICION);
export const infoPronostico = (dato, { onCerrar }) => <MunicipioInfo municipio={dato} onCerrar={onCerrar} />;
export function LeyendaPronostico() {
  return <div className="map-key"><strong>Condiciones del tiempo</strong><div className="map-key__items">
    {LEYENDA.map(c => <span key={c.id}><i style={{ background: c.color }} />{c.label}</span>)}
  </div></div>;
}
