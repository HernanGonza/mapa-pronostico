import { arc, scaleLinear } from 'd3';
import { useRef } from 'react';
import { BANDAS, DIRECCIONES, resumirRosa } from '../lib/rosaVientos';
import BotonPdf from './BotonPdf';
import AnimatedPath from './AnimatedPath';

// Rosa polar basada en el componente radar de Rosen Charts.
// Fuente: https://rosencharts.com/r/radar-charts.json
export default function RosaVientos({ filas, nombre }) {
  const exportRef = useRef(null);
  const { validos, calmas, porcentajes, maximo } = resumirRosa(filas);
  if (!validos) return <section className="historico-metrica"><h3>Rosa de los vientos máximos</h3><p className="historico-metrica__vacio">Sin observaciones conjuntas de dirección e intensidad en este período.</p></section>;
  const escala = scaleLinear().domain([0, Math.max(5, Math.ceil(maximo / 5) * 5)]).range([0, 115]);
  const marcas = escala.ticks(4).filter(x => x > 0);
  const sectorAngular = Math.PI * 2 / 16;
  const segmentos = [];
  porcentajes.forEach((fila, direccion) => {
    let acumulado = 0;
    fila.forEach((porcentaje, banda) => {
      const desde = acumulado;
      acumulado += porcentaje;
      segmentos.push({ direccion, banda, porcentaje, desde, hasta: acumulado });
    });
  });
  const forma = arc().startAngle(d => d.direccion * sectorAngular - sectorAngular * 0.45)
    .endAngle(d => d.direccion * sectorAngular + sectorAngular * 0.45)
    .innerRadius(d => escala(d.desde)).outerRadius(d => escala(d.hasta));

  return <section ref={exportRef} className="historico-metrica historico-rosa">
    <div className="historico-metrica__header"><h3>Rosa de los vientos máximos</h3><div><span>{nombre}</span><BotonPdf elementoRef={exportRef} titulo={`Rosa de los vientos máximos · ${nombre}`} /></div></div>
    <p className="historico-observatorio__nota">Frecuencia del rumbo del viento máximo diario, clasificada por su velocidad. Incluye {validos.toLocaleString('es-AR')} días con ambos datos; {calmas.toLocaleString('es-AR')} calmas. Porcentaje sobre esos días.</p>
    <div className="historico-rosa__contenido">
      <svg viewBox="-150 -150 300 300" role="img" aria-label={`Rosa de los vientos máximos de ${nombre}`}>
        {marcas.map(marca => <g key={marca}>
          <circle r={escala(marca)} className="historico-rosa__malla" />
          <text x={-escala(marca) - 3} y="-2" textAnchor="end" className="historico-rosa__marca">{marca}%</text>
        </g>)}
        {DIRECCIONES.map((direccion, i) => {
          const angulo = i * sectorAngular - Math.PI / 2;
          return <g key={direccion}>
            <line x2={Math.cos(angulo) * 115} y2={Math.sin(angulo) * 115} className="historico-rosa__malla" />
            <text x={Math.cos(angulo) * 136} y={Math.sin(angulo) * 136 + 3} textAnchor="middle" className="historico-rosa__direccion">{direccion}</text>
          </g>;
        })}
        {segmentos.map(d => <AnimatedPath key={`${d.direccion}-${d.banda}`} d={forma(d) || ''} fill={BANDAS[d.banda].color} stroke="var(--surface)" strokeWidth="0.5">
          <title>{DIRECCIONES[d.direccion]} · {BANDAS[d.banda].nombre}: {d.porcentaje.toLocaleString('es-AR', { maximumFractionDigits: 2 })}%</title>
        </AnimatedPath>)}
      </svg>
      <ul className="historico-rosa__leyenda">{BANDAS.map(b => <li key={b.nombre}><i style={{ background: b.color }} />{b.nombre}</li>)}</ul>
    </div>
    <p className="historico-observatorio__nota">Inspirada en la figura 13 del Atlas Climático de Argentina (SMN, NEA). Esta rosa usa el máximo diario y el rango elegido; la figura del atlas usa estadísticas de viento del período 2011–2020. Velocidades convertidas de m/s a km/h.</p>
  </section>;
}
