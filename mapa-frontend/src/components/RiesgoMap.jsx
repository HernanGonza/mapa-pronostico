import { forwardRef, useCallback } from "react";
import BaseMap from "./BaseMap";

export function LeyendaRiesgo({ categorias, titulo = "Riesgo de incendios forestales", fuente = "Clasificación por departamento · Ministerio de Ecología y RNR" }) {
  return <div className="risk-legend">
    <strong>{titulo}</strong>
    <div className="risk-legend__scale">{categorias.map(c => <div key={c.nombre}>
      <i style={{ background: c.color }} /><span title={c.descripcion}>{c.nombre}{c.accion ? ` · ${c.accion}` : ''}</span>
    </div>)}</div>
    <small>{fuente}</small>
  </div>;
}
function LeyendaFenomenos({ iconos, catalogo }) {
  const seleccionados = iconos.flatMap(elegido => {
    const icono = catalogo.iconos?.find(i => i.id === elegido.id);
    const categoria = catalogo.categorias.find(c => c.nombre === elegido.categoria);
    return icono && categoria ? [{ ...icono, categoria }] : [];
  });
  if (!seleccionados.length) return null;
  return <div className="risk-legend weather-legend">
    <strong>Fenómenos meteorológicos</strong>
    <ul>{seleccionados.map(icono => <li key={icono.id}>
      <span className="weather-legend__icon" aria-hidden="true"><img src={`/iconos/alertas/${icono.id}.png`} alt="" /></span>
      <span className="weather-legend__label" style={{ borderBottomColor: icono.categoria.color }}>
        {icono.nombre}<span className="weather-legend__level"> · {icono.categoria.nombre}</span>
      </span>
    </li>)}</ul>
  </div>;
}
const RiesgoMap = forwardRef(function RiesgoMap({ geo, zonas, catalogo, publicadoEn, titulo, iconos = [], ...props }, ref) {
  const esMeteorologica = catalogo.categorias.some(c => c.nombre === "Naranja");
  const nombreMapa = titulo || (esMeteorologica ? "Alertas meteorológicas" : "Riesgo de incendios forestales");
  const colorDe = useCallback(d => catalogo.categorias.find(c => c.nombre === d?.categoria)?.color, [catalogo]);
  const datos = catalogo.departamentos.map(d => ({ ...d, ...zonas.find(z => String(z.id) === String(d.id)) }));
  return <BaseMap ref={ref} poligonos={geo} datos={datos} colorDe={colorDe}
    titulo={nombreMapa} publicadoEn={publicadoEn}
    leyenda={<div className="risk-legends"><LeyendaFenomenos iconos={iconos} catalogo={catalogo} /><LeyendaRiesgo categorias={catalogo.categorias} titulo={nombreMapa}
      fuente={esMeteorologica ? "Fuente: SMN, consulta de modelos y datos meteorológicos, Equipo Técnico de la DGAT" : undefined} /></div>}
    renderInfo={(d, { onCerrar }) => <div className="municipio-popover" role="dialog" aria-label={d.nombre}>
      <button className="municipio-popover__close" onClick={onCerrar} aria-label="Cerrar">✕</button>
      <h3>{d.nombre}</h3><p className="risk-category"><i style={{ background: colorDe(d) || "#d5dbd5" }} />{d.categoria || "Sin asignar"}</p>
      <p>{nombreMapa}</p>
      {catalogo.categorias.find(c => c.nombre === d.categoria)?.descripcion && <p>{catalogo.categorias.find(c => c.nombre === d.categoria).descripcion}</p>}
      {d.iconos?.length > 0 && <p>{d.iconos.map(id => catalogo.iconos?.find(i => i.id === id)?.nombre || id).join(' · ')}</p>}
    </div>} {...props} />;
});
export default RiesgoMap;
