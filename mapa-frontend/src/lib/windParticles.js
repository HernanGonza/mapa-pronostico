/**
 * Partículas de viento sobre todo el globo (estilo earth.nullschool).
 * Campo global en formato GFS/GRIB-JSON (registros U y V sobre una grilla
 * lat/lng regular).
 *
 * Movimiento en pasos chicos y fijos (nada de dt): así las estelas salen
 * suaves y continuas, no "fuegos artificiales".
 */

const N_PARTICLES = 2600;
const FADE_ALPHA = 0.955;
const MAX_AGE = 110;
const STEP_MS = 33; // ~30 fps
const FACTOR = 0.0006; // grados por paso, por (m/s) — paso chico = movimiento fluido
const MAX_SALTO_PX = 9; // si una partícula salta más que esto en pantalla, no se traza

const MISIONES = { latMin: -28.4, latMax: -25.3, lngMin: -56.3, lngMax: -53.5 };

const toRad = (d) => (d * Math.PI) / 180;

function distAngular(lng1, lat1, lng2, lat2) {
  const a =
    Math.sin(toRad(lat1)) * Math.sin(toRad(lat2)) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng1 - lng2));
  return (Math.acos(Math.max(-1, Math.min(1, a))) * 180) / Math.PI;
}

class WindField {
  constructor(records) {
    const h = records[0].header;
    this.nx = h.nx;
    this.ny = h.ny;
    this.lo1 = h.lo1;
    this.la1 = h.la1;
    this.dx = h.dx;
    this.dy = h.dy;
    this.u = records[0].data;
    this.v = records[1].data;
  }

  at(lng, lat) {
    const lon = (((lng - this.lo1) % 360) + 360) % 360;
    const fx = lon / this.dx;
    const fy = (this.la1 - lat) / this.dy;
    if (fy < 0 || fy > this.ny - 1) return null;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = (x0 + 1) % this.nx;
    const y1 = Math.min(this.ny - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const g = (arr, x, y) => arr[y * this.nx + x];
    const bl = (arr) => {
      const a = g(arr, x0, y0) * (1 - tx) + g(arr, x1, y0) * tx;
      const b = g(arr, x0, y1) * (1 - tx) + g(arr, x1, y1) * tx;
      return a * (1 - ty) + b * ty;
    };
    return [bl(this.u), bl(this.v)];
  }
}

export class WindParticleLayer {
  constructor(map, canvas, records) {
    this.map = map;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.field = new WindField(records);
    this.particles = [];
    this.running = false;
    this._last = 0;
    this._resize();
    this.particles = Array.from({ length: N_PARTICLES }, () => this._rnd());
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
    // Cuando la cámara está cerca, las partículas nacen dentro (o cerca)
    // de lo que se ve — así hay densidad sobre Misiones. En vista de globo
    // se reparten por todo el planeta.
    const age = Math.random() * MAX_AGE;
    if (this.map.getZoom() > 3.5) {
      try {
        const b = this.map.getBounds();
        const w = b.getWest();
        const e = b.getEast();
        const s = b.getSouth();
        const n = b.getNorth();
        if (e - w > 0 && e - w < 180 && n - s > 0) {
          const mx = (e - w) * 0.2;
          const my = (n - s) * 0.2;
          return {
            lng: w - mx + Math.random() * (e - w + 2 * mx),
            lat: s - my + Math.random() * (n - s + 2 * my),
            age,
          };
        }
      } catch {
        /* bounds no disponibles en globo — cae al reparto global */
      }
    }
    return { lng: -180 + Math.random() * 360, lat: -78 + Math.random() * 156, age };
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Re-sembrar ahora que la cámara ya está donde va (después del intro).
    this.particles = Array.from({ length: N_PARTICLES }, () => this._rnd());
    const ctx = this.ctx;

    const loop = (t) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      if (t - this._last < STEP_MS) return;
      this._last = t;

      const w = this.canvas.width;
      const h = this.canvas.height;

      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = `rgba(0,0,0,${FADE_ALPHA})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 1;
      ctx.lineCap = "round";

      const c = this.map.getCenter();
      const zoom = this.map.getZoom();
      const globalView = zoom < 4;
      // Radio aproximado del globo en píxeles (para no dibujar viento
      // fuera del disco de la Tierra en la vista alejada).
      const globeR = (512 * Math.pow(2, zoom)) / (2 * Math.PI);
      const cx = w / 2;
      const cy = h / 2;

      for (const p of this.particles) {
        const uv = this.field.at(p.lng, p.lat);
        if (!uv) {
          Object.assign(p, this._rnd());
          continue;
        }

        const antes = this.map.project([p.lng, p.lat]);

        const cosLat = Math.max(0.35, Math.cos(toRad(p.lat)));
        p.lng += (uv[0] * FACTOR) / cosLat;
        p.lat += uv[1] * FACTOR;
        p.age += 1;

        if (p.age > MAX_AGE || p.lat > 82 || p.lat < -82) {
          Object.assign(p, this._rnd());
          continue;
        }
        if (p.lng > 180) p.lng -= 360;
        if (p.lng < -180) p.lng += 360;

        if (globalView && distAngular(p.lng, p.lat, c.lng, c.lat) > 68)
          continue;

        const desp = this.map.project([p.lng, p.lat]);
        if (globalView) {
          const rr = (desp.x - cx) ** 2 + (desp.y - cy) ** 2;
          if (rr > (globeR * 0.99) ** 2) continue; // fuera del disco
        }
        const dx = desp.x - antes.x;
        const dy = desp.y - antes.y;
        if (dx * dx + dy * dy > MAX_SALTO_PX * MAX_SALTO_PX) continue;
        if (desp.x < -8 || desp.x > w + 8 || desp.y < -8 || desp.y > h + 8)
          continue;

        const enMnes =
          p.lat > MISIONES.latMin &&
          p.lat < MISIONES.latMax &&
          p.lng > MISIONES.lngMin &&
          p.lng < MISIONES.lngMax;

        ctx.strokeStyle = enMnes
          ? "rgba(255,255,255,0.9)"
          : "rgba(255,255,255,0.5)";
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
  }

  destroy() {
    this.stop();
    this.map.off("resize", this._onResize);
  }
}
