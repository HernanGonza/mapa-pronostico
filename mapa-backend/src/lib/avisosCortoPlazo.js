/**
 * Validación del polígono que el operador dibuja a mano sobre el mapa
 * (avisos a muy corto plazo). El mapa con el polígono viaja capturado
 * como PNG (`imagen`, ver generateAlertaMap.generateRecomendaciones) y
 * queda en la placa — el polígono en sí se guarda aparte para poder
 * volver a mostrarlo (mapa público, historial). La validación es laxa:
 * alcanza con que sean puntos [lng,lat] razonables dentro de Misiones y
 * alrededores, no hace falta que caigan en la provincia exacta (evita
 * rechazar un trazo que roza el límite).
 */
const LAT_MIN = -30, LAT_MAX = -22, LNG_MIN = -58, LNG_MAX = -52;

function errorDePoligono(poligono) {
  if (!Array.isArray(poligono) || poligono.length < 3 || poligono.length > 60) {
    return "Dibujá un polígono de al menos 3 puntos (máximo 60).";
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
