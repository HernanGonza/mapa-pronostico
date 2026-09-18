import { memo, useLayoutEffect, useRef } from 'react';
import { easeCubicOut, select } from 'd3';
import { interpolatePath } from 'd3-interpolate-path';

function AnimatedPath({ d, ...props }) {
  const ref = useRef(null);
  const previo = useRef(d || '');
  useLayoutEffect(() => {
    const elemento = ref.current;
    if (!elemento) return undefined;
    const selection = select(elemento);
    const comienzo = elemento.getAttribute('d') || d || '';
    selection.interrupt();
    if (!comienzo || !d || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      selection.attr('d', d || '');
    } else {
      selection.transition().duration(550).ease(easeCubicOut)
        .attrTween('d', () => interpolatePath(comienzo, d));
    }
    previo.current = d || '';
    return () => selection.interrupt();
  }, [d]);
  return <path ref={ref} d={previo.current} {...props} />;
}

export default memo(AnimatedPath);
