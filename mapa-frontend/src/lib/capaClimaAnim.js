/**
 * Capa de clima ANIMADA (nubosidad / lluvia) estilo mapa del tiempo de TV.
 *
 * - El campo de cobertura (nubes % o lluvia mm) sale de la grilla real de
 *   Open-Meteo e interpola en el tiempo (hora fraccionaria) → mapa "en vivo".
 * - Una textura de ruido fractal le da detalle y SE DESPLAZA en la
 *   dirección del viento real de cada zona: se ven las nubes/lluvias
 *   entrando y saliendo de la provincia.
 * - Los bordes se desvanecen (feather): no se ve un cuadrado al alejarse.
 * - Se dibuja en un canvas propio que MapLibre monta como `canvas` source
 *   (`animate: true`) y reproyecta solo, en globo o plano.
 */

import { rampa, RAMPAS, clamp } from "./campoClima";

const RES = 128; // resolución del canvas de la capa (se suaviza al escalar)
const FPS = 15; // las nubes/lluvia derivan lento; 15 fps alcanza y sobra
const DERIVA_PX_POR_MS = 0.0016; // deriva de la textura por ms y por (m/s)
const ESCALA_RUIDO = 2.1; // "zoom" de la textura: bajo = nubes más grandes
const MARGEN = 0.13;

const CAMPO = { nubes: "cloud", lluvia: "precip" };

function suavizar(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

/* --- Campo de ruido fractal PRECALCULADO y tileable ---
 * Antes se calculaba `fractal()` (3 octavas × 4 hashes) por pixel y por
 * frame = ~2 M ops/frame → el mapa iba a 19 fps. Ahora se genera UNA vez un
 * tile de ruido y en cada frame se hace un lookup bilineal (barato). El
 * tile es seamless (período entero) para poder repetirlo con la deriva. */
const RUIDO_N = 256; // resolución del tile
const RUIDO_P = 4; // celdas de ruido por tile (período)

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

let RUIDO = null;
function campoRuido() {
  if (RUIDO) return RUIDO;
  const buf = new Float32Array(RUIDO_N * RUIDO_N);
  const P = RUIDO_P;
  const wrap = (v) => ((v % P) + P) % P;
  const hP = (x, y) => hash2(wrap(x), wrap(y));
  const rv = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const w = yf * yf * (3 - 2 * yf);
    const a = hP(xi, yi);
    const b = hP(xi + 1, yi);
    const c = hP(xi, yi + 1);
    const d = hP(xi + 1, yi + 1);
    return a * (1 - u) * (1 - w) + b * u * (1 - w) + c * (1 - u) * w + d * u * w;
  };
  const fr = (x, y) => {
    let amp = 0.55;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < 3; o++) {
      sum += amp * rv((x * freq) % P, (y * freq) % P);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
  for (let y = 0; y < RUIDO_N; y++) {
    for (let x = 0; x < RUIDO_N; x++) {
      buf[y * RUIDO_N + x] = fr((x / RUIDO_N) * P, (y / RUIDO_N) * P);
    }
  }
  RUIDO = buf;
  return buf;
}

export class CapaClimaAnimada {
  /**
   * @param {maplibregl.Map} map
   * @param {HTMLCanvasElement} canvas  canvas propio (fuera del DOM)
   * @param {object} grilla  { bounds, grid, horas, puntos }
   * @param {"nubes"|"lluvia"} capa
   * @param {() => number} horaGetter  índice de hora (puede ser fraccionario)
   */
  constructor(map, canvas, grilla, capa, horaGetter) {
    this.map = map;
    this.canvas = canvas;
    this.canvas.width = RES;
    this.canvas.height = RES;
    this.ctx = canvas.getContext("2d", { willReadFrequently: true });
    this.capa = capa;
    this.campo = CAMPO[capa];
    this.paradas = RAMPAS[capa];
    this.horaGetter = horaGetter || (() => 0);
    this.img = this.ctx.createImageData(RES, RES);
    this._feather = this._calcFeather();
    this._ruido = campoRuido();
    // LUT de la rampa de color (128 pasos) para no llamar `rampa()` por
    // pixel y por frame.
    this._rampaMax = capa === "lluvia" ? 45 : 100;
    this._lut = new Float32Array(128 * 4);
    for (let i = 0; i < 128; i++) {
      const c = rampa(this.paradas, (i / 127) * this._rampaMax);
      this._lut[i * 4] = c[0];
      this._lut[i * 4 + 1] = c[1];
      this._lut[i * 4 + 2] = c[2];
      this._lut[i * 4 + 3] = c[3];
    }
    this.actualizarGrilla(grilla);
    this.t0 = performance.now();
    this._last = 0;
    this.running = false;
  }

  get coordinates() {
    const { latMin, latMax, lngMin, lngMax } = this.b;
    return [
      [lngMin, latMax],
      [lngMax, latMax],
      [lngMax, latMin],
      [lngMin, latMin],
    ];
  }

  _calcFeather() {
    const f = new Float32Array(RES * RES);
    for (let py = 0; py < RES; py++) {
      const fy = Math.min(py, RES - 1 - py) / (RES * MARGEN);
      for (let px = 0; px < RES; px++) {
        const fx = Math.min(px, RES - 1 - px) / (RES * MARGEN);
        f[py * RES + px] = suavizar(fx) * suavizar(fy);
      }
    }
    return f;
  }

  actualizarGrilla(grilla) {
    this.grilla = grilla;
    this.n = grilla.grid;
    this.b = grilla.bounds;
    this._cache = new Map();
    this._camposCache = null;
    this._camposHf = -999;
  }

  /** Campo (cobertura + viento) upsampleado a RES para una hora entera. */
  _campoHora(h) {
    const cached = this._cache.get(h);
    if (cached) return cached;
    const n = this.n;
    const s = new Float32Array(RES * RES);
    const u = new Float32Array(RES * RES);
    const v = new Float32Array(RES * RES);
    const val = (arr, i, j) => {
      const p = this.grilla.puntos[i * n + j];
      const src = p[arr];
      return src ? src[h] ?? 0 : 0;
    };
    for (let py = 0; py < RES; py++) {
      const fi = ((RES - 1 - py) / (RES - 1)) * (n - 1);
      const i0 = clamp(Math.floor(fi), 0, n - 2);
      const ti = fi - i0;
      for (let px = 0; px < RES; px++) {
        const fj = (px / (RES - 1)) * (n - 1);
        const j0 = clamp(Math.floor(fj), 0, n - 2);
        const tj = fj - j0;
        const bil = (arr) => {
          const a = val(arr, i0, j0) * (1 - tj) + val(arr, i0, j0 + 1) * tj;
          const b = val(arr, i0 + 1, j0) * (1 - tj) + val(arr, i0 + 1, j0 + 1) * tj;
          return a * (1 - ti) + b * ti;
        };
        const o = py * RES + px;
        s[o] = bil(this.campo);
        u[o] = bil("windU");
        v[o] = bil("windV");
      }
    }
    const campo = { s, u, v };
    if (this._cache.size > 6) this._cache.clear();
    this._cache.set(h, campo);
    return campo;
  }

  /** Campos interpolados para una hora fraccionaria. Cacheado: la hora
   *  cambia lentísimo, no hace falta rearmar 3 arrays de 25k cada frame. */
  _campos(hf) {
    if (this._camposCache && Math.abs(hf - this._camposHf) < 0.04) {
      return this._camposCache;
    }
    const maxH = this.grilla.horas.length - 1;
    const h = clamp(hf, 0, maxH);
    const h0 = Math.floor(h);
    const h1 = Math.min(maxH, h0 + 1);
    const w = h - h0;
    let res;
    if (w < 0.02 || h0 === h1) {
      res = this._campoHora(h0);
    } else {
      const a = this._campoHora(h0);
      const b = this._campoHora(h1);
      const s = new Float32Array(RES * RES);
      const u = new Float32Array(RES * RES);
      const v = new Float32Array(RES * RES);
      for (let k = 0; k < s.length; k++) {
        s[k] = a.s[k] * (1 - w) + b.s[k] * w;
        u[k] = a.u[k] * (1 - w) + b.u[k] * w;
        v[k] = a.v[k] * (1 - w) + b.v[k] * w;
      }
      res = { s, u, v };
    }
    this._camposCache = res;
    this._camposHf = hf;
    return res;
  }

  _frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame((t) => this._frame(t));
    if (now - this._last < 1000 / FPS) return;
    this._last = now;
    // Reproyectar la textura mientras el usuario arrastra compite con el
    // render de MapLibre. Conservamos el último frame y retomamos al soltar.
    if (this.map.isMoving()) return;

    const T = now - this.t0;
    const { s, u, v } = this._campos(this.horaGetter());
    const feather = this._feather;
    const d = this.img.data;
    const lut = this._lut;
    const rampaMax = this._rampaMax;
    const ruido = this._ruido;
    const N = RUIDO_N;
    const esLluvia = this.capa === "lluvia";
    // Escala de textura: la lluvia más "granulada" que las nubes.
    const escala = esLluvia ? ESCALA_RUIDO * 1.5 : ESCALA_RUIDO;
    const deriva = T * DERIVA_PX_POR_MS;
    // Cuántos "tiles" de ruido entran en el ancho del canvas.
    const tilesPorRes = escala / RUIDO_P;

    for (let py = 0; py < RES; py++) {
      // Coord de ruido (en pixeles del tile) para esta fila.
      const gyBase = (py / RES) * tilesPorRes * N;
      for (let px = 0; px < RES; px++) {
        const o = px + py * RES;
        const cobertura = s[o];

        // Deriva de la textura según el viento local, acumulada en T.
        const gx =
          (px / RES) * tilesPorRes * N -
          ((u[o] * deriva) / RES) * tilesPorRes * N;
        const gy = gyBase + ((v[o] * deriva) / RES) * tilesPorRes * N;

        // Lookup bilineal en el tile de ruido (con wrap).
        let ax = gx % N;
        if (ax < 0) ax += N;
        let ay = gy % N;
        if (ay < 0) ay += N;
        const x0 = ax | 0;
        const y0 = ay | 0;
        const x1 = x0 + 1 === N ? 0 : x0 + 1;
        const y1 = y0 + 1 === N ? 0 : y0 + 1;
        const tx = ax - x0;
        const ty = ay - y0;
        const r00 = ruido[x0 + y0 * N];
        const r10 = ruido[x1 + y0 * N];
        const r01 = ruido[x0 + y1 * N];
        const r11 = ruido[x1 + y1 * N];
        const textura =
          (r00 * (1 - tx) + r10 * tx) * (1 - ty) +
          (r01 * (1 - tx) + r11 * tx) * ty;

        let valorRampa;
        let alphaMul; // 0..1 extra sobre el alpha de la rampa
        if (esLluvia) {
          // Lluvia: celdas de precipitación tipo radar, que se mueven con
          // el viento. Color = intensidad real; la textura recorta las
          // celdas y les da el movimiento.
          const mm = cobertura;
          if (mm < 0.25) {
            d[o * 4 + 3] = 0;
            continue;
          }
          const parche = clamp((textura - 0.42) * 3.2, 0, 1);
          if (parche <= 0.02) {
            d[o * 4 + 3] = 0;
            continue;
          }
          const intensidad = clamp(mm / 8, 0, 1);
          alphaMul = parche * (0.5 + 0.5 * intensidad);
          valorRampa = mm;
        } else {
          // Nubes: la textura fractal es la FORMA; la cobertura real sube
          // el "nivel de agua". Umbral DURO: donde el ruido no llega hay
          // cielo abierto (alpha 0), no humo. Poca cobertura → nubes
          // sueltas; mucha → cielo tapado.
          const cob = clamp(cobertura / 100, 0, 1);
          if (cob < 0.06) {
            d[o * 4 + 3] = 0;
            continue;
          }
          const nivel = 1.0 - cob * 0.62; // cob .4→.75 (ralas) · cob 1→.38
          if (textura < nivel) {
            d[o * 4 + 3] = 0;
            continue;
          }
          const borde = clamp((textura - nivel) / 0.09, 0, 1);
          const nube = borde * borde * (3 - 2 * borde);
          valorRampa = 52 + nube * 48; // borde grisáceo → panza blanca
          alphaMul = 0.12 + 0.74 * nube; // borde muy tenue, cuerpo sólido
        }

        if (alphaMul <= 0.002) {
          d[o * 4 + 3] = 0;
          continue;
        }
        let li = ((valorRampa / rampaMax) * 127) | 0;
        li = li < 0 ? 0 : li > 127 ? 127 : li;
        const l = li * 4;
        const q = o * 4;
        d[q] = lut[l];
        d[q + 1] = lut[l + 1];
        d[q + 2] = lut[l + 2];
        let a = lut[l + 3] * alphaMul * feather[o];
        d[q + 3] = a > 255 ? 255 : a < 0 ? 0 : a;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
    // El source `canvas` de MapLibre solo se re-lee si el mapa vuelve a
    // pintar. Con globo v5 el loop de render se duerme si nada más lo
    // mueve (p. ej. viento apagado), así que lo despertamos nosotros cada
    // frame que dibujamos.
    this.map.triggerRepaint();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.t0 = performance.now();
    this._last = 0;
    // Primer frame YA (síncrono): la capa aparece con las nubes en su
    // lugar, sin un frame en blanco ni "acomodamiento".
    this._frame(this.t0);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this.ctx.clearRect(0, 0, RES, RES);
  }

  /** Pausa CPU conservando el último frame visible en el source canvas. */
  pause() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  destroy() {
    this.stop();
  }
}
