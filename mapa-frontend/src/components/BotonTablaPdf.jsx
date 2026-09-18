import { useState } from 'react';
import { exportarTablaPdf } from '../lib/exportarPdf';

export default function BotonTablaPdf({ titulo, nombre, columnas, filas, disabled = false }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  return <span className="historico-exportar">
    <button type="button" disabled={ocupado || disabled} onClick={async () => {
      setOcupado(true); setError('');
      try { await exportarTablaPdf({ titulo, nombre, columnas, filas }); }
      catch (e) { setError(e.message || 'No se pudo generar el PDF'); }
      finally { setOcupado(false); }
    }}>{ocupado ? 'Generando PDF…' : 'Exportar PDF'}</button>
    {error && <small role="alert">{error}</small>}
  </span>;
}
