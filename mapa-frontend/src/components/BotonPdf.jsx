import { useState } from 'react';
import { exportarElementoPdf } from '../lib/exportarPdf';

export default function BotonPdf({ elementoRef, titulo }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  return <span className="historico-exportar">
    <button type="button" disabled={ocupado} onClick={async () => {
      if (!elementoRef.current) return;
      setOcupado(true); setError('');
      try { await exportarElementoPdf(elementoRef.current, titulo); }
      catch (e) { setError(e.message || 'No se pudo exportar'); }
      finally { setOcupado(false); }
    }}>{ocupado ? 'Generando…' : 'PDF'}</button>
    {error && <small role="alert">{error}</small>}
  </span>;
}
