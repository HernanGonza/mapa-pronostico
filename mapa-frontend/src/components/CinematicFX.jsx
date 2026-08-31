import { useEffect, useRef } from "react";

/**
 * Atmósfera del modo águila. La mayor parte del clima vive en el horizonte:
 * bancos de nubes, luz y bruma. Sólo la precipitación cruza el primer plano.
 */
export default function CinematicFX({ active, sampler }) {
  const canvasRef = useRef(null);
  const samplerRef = useRef(sampler);
  samplerRef.current = sampler;

  useEffect(() => {
    if (!active) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    let raf = 0;
    let vivo = true;
    let dpr = 1;
    let ultimo = performance.now();
    let sol = 0;
    let nubes = 0;
    let lluvia = 0;
    let granizo = 0;
    let tormenta = 0;
    let gotas = [];
    let piedras = [];
    let flashHasta = 0;
    let proximoRayo = performance.now() + 4500 + Math.random() * 5000;
    let rayo = null;

    // Semillas estables: las masas no cambian de forma entre frames.
    const bancos = Array.from({ length: 14 }, (_, i) => ({
      x: (i * 0.173 + Math.random() * 0.08) % 1,
      y: 0.04 + Math.random() * 0.27,
      r: 0.09 + Math.random() * 0.12,
      v: 0.000002 + Math.random() * 0.000004,
      a: 0.35 + Math.random() * 0.45,
    }));

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    };
    resize();
    window.addEventListener("resize", resize);

    const rnd = (a, b) => a + Math.random() * (b - a);
    const nuevaGota = (w, h) => ({
      x: rnd(-w * 0.15, w * 1.1),
      y: rnd(h * 0.12, h * 0.68),
      z: rnd(0.25, 1),
    });
    const nuevaPiedra = (w, h) => ({
      x: rnd(0, w),
      y: rnd(h * 0.1, h * 0.6),
      z: rnd(0.4, 1),
      vy: rnd(7, 12),
      vx: rnd(-0.8, 1.3),
    });

    function pintarHorizonte(w, h, now) {
      const cubierta = Math.max(nubes, lluvia * 0.75, tormenta * 0.95, granizo * 0.8);
      if (sol > 0.02) {
        const g = ctx.createRadialGradient(w * 0.78, h * 0.18, 0, w * 0.78, h * 0.18, w * 0.48);
        g.addColorStop(0, `rgba(255,238,178,${0.2 * sol})`);
        g.addColorStop(0.28, `rgba(255,213,128,${0.08 * sol})`);
        g.addColorStop(1, "rgba(255,210,120,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h * 0.7);
      }
      if (cubierta <= 0.02) return;

      const techo = ctx.createLinearGradient(0, 0, 0, h * 0.7);
      techo.addColorStop(0, `rgba(21,29,39,${0.42 * cubierta})`);
      techo.addColorStop(0.42, `rgba(52,61,70,${0.18 * cubierta})`);
      techo.addColorStop(1, "rgba(70,78,86,0)");
      ctx.fillStyle = techo;
      ctx.fillRect(0, 0, w, h * 0.72);

      for (const b of bancos) {
        const x = (((b.x + now * b.v) % 1.25) - 0.12) * w;
        const y = b.y * h;
        const rx = b.r * w;
        const ry = rx * 0.22;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
        const alpha = cubierta * b.a * 0.22;
        g.addColorStop(0, `rgba(220,226,230,${alpha})`);
        g.addColorStop(0.45, `rgba(156,166,174,${alpha * 0.72})`);
        g.addColorStop(1, "rgba(110,120,130,0)");
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, ry / rx);
        ctx.translate(-x, -y);
        ctx.fillStyle = g;
        ctx.fillRect(x - rx, y - rx, rx * 2, rx * 2);
        ctx.restore();
      }

      const bruma = ctx.createLinearGradient(0, h * 0.22, 0, h * 0.72);
      bruma.addColorStop(0, "rgba(194,205,212,0)");
      bruma.addColorStop(0.52, `rgba(184,196,202,${0.1 * cubierta})`);
      bruma.addColorStop(1, "rgba(184,196,202,0)");
      ctx.fillStyle = bruma;
      ctx.fillRect(0, h * 0.18, w, h * 0.58);
    }

    function frame(now) {
      if (!vivo) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(40, now - ultimo);
      ultimo = now;
      const suavizado = 1 - Math.exp(-dt / 700);
      const s = samplerRef.current?.() || {};
      const intensidad = Math.max(0, Math.min(1, s.intensidad ?? 0));
      const esPrecipitacion = ["llovizna", "lluvia", "tormenta"].includes(s.tipo);
      sol += ((s.tipo === "sol" ? intensidad : 0) - sol) * suavizado;
      nubes += ((s.nubosidad ?? (s.tipo === "nublado" ? intensidad : 0)) - nubes) * suavizado;
      lluvia += ((esPrecipitacion ? intensidad : 0) - lluvia) * suavizado;
      granizo += ((s.tipo === "granizo" ? intensidad : 0) - granizo) * suavizado;
      tormenta += ((s.tipo === "tormenta" ? intensidad : 0) - tormenta) * suavizado;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      pintarHorizonte(w, h, now);

      const objetivoGotas = Math.round(lluvia * lluvia * 430);
      while (gotas.length < objetivoGotas) gotas.push(nuevaGota(w, h));
      if (gotas.length > objetivoGotas) gotas.length = objetivoGotas;
      ctx.lineCap = "round";
      for (const g of gotas) {
        const vel = (0.45 + g.z) * (0.6 + lluvia) * dpr * dt;
        const viento = (0.7 + lluvia * 1.3) * dpr;
        g.y += vel;
        g.x += viento * g.z * (dt / 16);
        if (g.y > h + 30 || g.x > w + 30) Object.assign(g, nuevaGota(w, h));
        ctx.strokeStyle = `rgba(205,225,245,${0.045 + g.z * (0.08 + lluvia * 0.12)})`;
        ctx.lineWidth = Math.max(0.6, g.z * 1.25 * dpr);
        ctx.beginPath();
        ctx.moveTo(g.x, g.y);
        ctx.lineTo(g.x - viento * 3.2, g.y - vel * 1.6);
        ctx.stroke();
      }

      const objetivoPiedras = Math.round(granizo * 110);
      while (piedras.length < objetivoPiedras) piedras.push(nuevaPiedra(w, h));
      if (piedras.length > objetivoPiedras) piedras.length = objetivoPiedras;
      for (const p of piedras) {
        p.y += p.vy * (dt / 16) * dpr;
        p.x += p.vx * (dt / 16) * dpr;
        if (p.y > h + 20) Object.assign(p, nuevaPiedra(w, h));
        ctx.fillStyle = `rgba(235,242,248,${0.35 + p.z * 0.35})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.z * 2.2 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      if (tormenta > 0.45 && now > proximoRayo) {
        flashHasta = now + 120;
        proximoRayo = now + 4500 + Math.random() * 6500;
        let x = rnd(w * 0.2, w * 0.8);
        let y = h * 0.06;
        const pts = [[x, y]];
        while (y < h * 0.45) {
          y += rnd(16, 38) * dpr;
          x += rnd(-28, 28) * dpr;
          pts.push([x, y]);
        }
        rayo = { pts, hasta: now + 180 };
      }
      if (now < flashHasta) {
        ctx.fillStyle = `rgba(225,235,249,${0.18 * ((flashHasta - now) / 120)})`;
        ctx.fillRect(0, 0, w, h * 0.7);
      }
      if (rayo && now < rayo.hasta) {
        ctx.strokeStyle = `rgba(236,242,255,${0.65 * ((rayo.hasta - now) / 180)})`;
        ctx.lineWidth = 1.5 * dpr;
        ctx.shadowColor = "rgba(198,218,255,.75)";
        ctx.shadowBlur = 10 * dpr;
        ctx.beginPath();
        ctx.moveTo(...rayo.pts[0]);
        for (const punto of rayo.pts.slice(1)) ctx.lineTo(...punto);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    raf = requestAnimationFrame(frame);
    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active]);

  if (!active) return null;
  return <canvas ref={canvasRef} className="cinematic-fx" aria-hidden="true" />;
}
