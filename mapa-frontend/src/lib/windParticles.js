/**
 * Partículas de viento sobre el mapa (estilo earth.nullschool).
 *
 * Toma la grilla de clima de Open-Meteo (`grid.puntos[k].windU[hora]` /
 * `windV[hora]`, en m/s) y una función `horaGetter()` que devuelve el
 * índice de hora actual — así el viento sigue el slider de tiempo.
 *
 * Movimiento en pasos chicos y fijos → estelas suaves, sin "fuegos
 * artificiales". No dibuja mientras la cámara se mueve ni en la vista de
 * globo muy alejada (las partículas se salían del disco).
 */

const N_PARTICLES = 2800;
const FADE_ALPHA = 0.965;
const MAX_AGE = 120;
const STEP_MS = 33;
const FACTOR = 0.00075; // grados por paso, por (m/s)
const MAX_SALTO_PX = 10;

export class WindParticleLayer {
  constructor(map, canvas, grid, horaGetter) {
    this.map = map;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.grid = grid;
    this.n = grid.grid;
    this.b = grid.bounds;
    this.horaGetter = horaGetter || (() => 0);
    this.particles = [];
    this.running = false;
    this._last = 0;
    this._resize();
    this._onResize = () => this._resize();
    map.on("resize", this._onResize);
  }

  _resize() {
    const c = this.canvas;
    const { clientWidth, clientHeight } = this.map.getContainer();
    if (c.width !== clientWidth || c.height !== clientHeight) {
      c.width = clientWidth;
      c.height = clientHeight;
    }
  }

  _rnd() {
    // Cerca: nacen dentro de lo que se ve (densidad sobre Misiones).
    const age = Math.random() * MAX_AGE;
    if (this.map.getZoom() > 3.6) {
      try {
        const bb = this.map.getBounds();
        const w = bb.getWest();
        const e = bb.getEast();
        const s = bb.getSouth();
        const n = bb.getNorth();
        if (e - w > 0 && e - w < 180 && n - s > 0) {
          const mx = (e - w) * 0.15;
          const my = (n - s) * 0.15;
          return {
            lng: w - mx + Math.random() * (e - w + 2 * mx),
            lat: s - my + Math.random() * (n - s + 2 * my),
            age,
          };
        }
      } catch {
        /* sin bounds */
      }
    }
    const b = this.b;
    return {
      lng: b.lngMin + Math.random() * (b.lngMax - b.lngMin),
      lat: b.latMin + Math.random() * (b.latMax - b.latMin),
      age,
    };
  }

  /** Interpola [u,v] (m/s) en lng/lat para la hora actual. */
  _uv(lng, lat) {
    const { latMin, latMax, lngMin, lngMax } = this.b;
    if (lat < latMin || lat > latMax || lng < lngMin || lng > lngMax) return null;
    const n = this.n;
    const fi = ((lat - latMin) / (latMax - latMin)) * (n - 1);
    const fj = ((lng - lngMin) / (lngMax - lngMin)) * (n - 1);
    const i0 = Math.max(0, Math.min(n - 2, Math.floor(fi)));
    const j0 = Math.max(0, Math.min(n - 2, Math.floor(fj)));
    const ti = fi - i0;
    const tj = fj - j0;
    const h = this.horaGetter();
    const g = (i, j, comp) => {
      const p = this.grid.puntos[i * n + j];
      const s = comp === 0 ? p.windU : p.windV;
      return s ? s[h] ?? 0 : 0;
    };
    const bil = (comp) => {
      const a = g(i0, j0, comp) * (1 - tj) + g(i0, j0 + 1, comp) * tj;
      const b = g(i0 + 1, j0, comp) * (1 - tj) + g(i0 + 1, j0 + 1, comp) * tj;
      return a * (1 - ti) + b * ti;
    };
    return [bil(0), bil(1)];
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.particles = Array.from({ length: N_PARTICLES }, () => this._rnd());
    const ctx = this.ctx;

    const loop = (t) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      if (t - this._last < STEP_MS) return;
      this._last = t;

      const w = this.canvas.width;
      const h = this.canvas.height;

      if (this.map.getZoom() < 3.6) {
        ctx.clearRect(0, 0, w, h);
        return;
      }

      const dibujar = !this.map.isMoving();
      if (dibujar && this._wasMoving) {
        this.particles = Array.from({ length: N_PARTICLES }, () => this._rnd());
      }
      this._wasMoving = !dibujar;

      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = `rgba(0,0,0,${dibujar ? FADE_ALPHA : 0.9})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 1.15;
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.62)";

      for (const p of this.particles) {
        const uv = this._uv(p.lng, p.lat);
        if (!uv) {
          Object.assign(p, this._rnd());
          continue;
        }
        const antes = this.map.project([p.lng, p.lat]);

        const cosLat = Math.max(0.4, Math.cos((p.lat * Math.PI) / 180));
        p.lng += (uv[0] * FACTOR) / cosLat;
        p.lat += uv[1] * FACTOR;
        p.age += 1;

        if (p.age > MAX_AGE) {
          Object.assign(p, this._rnd());
          continue;
        }
        if (!dibujar) continue;

        const desp = this.map.project([p.lng, p.lat]);
        const dx = desp.x - antes.x;
        const dy = desp.y - antes.y;
        if (dx * dx + dy * dy > MAX_SALTO_PX * MAX_SALTO_PX) continue;
        if (desp.x < -8 || desp.x > w + 8 || desp.y < -8 || desp.y > h + 8)
          continue;

        ctx.beginPath();
        ctx.moveTo(antes.x, antes.y);
        ctx.lineTo(desp.x, desp.y);
        ctx.stroke();
      }
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  destroy() {
    this.stop();
    this.map.off("resize", this._onResize);
  }
}
