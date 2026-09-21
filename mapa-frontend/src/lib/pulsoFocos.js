/**
 * Curva del pulso de los focos de calor: un aro que sale del punto y se expande de adentro hacia afuera.
 * `fase` va de 0 a 1 en cada ciclo y, al reiniciar, vuelve a 0. Para que el reinicio no se note:
 *  - la opacidad SUBE suave al principio y BAJA suave al final (smoothstep: llega a 0 con pendiente 0
 *    en los dos extremos), así el aro nace y muere transparente en vez de "aparecer" de golpe;
 *  - el radio se desacelera al expandirse (sale rápido y frena), como una onda que se disipa.
 * Con opacidad 0 en 0 y en 1, el salto del radio al reiniciar es invisible.
 */
export const CICLO_MS = 2000;
export const RADIO_INICIAL = 9;
export const RADIO_EXPANSION = 17;
export const OPACIDAD_MAXIMA = 0.42;
const APARICION = 0.2; // fracción del ciclo en que el aro termina de aparecer

const suave = (t) => t * t * (3 - 2 * t);

export function pulsoDeFoco(fase) {
  const f = Math.min(1, Math.max(0, fase));
  const radio = RADIO_INICIAL + RADIO_EXPANSION * (1 - Math.pow(1 - f, 2.2));
  const opacidad = OPACIDAD_MAXIMA * suave(Math.min(1, f / APARICION)) * (1 - suave(f));
  return { radio, opacidad };
}
