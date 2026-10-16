/**
 * Lector de puntos de GRIB1 con empaquetado simple de 16 bits SIN COMPRIMIR (el que usa el BAM del CPTEC/INPE): como cada valor ocupa
 * exactamente 2 bytes en un lugar que se calcula, un punto se lee con un pedido de 2 bytes y no hace falta bajar el campo (4 MB) ni el archivo (1,5 GB).
 *
 *   valor = (R + X · 2^E) / 10^D       X = entero de 16 bits; R, E y D están en el encabezado de CADA mensaje (cambian de uno a otro)
 *
 * Detalle del BAM: el encabezado dice que la latitud va de −90° a +90° pero los datos vienen con el NORTE primero (bit 0x40 del modo de recorrido
 * apagado = las filas bajan). Se verificó: Posadas a las 9 h da ≈15 °C leyéndolo así y 28,7 °C (imposible) al derecho.
 */
const u16 = (b, p) => (b[p] << 8) | b[p + 1];
const u24 = (b, p) => (b[p] << 16) | (b[p + 1] << 8) | b[p + 2];
const s24 = (b, p) => { const v = u24(b, p); return v & 0x800000 ? -(v & 0x7fffff) : v; }; // signo y magnitud
const s16 = (b, p) => { const v = u16(b, p); return v & 0x8000 ? -(v & 0x7fff) : v; };

/** Float IBM de 32 bits (así guarda GRIB1 el valor de referencia). */
function ibm32(b, p) {
  const v = b.readUInt32BE(p), signo = v >>> 31 ? -1 : 1, exp = (v >>> 24) & 0x7f, man = v & 0xffffff;
  return signo * (man / 16777216) * 16 ** (exp - 64);
}

/** Bytes del principio de un mensaje que hacen falta para entender su encabezado (indicador 8 + PDS 28 + GDS 32 + BDS 11, con holgura). */
const BYTES_ENCABEZADO = 160;

/**
 * El encabezado de un mensaje GRIB1 (los primeros BYTES_ENCABEZADO bytes) → { escalaD, ni, nj, la1, la2, di, scan, ref, escalaE, bits, inicioDatos }
 * (`inicioDatos` = byte donde empiezan los valores, relativo al comienzo del mensaje).
 */
function leerEncabezado(b) {
  if (b.toString("latin1", 0, 4) !== "GRIB" || b[7] !== 1) throw new Error("No es un mensaje GRIB1.");
  const pdsLargo = u24(b, 8), flags = b[8 + 7];
  if (!(flags & 0x80)) throw new Error("GRIB1: el mensaje no trae la descripción de la rejilla.");
  if (flags & 0x40) throw new Error("GRIB1: el mensaje trae mapa de bits (no soportado para lectura por punto).");
  const escalaD = s16(b, 8 + 26), g = 8 + pdsLargo, gdsLargo = u24(b, g);
  if (b[g + 5] !== 0) throw new Error(`GRIB1: rejilla de tipo ${b[g + 5]} no soportada (sólo lat/lon regular).`);
  const q = g + gdsLargo, bits = b[q + 10];
  if (bits !== 16 || (b[q + 3] & 0xf0) !== 0) throw new Error("GRIB1: se esperaba empaquetado simple de 16 bits sin datos adicionales.");
  return {
    escalaD, ni: u16(b, g + 6), nj: u16(b, g + 8), la1: s24(b, g + 10) / 1000, la2: s24(b, g + 17) / 1000, lo1: s24(b, g + 13) / 1000,
    di: u16(b, g + 23) / 1000, scan: b[g + 27], ref: ibm32(b, q + 6), escalaE: s16(b, q + 4), bits, inicioDatos: q + 11,
  };
}

/**
 * Qué bytes pedir para interpolar en (lat, lng): { rangos: [[desde, fin], [desde, fin]] (relativos al mensaje, una fila cada uno), peso (para `interpolar`) }.
 * Lee 2 columnas de 2 filas (4 vecinos). Devuelve null si el punto cae fuera de la rejilla.
 */
function planDePunto(e, lat, lng) {
  const lon = ((lng % 360) + 360) % 360, norte = Math.max(e.la1, e.la2), sur = Math.min(e.la1, e.la2);
  const dj = (norte - sur) / (e.nj - 1); // las latitudes van de polo a polo en nj puntos
  const filasBajan = !(e.scan & 0x40);
  const fi = lon / e.di, fj = filasBajan ? (norte - lat) / dj : (lat - sur) / dj;
  const i0 = Math.floor(fi), j0 = Math.floor(fj);
  if (j0 < 0 || j0 + 1 >= e.nj || i0 < 0 || i0 + 1 >= e.ni) return null;
  const desde = (j) => e.inicioDatos + (j * e.ni + i0) * 2;
  return { rangos: [[desde(j0), desde(j0) + 3], [desde(j0 + 1), desde(j0 + 1) + 3]], x: fi - i0, y: fj - j0 };
}

/** Los dos tramos leídos (4 bytes = 2 valores cada uno) → valor interpolado (en las unidades del campo). */
function interpolar(e, plan, tramos) {
  const v = (b, k) => (e.ref + b.readUInt16BE(2 * k) * 2 ** e.escalaE) / 10 ** e.escalaD;
  const a = v(tramos[0], 0), b = v(tramos[0], 1), c = v(tramos[1], 0), d = v(tramos[1], 1), { x, y } = plan;
  return a * (1 - x) * (1 - y) + b * x * (1 - y) + c * (1 - x) * y + d * x * y;
}

module.exports = { leerEncabezado, planDePunto, interpolar, ibm32, BYTES_ENCABEZADO };
