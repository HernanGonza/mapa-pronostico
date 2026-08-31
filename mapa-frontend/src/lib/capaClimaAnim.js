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

const RES = 200;
const FPS = 24;
const DERIVA_PX_POR_MS = 0.0016; // px de deriva de la textura por ms y por (m/s)
const ESCALA_RUIDO = 3.4; // "zoom" de la textura de nubes sobre el canvas
const MARGEN = 0.13;

const CAMPO = { nubes: "cloud", lluvia: "precip" };

function suavizar(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

/* --- Ruido de valor 2D, dominio infinito, 3 octavas --- */
function hash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function ruidoValor(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return (
    a * (1 - u) * (1 - v) +
    b * u * (1 - v) +
    c * (1 - u) * v +
    d * u * v
  );
}
function fractal(x, y) {
  let amp = 0.55;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += amp * ruidoValor(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
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

  /** Campos interpolados para una hora fraccionaria. */
  _campos(hf) {
    const maxH = this.grilla.horas.length - 1;
    const h = clamp(hf, 0, maxH);
    const h0 = Math.floor(h);
    const h1 = Math.min(maxH, h0 + 1);
    const w = h - h0;
    if (w < 0.02 || h0 === h1) return this._campoHora(h0);
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
    return { s, u, v };
  }

  _frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame((t) => this._frame(t));
    if (now - this._last < 1000 / FPS) return;
    this._last = now;

    const T = now - this.t0;
    const { s, u, v } = this._campos(this.horaGetter());
    const feather = this._feather;
    const d = this.img.data;
    const paradas = this.paradas;
    const esLluvia = this.capa === "lluvia";
    // Escala de textura: la lluvia más "granulada" que las nubes.
    const escala = esLluvia ? ESCALA_RUIDO * 1.5 : ESCALA_RUIDO;

    for (let py = 0; py < RES; py++) {
      const ny = (py / RES) * escala;
      for (let px = 0; px < RES; px++) {
        const o = py * RES + px;
        const cobertura = s[o];

        // Deriva de la textura según el viento local (px, acumulada en T).
        const deriva = T * DERIVA_PX_POR_MS;
        const dx = (u[o] * deriva) / RES * escala;
        const dy = (-v[o] * deriva) / RES * escala;
        const nx = (px / RES) * escala;

        const textura = fractal(nx - dx, ny - dy);

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
          // Nubes: cobertura % con relieve de textura.
          const cob = clamp(cobertura / 100, 0, 1);
          valorRampa = clamp(cob * 100 * (0.7 + 0.5 * (textura - 0.5)), 0, 100);
          alphaMul = 1;
        }

        if (alphaMul <= 0.002) {
          d[o * 4 + 3] = 0;
          continue;
        }
        const col = rampa(paradas, valorRampa);
        const q = o * 4;
        d[q] = col[0];
        d[q + 1] = col[1];
        d[q + 2] = col[2];
        d[q + 3] = clamp(col[3] * alphaMul * feather[o], 0, 255);
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.t0 = performance.now();
    this._last = 0;
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this.ctx.clearRect(0, 0, RES, RES);
  }

  destroy() {
    this.stop();
  }
}
