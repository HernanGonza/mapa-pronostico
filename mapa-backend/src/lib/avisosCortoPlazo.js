/**
 * Validación del polígono de un aviso a muy corto plazo: viene del CAP del
 * SMN (elegido de la lista de avisos vigentes) o, si el SMN no publicó
 * polígono para ese aviso, dibujado a mano — en ambos casos el mapa con el
 * polígono viaja capturado como PNG (`imagen`, ver generateAvisoCortoPlazoMap)
 * y queda en la placa; el polígono en sí se guarda aparte para poder volver
 * a mostrarlo (mapa público, historial). La validación es laxa: alcanza con
 * que sean puntos [lng,lat] razonables dentro de Misiones y alrededores, no
 * hace falta que caigan en la provincia exacta (evita rechazar un trazo que
 * roza el límite). El máximo de puntos es alto porque los polígonos CAP del
 * SMN pueden traer bastantes más vértices que un trazo a mano.
 */
const LAT_MIN = -30, LAT_MAX = -22, LNG_MIN = -58, LNG_MAX = -52;
const MAX_PUNTOS = 300;

function errorDePoligono(poligono) {
  if (!Array.isArray(poligono) || poligono.length < 3 || poligono.length > MAX_PUNTOS) {
    return `Dibujá o elegí un polígono de al menos 3 puntos (máximo ${MAX_PUNTOS}).`;
  }
  for (const punto of poligono) {
    if (!Array.isArray(punto) || punto.length !== 2) return "Polígono inválido.";
    const [lng, lat] = punto;
    if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) {
      return "Polígono inválido.";
    }
    if (lat < LAT_MIN || lat > LAT_MAX || lng < LNG_MIN || lng > LNG_MAX) {
      return "El polígono tiene que estar dentro de Misiones y alrededores.";
    }
  }
  return null;
}

const normalizarPoligono = (poligono) => poligono.map(([lng, lat]) => [Number(lng), Number(lat)]);

module.exports = { errorDePoligono, normalizarPoligono };
