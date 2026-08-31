import { useEffect, useRef } from "react";

/**
 * Efectos de primer plano del "modo águila". Cambian según el municipio que
 * la cámara sobrevuela — `sampler()` devuelve el descriptor de
 * `fxDeCondicion`: `{ tipo, intensidad, rayos }` con
 *   tipo ∈ "sol" · "nublado" · "llovizna" · "lluvia" · "tormenta" · "granizo".
 *
 * - sol       → sol radiante con rayos que laten
 * - llovizna  → lluvia fina y rala
 * - lluvia    → lluvia (densidad según intensidad)
 * - tormenta  → lluvia fuerte + destellos y algún rayo
 * - granizo   → piedras cayendo rápido y rebotando
 *
 * Va por encima del mapa y de las capas de clima, por debajo de la
 * interfaz, y no captura eventos. Los tipos se mezclan con transición
 * suave al pasar de un municipio a otro.
 */
export default function CinematicFX({ active, sampler }) {
  const canvasRef = useRef(null);
  const samplerRef = useRef(sampler);
  samplerRef.current = sampler;

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf = 0;
    let vivo = true;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Cantidades suavizadas por tipo de efecto (0..1). Los cambios entre
    // municipios se interpolan.
    let sun = 0;
    let rain = 0;
    let hail = 0;
    let stormAmt = 0;

    let gotas = [];
    let piedras = [];
    let flashHasta = 0;
    let flashProx = performance.now() + 3000 + Math.random() * 5000;
    let bolt = null;

    const redimensionar = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    redimensionar();
    window.addEventListener("resize", redimensionar);

    const rnd = (a, b) => a + Math.random() * (b - a);
    const nuevaGota = (w, h) => ({
      x: rnd(-0.15 * w, 1.15 * w),
      y: rnd(-h, 0),
      z: rnd(0.3, 1),
    });
    const nuevaPiedra = (w, h) => ({
      x: rnd(0, w),
      y: rnd(-h, 0),
      z: rnd(0.4, 1),
      vy: rnd(9, 15),
      vx: rnd(-1, 1.5),
      bote: 0,
    });

    let ultimo = performance.now();
    const frame = (now) => {
      if (!vivo) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(50, now - ultimo);
      ultimo = now;
      const k = Math.min(1, dt / 550); // factor de suavizado

      const s = (samplerRef.current && samplerRef.current()) || {};
      const inten = Math.max(0, Math.min(1, s.intensidad ?? 0));
      const esLluvia =
        s.tipo === "lluvia" || s.tipo === "llovizna" || s.tipo === "tormenta";
      sun += ((s.tipo === "sol" ? inten : 0) - sun) * k;
      rain += ((esLluvia ? inten : 0) - rain) * k;
      hail += ((s.tipo === "granizo" ? inten : 0) - hail) * k;
      stormAmt += ((s.tipo === "tormenta" ? 1 : 0) - stormAmt) * k;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // ---- Sol: sin dibujo de primer plano. El "está soleado" lo cuenta
      //      el color del cielo según la hora + la ausencia de nubes/lluvia.
      //      (Antes había disco y god-rays; se sacaron por pedido.) ----

      // ---- Lluvia / llovizna / tormenta ----
      const objGotas = Math.round(rain * rain * 1000);
      while (gotas.length < objGotas) gotas.push(nuevaGota(w, h));
      if (gotas.length > objGotas) gotas.length = objGotas;
      if (gotas.length) {
        const vx = (1.4 + rain * 1.8) * dpr;
        ctx.lineCap = "round";
        for (const g of gotas) {
          const vel = (0.5 + g.z) * (0.7 + rain * 0.9) * dpr * dt;
          g.y += vel;
          g.x += vx * g.z * (dt / 16);
          if (g.y > h + 40) Object.assign(g, nuevaGota(w, h)), (g.y = -20);
          ctx.strokeStyle = `rgba(198,220,255,${0.07 + g.z * (0.12 + rain * 0.18)})`;
          ctx.lineWidth = g.z * 1.5 * dpr;
          ctx.beginPath();
          ctx.moveTo(g.x, g.y);
          ctx.lineTo(g.x - vx * 3.5, g.y - vel * 2.4);
          ctx.stroke();
        }
      }

      // ---- Granizo ----
      const objPiedras = Math.round(hail * 320);
      while (piedras.length < objPiedras) piedras.push(nuevaPiedra(w, h));
      if (piedras.length > objPiedras) piedras.length = objPiedras;
      if (piedras.length) {
        for (const p of piedras) {
          p.vy += 0.04 * dt;
          p.y += p.vy * (dt / 16) * dpr * 0.6;
          p.x += p.vx * (dt / 16) * dpr;
          const suelo = h - rnd(0, 4);
          if (p.y > suelo && p.bote < 2) {
            p.y = suelo;
            p.vy = -p.vy * 0.42;
            p.vx *= 0.6;
            p.bote++;
          }
          if (p.y > h + 30) Object.assign(p, nuevaPiedra(w, h));
          const r = p.z * 3.4 * dpr;
          const grd = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, 0, p.x, p.y, r);
          grd.addColorStop(0, "rgba(255,255,255,0.95)");
          grd.addColorStop(1, `rgba(200,214,230,${0.5 + 0.4 * hail})`);
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ---- Rayos (solo tormenta) ----
      if (stormAmt > 0.4 && now > flashProx) {
        flashHasta = now + 150;
        flashProx = now + 2200 + Math.random() * 7000;
        // trazo del rayo
        const x0 = rnd(w * 0.2, w * 0.8);
        const pts = [[x0, 0]];
        let x = x0;
        let y = 0;
        while (y < h * 0.62) {
          y += rnd(20, 55) * dpr;
          x += rnd(-40, 40) * dpr;
          pts.push([x, y]);
        }
        bolt = { pts, hasta: now + 220 };
        setTimeout(() => {
          if (vivo) flashHasta = performance.now() + 100;
        }, 90 + Math.random() * 70);
      }
      if (now < flashHasta) {
        const kf = Math.max(0, (flashHasta - now) / 150);
        ctx.fillStyle = `rgba(228,238,255,${0.42 * kf})`;
        ctx.fillRect(0, 0, w, h);
      }
      if (bolt && now < bolt.hasta) {
        const kb = (bolt.hasta - now) / 220;
        ctx.strokeStyle = `rgba(235,242,255,${0.9 * kb})`;
        ctx.lineWidth = 2.4 * dpr;
        ctx.shadowColor = "rgba(200,220,255,0.9)";
        ctx.shadowBlur = 16 * dpr;
        ctx.beginPath();
        ctx.moveTo(bolt.pts[0][0], bolt.pts[0][1]);
        for (const [px, py] of bolt.pts) ctx.lineTo(px, py);
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        bolt = null;
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", redimensionar);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active]);

  if (!active) return null;
  return <canvas ref={canvasRef} className="cinematic-fx" aria-hidden />;
}
