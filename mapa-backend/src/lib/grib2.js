/**
 * Lector mínimo de GRIB2 (lo que hace falta para los modelos del INPE que no se pueden leer por punto): un mensaje suelto → su rejilla
 * regular lat/lon y los valores. Soporta las plantillas de empaquetado 5.0 (simple) y 5.3 (complejo con diferencias espaciales, que es el
 * que usa el Eta 8 km), con o sin mapa de bits. Está probado contra ecCodes (ver test/grib2.test.js).
 *
 * Nada de esto toca la red: recibe el mensaje ya descargado (Buffer). Los octetos de los comentarios son los de la norma WMO FM 92 GRIB2
 * (numerados desde 1 dentro de cada sección).
 */

const u8 = (b, p) => b[p];
const u16 = (b, p) => (b[p] << 8) | b[p + 1];
const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
/** Entero con signo en «signo y magnitud» (así guarda GRIB2 las latitudes, longitudes y las escalas). */
const sm = (b, p, n) => {
  let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i];
  const neg = Math.floor(v / 2 ** (8 * n - 1)) % 2 === 1;
  return neg ? -(v - 2 ** (8 * n - 1)) : v;
};

/** Lee `n` bits (n ≤ 32) desde la posición `pos` (en bits) de `buf`. */
function bits(buf, pos, n) {
  if (n === 0) return 0;
  let v = 0, resto = n, p = pos;
  while (resto > 0) {
    const disponibles = 8 - (p & 7), toma = Math.min(disponibles, resto);
    v = v * 2 ** toma + ((buf[p >> 3] >> (disponibles - toma)) & ((1 << toma) - 1));
    p += toma; resto -= toma;
  }
  return v;
}

/** Decodifica la sección 7 según la sección 5. Devuelve Float64Array con `n` valores (NaN = faltante). */
function desempaquetar(s5, s7, n) {
  const plantilla = u16(s5, 9);
  const R = Buffer.from(s5.subarray(11, 15)).readFloatBE(0), E = sm(s5, 15, 2), D = sm(s5, 17, 2), escalaE = 2 ** E, escalaD = 10 ** -D;
  const datos = s7.subarray(5); // lo que sigue al encabezado de la sección 7
  const valores = new Float64Array(n);
  if (plantilla === 0) { // simple
    const nb = u8(s5, 19);
    if (nb === 0) { valores.fill(R * escalaD); return valores; }
    for (let i = 0; i < n; i++) valores[i] = (R + bits(datos, i * nb, nb) * escalaE) * escalaD;
    return valores;
  }
  if (plantilla !== 3) throw new Error(`GRIB2: plantilla de empaquetado ${plantilla} no soportada (sólo 0 y 3).`);

  const nbRef = u8(s5, 19), faltantes = u8(s5, 22), NG = u32(s5, 31), anchoRef = u8(s5, 35), nbAncho = u8(s5, 36);
  const largoRef = u32(s5, 37), largoInc = u8(s5, 41), ultimoLargo = u32(s5, 42), nbLargo = u8(s5, 46), orden = u8(s5, 47), nbExtra = u8(s5, 48);
  let p = 0; // posición en bytes dentro de `datos`
  const extras = [];
  for (let i = 0; i < orden; i++) { extras.push(sm(datos, p, nbExtra)); p += nbExtra; }
  const minimo = orden > 0 ? sm(datos, p, nbExtra) : 0; if (orden > 0) p += nbExtra;

  let bit = p * 8;
  const leerLista = (cantidad, ancho) => {
    const r = new Array(cantidad);
    for (let i = 0; i < cantidad; i++) { r[i] = bits(datos, bit, ancho); bit += ancho; }
    bit = Math.ceil(bit / 8) * 8; // cada lista termina en un byte entero
    return r;
  };
  const refs = leerLista(NG, nbRef), anchos = leerLista(NG, nbAncho).map((a) => a + anchoRef), largos = leerLista(NG, nbLargo).map((l, i) => (i === NG - 1 ? ultimoLargo : largoRef + l * largoInc));

  const enteros = new Float64Array(n), esFaltante = faltantes ? new Uint8Array(n) : null;
  let k = 0;
  for (let g = 0; g < NG; g++) {
    const w = anchos[g], ref = refs[g], L = largos[g];
    if (k + L > n) throw new Error("GRIB2: los grupos suman más valores de los que declara la sección 5.");
    if (w === 0) {
      const falta = faltantes && ref === 2 ** nbRef - 1;
      for (let i = 0; i < L; i++, k++) { enteros[k] = ref; if (falta) esFaltante[k] = 1; }
    } else {
      const todosUnos = 2 ** w - 1;
      for (let i = 0; i < L; i++, k++) {
        const x = bits(datos, bit, w); bit += w;
        if (faltantes && x === todosUnos) esFaltante[k] = 1; else enteros[k] = ref + x;
      }
    }
  }
  if (k !== n) throw new Error(`GRIB2: se leyeron ${k} valores y la sección 5 declara ${n}.`);

  // Las diferencias espaciales se aplican sólo sobre los valores que existen: los faltantes quedan afuera de la secuencia.
  const posiciones = esFaltante ? Array.from({ length: n }, (_, i) => i).filter((i) => !esFaltante[i]) : null;
  const m = posiciones ? posiciones.length : n, en = (j) => (posiciones ? posiciones[j] : j);
  if (orden === 1 && m > 0) { // y[0] = g1; y[i] = x[i] + mínimo + y[i-1]
    enteros[en(0)] = extras[0];
    for (let j = 1; j < m; j++) enteros[en(j)] = enteros[en(j)] + minimo + enteros[en(j - 1)];
  } else if (orden === 2 && m > 1) { // y[0] = g1, y[1] = g2; y[i] = x[i] + mínimo + 2·y[i-1] − y[i-2]
    enteros[en(0)] = extras[0]; enteros[en(1)] = extras[1];
    for (let j = 2; j < m; j++) enteros[en(j)] = enteros[en(j)] + minimo + 2 * enteros[en(j - 1)] - enteros[en(j - 2)];
  }
  for (let i = 0; i < n; i++) valores[i] = esFaltante?.[i] ? NaN : (R + enteros[i] * escalaE) * escalaD;
  return valores;
}

/**
 * Un mensaje GRIB2 completo → { disciplina, categoria, numero, nivelTipo, nivelValor, ni, nj, la1, lo1, la2, lo2, di, dj, scan, valores }.
 * Con `soloEncabezado` no desempaqueta los valores (sirve para reconocer qué campo es).
 */
function leerMensaje(buf, { soloEncabezado = false } = {}) {
  if (buf.length < 20 || buf.toString("latin1", 0, 4) !== "GRIB" || u8(buf, 7) !== 2) throw new Error("No es un mensaje GRIB2.");
  const m = { disciplina: u8(buf, 6) };
  let p = 16, s3, s5, s6, s7;
  while (p + 5 <= buf.length) {
    if (buf.toString("latin1", p, p + 4) === "7777") break;
    const largo = u32(buf, p), sec = u8(buf, p + 4);
    if (sec === 1) m.referencia = new Date(Date.UTC(u16(buf, p + 12), u8(buf, p + 14) - 1, u8(buf, p + 15), u8(buf, p + 16), u8(buf, p + 17), u8(buf, p + 18)));
    if (sec === 3) s3 = buf.subarray(p, p + largo);
    if (sec === 4) {
      m.plantilla4 = u16(buf, p + 7);
      m.categoria = u8(buf, p + 9); m.numero = u8(buf, p + 10);
      m.nivelTipo = u8(buf, p + 22); const esc = u8(buf, p + 23); m.nivelValor = esc === 255 ? null : sm(buf, p + 24, 4) / 10 ** (esc & 0x7f) * (esc & 0x80 ? -1 : 1);
      if (m.plantilla4 === 8) { // intervalo de tiempo estadístico: «acumulado de 6 h», «máximo de la última hora»…
        m.proceso = u8(buf, p + 46); // 0 promedio, 1 acumulado, 2 máximo, 3 mínimo
        m.largoRangoHoras = u8(buf, p + 48) === 1 ? u32(buf, p + 49) : null; // largo del intervalo, si está en horas
      }
      m.horasPronostico = u8(buf, p + 17) === 1 ? u32(buf, p + 18) : null; // «hora de pronóstico» (unidad 1 = horas)
    }
    if (sec === 5) s5 = buf.subarray(p, p + largo);
    if (sec === 6) s6 = buf.subarray(p, p + largo);
    if (sec === 7) s7 = buf.subarray(p, p + largo);
    p += largo;
  }
  if (!s3 || !s5 || !s7) throw new Error("GRIB2: faltan secciones en el mensaje.");
  if (u16(s3, 12) !== 0) throw new Error(`GRIB2: plantilla de rejilla ${u16(s3, 12)} no soportada (sólo lat/lon regular).`);
  Object.assign(m, { ni: u32(s3, 30), nj: u32(s3, 34), la1: sm(s3, 46, 4) / 1e6, lo1: sm(s3, 50, 4) / 1e6, la2: sm(s3, 55, 4) / 1e6, lo2: sm(s3, 59, 4) / 1e6, di: u32(s3, 63) / 1e6, dj: u32(s3, 67) / 1e6, scan: u8(s3, 71) });
  if (soloEncabezado) return m;
  const total = u32(s5, 5), n = m.ni * m.nj;
  const crudos = desempaquetar(s5, s7, total);
  if (s6 && u8(s6, 5) === 0) { // mapa de bits: los puntos con 0 no tienen valor
    const mapa = s6.subarray(6), valores = new Float64Array(n).fill(NaN);
    let j = 0; for (let i = 0; i < n; i++) if ((mapa[i >> 3] >> (7 - (i & 7))) & 1) valores[i] = crudos[j++];
    m.valores = valores;
  } else if (total !== n) throw new Error(`GRIB2: ${total} valores para una rejilla de ${n} puntos.`);
  else m.valores = crudos;
  return m;
}

/**
 * Sólo QUÉ campo es un mensaje, leyendo apenas su principio (unos 220 bytes alcanzan: secciones 0 a 4):
 * { largo (bytes del mensaje), categoria, numero, nivelTipo, nivelValor, proceso, largoRangoHoras, horasPronostico }.
 */
function identificar(buf) {
  if (buf.length < 20 || buf.toString("latin1", 0, 4) !== "GRIB" || u8(buf, 7) !== 2) throw new Error("No es un mensaje GRIB2.");
  const m = { largo: Number(buf.readBigUInt64BE(8)), disciplina: u8(buf, 6) };
  let p = 16;
  while (p + 5 <= buf.length) {
    const largo = u32(buf, p), sec = u8(buf, p + 4);
    if (sec === 4) {
      if (p + 60 > buf.length) throw new Error("GRIB2: encabezado incompleto.");
      m.categoria = u8(buf, p + 9); m.numero = u8(buf, p + 10);
      m.nivelTipo = u8(buf, p + 22); const esc = u8(buf, p + 23); m.nivelValor = esc === 255 ? null : sm(buf, p + 24, 4) / 10 ** (esc & 0x7f) * (esc & 0x80 ? -1 : 1);
      if (u16(buf, p + 7) === 8) { m.proceso = u8(buf, p + 46); m.largoRangoHoras = u8(buf, p + 48) === 1 ? u32(buf, p + 49) : null; }
      m.horasPronostico = u8(buf, p + 17) === 1 ? u32(buf, p + 18) : null;
      return m;
    }
    p += largo;
  }
  throw new Error("GRIB2: el encabezado no llega a la sección 4.");
}

/**
 * Valor en (lat, lng) por interpolación bilineal entre los 4 puntos vecinos de la rejilla `m` (de leerMensaje); null si cae fuera.
 * Respeta el sentido de recorrido: bit 0x80 = las columnas van de este a oeste, bit 0x40 = las filas van de sur a norte.
 */
function valorEn(m, lat, lng) {
  const lon = ((lng % 360) + 360) % 360, lo1 = ((m.lo1 % 360) + 360) % 360;
  const columnasHaciaEste = !(m.scan & 0x80), filasHaciaNorte = !!(m.scan & 0x40);
  const fi = ((lon - lo1 + 360) % 360) / m.di * (columnasHaciaEste ? 1 : -1), fj = (lat - m.la1) / m.dj * (filasHaciaNorte ? 1 : -1);
  const i0 = Math.floor(fi), j0 = Math.floor(fj);
  if (i0 < 0 || j0 < 0 || i0 + 1 >= m.ni || j0 + 1 >= m.nj) return null;
  const x = fi - i0, y = fj - j0, v = (i, j) => m.valores[j * m.ni + i];
  const a = v(i0, j0), b = v(i0 + 1, j0), c = v(i0, j0 + 1), d = v(i0 + 1, j0 + 1);
  if ([a, b, c, d].some(Number.isNaN)) return null;
  return a * (1 - x) * (1 - y) + b * x * (1 - y) + c * (1 - x) * y + d * x * y;
}

module.exports = { leerMensaje, identificar, valorEn, desempaquetar, bits };
