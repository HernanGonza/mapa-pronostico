import HistoricoMetricChart from './HistoricoMetricChart';

const SERIES = [
  { campo: 'tmax', nombre: 'TMAX', color: '#dd6175' },
  { campo: 'tmin', nombre: 'TMIN', color: '#5aa8e8' },
];

export default function SerieClimaticaChart({ serie }) {
  return <div className="historico-chart-wrap">
    <HistoricoMetricChart titulo="Temperaturas del pronóstico diario" subtitulo="Por día" datos={serie || []} series={SERIES} unidad="°C" />
  </div>;
}
