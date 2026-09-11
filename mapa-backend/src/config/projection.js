/**
 * Transformación lat/lng -> píxel sobre el basemap.png actual (2250x2813).
 *
 * El basemap es una ilustración (no un render GIS), así que no hay una
 * proyección "real" que la explique — esto es un ajuste afín por cuadrados
 * mínimos, calibrado contra los 13 puntos que están dibujados a mano en la
 * imagen (mismas 13 estaciones de coordinates.js/anchorX/anchorY, cuya
 * posición de píxel se midió directo sobre el PNG). Sirve para ubicar
 * cualquier lat/lng sobre esta imagen — lo usa generateMap.js para pintar
 * los polígonos de municipios.geojson con el color de su condición.
 *
 * Si se reemplaza basemap.png por una ilustración nueva, hay que
 * recalibrar: medir de nuevo los 13 puntos sobre la imagen nueva y volver
 * a resolver el ajuste (cuadrados mínimos con las mismas 13 lat/lng reales,
 * ver data/municipios.json).
 */
const AX = 664.2678729669738;
const BX = -18.723363782062677;
const CX = 37161.96431940754;
const AY = 19.823422752425927;
const BY = -772.7581812937495;
const CY = -18272.30957305528;

function proyectar(lat, lng) {
  return {
    x: AX * lng + BX * lat + CX,
    y: AY * lng + BY * lat + CY,
  };
}

module.exports = { proyectar };
