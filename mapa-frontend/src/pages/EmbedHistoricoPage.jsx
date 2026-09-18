import { useEffect, useMemo, useState } from 'react';
import HistoricoEstaciones from '../components/HistoricoEstaciones';
import { getEventosClimaticosPublicos } from '../api';

export default function EmbedHistoricoPage() {
  const [eventos, setEventos] = useState(null);
  const [error, setError] = useState('');
  const [tipo, setTipo] = useState('');

  useEffect(() => {
    let activo = true;
    const cargar = () => getEventosClimaticosPublicos()
      .then(r => { if (activo) setEventos(r.eventos); })
      .catch(e => { if (activo) setError(e.message); });
    cargar();
    const timer = setInterval(cargar, 15 * 60 * 1000);
    return () => { activo = false; clearInterval(timer); };
  }, []);

  const tipos = useMemo(() => [...new Set((eventos || []).map(e => e.tipo).filter(Boolean))].sort(), [eventos]);
  const visibles = useMemo(() => (eventos || []).filter(e => !tipo || e.tipo === tipo), [eventos, tipo]);

  return <main className="historico-embed">
    <HistoricoEstaciones publico />
    <section className="historico-embed__eventos">
      <div className="historico-embed__encabezado">
        <div><h2>Eventos meteorológicos</h2><p>Registros publicados por el equipo de Alerta Temprana.</p></div>
        <label className="field"><span>Tipo de evento</span><select value={tipo} onChange={e => setTipo(e.target.value)}>
          <option value="">Todos</option>{tipos.map(t => <option key={t} value={t}>{t}</option>)}
        </select></label>
      </div>
      {error && <p className="embed-warning" role="alert">{error}</p>}
      {eventos === null ? <p role="status">Cargando eventos…</p> : visibles.length === 0 ? <p>No hay eventos publicados para este filtro.</p> :
        <ul className="historico-embed__lista">{visibles.map(ev => <li key={ev.id}>
          {ev.imagenes?.[0] && <img src={ev.imagenes[0].url} alt="" />}
          <div><strong>{ev.titulo}</strong><p>{ev.fechaInicio}{ev.departamento && ` · ${ev.departamento}`}</p><p>{ev.descripcion}</p></div>
        </li>)}</ul>}
    </section>
  </main>;
}
