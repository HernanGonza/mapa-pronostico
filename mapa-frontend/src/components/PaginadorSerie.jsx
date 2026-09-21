import { useEffect, useState } from 'react';

/**
 * Paginación horizontal de UN gráfico de series: muestra `ventana` períodos a
 * la vez (empieza en el tramo más reciente) y se recorre con flechas. La última
 * página siempre está completa; la más antigua puede quedar más corta.
 * Sin `ventana` (o con pocos datos) no pagina.
 */
export function useVentana(datos, ventana) {
  const [pagina, setPagina] = useState(Infinity); // Infinity = la más reciente; se acota abajo
  const [todo, setTodo] = useState(false);
  const rotulo = d => d?.clave ?? d?.fecha;
  const firma = `${datos.length}|${rotulo(datos[0])}|${rotulo(datos.at(-1))}`;
  useEffect(() => { setPagina(Infinity); }, [firma]); // dato nuevo (otro rango/estación) → vuelve a lo reciente
  const total = ventana ? Math.max(1, Math.ceil(datos.length / ventana)) : 1;
  // Tramos parejos (42 períodos con ventana 20 → 3 de 14, no 20+20+2), alineados al final.
  const tam = Math.ceil(datos.length / total);
  const activa = total > 1 && !todo;
  const actual = Math.min(pagina, total - 1);
  const fin = datos.length - (total - 1 - actual) * tam;
  const visibles = activa ? datos.slice(Math.max(0, fin - tam), fin) : datos;
  return { visibles, total, activa, actual, todo, ventana: tam, setPagina, setTodo, tramo: `${rotulo(visibles[0])} – ${rotulo(visibles.at(-1))}` };
}

export default function PaginadorSerie({ v, nombre }) {
  if (v.total <= 1) return null;
  return <nav className="historico-paginador" aria-label={`Recorrer ${nombre} por períodos`}>
    <button type="button" className="btn" disabled={!v.activa || v.actual === 0} onClick={() => v.setPagina(v.actual - 1)} aria-label="Tramo anterior (más antiguo)">←</button>
    <span aria-live="polite">{v.todo ? `Todo (${v.total} tramos)` : `${v.tramo} · ${v.actual + 1}/${v.total}`}</span>
    <button type="button" className="btn" disabled={!v.activa || v.actual >= v.total - 1} onClick={() => v.setPagina(v.actual + 1)} aria-label="Tramo siguiente (más reciente)">→</button>
    <button type="button" className="btn btn--ghost" aria-pressed={v.todo} onClick={() => v.setTodo(!v.todo)}>{v.todo ? `De a ${v.ventana}` : 'Ver todo'}</button>
  </nav>;
}
