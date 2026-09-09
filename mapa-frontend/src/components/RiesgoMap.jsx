import { forwardRef, useCallback } from "react";
import BaseMap from "./BaseMap";

export function LeyendaRiesgo({ categorias, titulo = "Riesgo de incendios forestales" }) {
  return <div className="risk-legend">
    <strong>{titulo}</strong>
    <div className="risk-legend__scale">{categorias.map(c => <div key={c.nombre}>
      <i style={{ background: c.color }} /><span title={c.descripcion}>{c.nombre}{c.accion ? ` · ${c.accion}` : ''}</span>
    </div>)}</div>
    <small>Clasificación por departamento · Ministerio de Ecología y RNR</small>
  </div>;
}
const RiesgoMap = forwardRef(function RiesgoMap({ geo, zonas, catalogo, publicadoEn, titulo, ...props }, ref) {
  const nombreMapa = titulo || (catalogo.categorias.some(c => c.nombre === "Naranja") ? "Alertas meteorológicas" : "Riesgo de incendios forestales");
  const colorDe = useCallback(d => catalogo.categorias.find(c => c.nombre === d?.categoria)?.color, [catalogo]);
  const datos = catalogo.departamentos.map(d => ({ ...d, ...zonas.find(z => String(z.id) === String(d.id)) }));
  return <BaseMap ref={ref} poligonos={geo} datos={datos} colorDe={colorDe}
    titulo={nombreMapa} publicadoEn={publicadoEn}
    leyenda={<LeyendaRiesgo categorias={catalogo.categorias} titulo={nombreMapa} />}
    renderInfo={(d, { onCerrar }) => <div className="municipio-popover" role="dialog" aria-label={d.nombre}>
      <button className="municipio-popover__close" onClick={onCerrar} aria-label="Cerrar">✕</button>
      <h3>{d.nombre}</h3><p className="risk-category"><i style={{ background: colorDe(d) || "#d5dbd5" }} />{d.categoria || "Sin asignar"}</p>
      <p>{nombreMapa}</p>
      {catalogo.categorias.find(c => c.nombre === d.categoria)?.descripcion && <p>{catalogo.categorias.find(c => c.nombre === d.categoria).descripcion}</p>}
      {d.iconos?.length > 0 && <p>{d.iconos.map(id => catalogo.iconos?.find(i => i.id === id)?.nombre || id).join(' · ')}</p>}
    </div>} {...props} />;
});
export default RiesgoMap;
