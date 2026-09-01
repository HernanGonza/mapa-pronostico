import { useEffect, useRef } from "react";
import { WeatherDirector } from "../weather/WeatherDirector";
import { WEATHER_QUALITY } from "../weather/WeatherQuality";

const clamp = (n) => Math.max(0, Math.min(1, n));

/** Compositor atmosférico persistente y coordinado por WeatherDirector. */
export default function CinematicFX({ active, hora, sampler, flightProgress, quality = "MEDIUM" }) {
  const canvasRef = useRef(null);
  const inputRef = useRef({ hora, sampler, flightProgress, quality });
  inputRef.current = { hora, sampler, flightProgress, quality };

  useEffect(() => {
    if (!active) return undefined;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return undefined;
    const director = new WeatherDirector();
    const entradaDesde = performance.now();
    let raf = 0; let vivo = true; let dpr = 1; let ultimo = entradaDesde; let ultimoDibujo = 0;
    let gotas = []; let piedras = []; let flashHasta = 0; let proximoRayo = entradaDesde + 5200; let rayo = null;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const bancos = Array.from({ length: 14 }, (_, i) => ({ x: (i * .173 + Math.random() * .08) % 1, y: .04 + Math.random() * .27, r: .09 + Math.random() * .12, v: .000002 + Math.random() * .000004, a: .35 + Math.random() * .45 }));
    const estrellas = Array.from({ length: 85 }, (_, i) => ({ x: (i * .618033 + Math.random() * .04) % 1, y: .015 + Math.random() * .4, r: .35 + Math.random() * .75, a: .3 + Math.random() * .7 }));
    const profile = () => WEATHER_QUALITY[inputRef.current.quality] || WEATHER_QUALITY.MEDIUM;
    const resize = () => {
      const q = profile(); const area = Math.max(1, canvas.clientWidth * canvas.clientHeight);
      dpr = Math.max(.65, Math.min(window.devicePixelRatio || 1, q.dpr, Math.sqrt(q.pixels / area)));
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr)); canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    };
    resize(); window.addEventListener("resize", resize);
    const nuevaGota = (w, h) => ({ x: rnd(-w * .15, w * 1.1), y: rnd(h * .08, h * .72), z: rnd(.25, 1) });
    const nuevaPiedra = (w, h) => ({ x: rnd(0, w), y: rnd(h * .1, h * .6), z: rnd(.4, 1), vy: rnd(7, 12), vx: rnd(-.8, 1.3) });

    function horizonte(w, h, now, s) {
      const horaActual = ((inputRef.current.hora ?? 12) % 24 + 24) % 24;
      const luzDia = clamp((Math.cos(((horaActual - 12) / 12) * Math.PI) + .15) / .85);
      const noche = 1 - luzDia; const cubierta = clamp(s.clouds); const oscuridad = clamp(s.darkness);
      if (noche > .02) {
        const g = ctx.createLinearGradient(0, 0, 0, h * .72);
        g.addColorStop(0, `rgba(3,8,22,${.5 * noche})`); g.addColorStop(.6, `rgba(19,24,52,${.3 * noche})`); g.addColorStop(1, "rgba(67,45,68,.06)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * .72);
        const vis = noche * (1 - cubierta * .92); const q = profile();
        for (let i = 0; i < Math.min(q.stars, estrellas.length); i++) { const e = estrellas[i]; ctx.fillStyle = `rgba(235,242,255,${e.a * vis * .82})`; ctx.beginPath(); ctx.arc(e.x * w, e.y * h, e.r * dpr, 0, Math.PI * 2); ctx.fill(); }
      } else if (cubierta < .75) {
        const g = ctx.createRadialGradient(w * .78, h * .18, 0, w * .78, h * .18, w * .48);
        g.addColorStop(0, `rgba(255,238,178,${.2 * luzDia * (1 - oscuridad)})`); g.addColorStop(1, "rgba(255,210,120,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * .7);
      }
      if (cubierta > .01) {
        const techo = ctx.createLinearGradient(0, 0, 0, h * .72);
        techo.addColorStop(0, `rgba(13,20,29,${cubierta * (.34 + oscuridad * .34)})`); techo.addColorStop(.45, `rgba(65,73,80,${cubierta * .2})`); techo.addColorStop(1, "rgba(90,98,104,0)"); ctx.fillStyle = techo; ctx.fillRect(0, 0, w, h * .72);
        const q = profile();
        for (let i = 0; i < Math.min(q.clouds, bancos.length); i++) { const b = bancos[i]; const x = (((b.x + now * b.v * (1 + s.wind * 2)) % 1.25) - .12) * w; const y = b.y * h; const rx = b.r * w; const g = ctx.createRadialGradient(x, y, 0, x, y, rx); const a = cubierta * b.a * .22; g.addColorStop(0, `rgba(215,222,226,${a})`); g.addColorStop(.48, `rgba(128,140,150,${a * .75})`); g.addColorStop(1, "rgba(90,100,110,0)"); ctx.save(); ctx.translate(x, y); ctx.scale(1, .22); ctx.translate(-x, -y); ctx.fillStyle = g; ctx.fillRect(x-rx, y-rx, rx*2, rx*2); ctx.restore(); }
      }
      // El haze atmosférico no debe lavar todo el mapa con clima despejado.
      // Sólo se dibuja cuando hay niebla real o una cobertura relevante.
      const bruma = s.fog > .12 || s.clouds > .72 ? clamp(Math.max(s.fog, s.haze * .55)) : 0;
      if (bruma > .01) { const g = ctx.createLinearGradient(0, h * .2, 0, h * .82); g.addColorStop(0, "rgba(205,214,216,0)"); g.addColorStop(.62, `rgba(190,202,205,${bruma * .55})`); g.addColorStop(1, `rgba(184,196,199,${s.fog * .2})`); ctx.fillStyle = g; ctx.fillRect(0, h * .15, w, h * .7); }
      if (s.distantPrecipitation > .02) { ctx.strokeStyle = `rgba(150,175,194,${.1 + s.distantPrecipitation * .16})`; ctx.lineWidth = Math.max(5, w * .015); for (let i=0;i<7;i++){ const x=w*(.08+i*.15)+Math.sin(i*4.1)*w*.03; ctx.beginPath(); ctx.moveTo(x,h*.28); ctx.lineTo(x+s.wind*w*.03,h*.68); ctx.stroke(); } }
    }

    function frame(now) {
      if (!vivo) return; raf = requestAnimationFrame(frame);
      const q = profile(); if (now - ultimoDibujo < 1000 / q.fps) return;
      const dt = Math.min(45, now - ultimo); ultimo = now; ultimoDibujo = now;
      director.transitionTo(inputRef.current.sampler?.() || { preset: "CLEAR" }, { duration: 2600 });
      const progress = inputRef.current.flightProgress?.() ?? clamp((now - entradaDesde) / 3000);
      const s = director.update(now, progress); const w = canvas.width; const h = canvas.height; ctx.clearRect(0, 0, w, h); horizonte(w, h, now, s);
      const objetivo = Math.round(s.nearPrecipitation ** 2 * q.rain); while (gotas.length < objetivo) gotas.push(nuevaGota(w,h)); if (gotas.length > objetivo) gotas.length = objetivo;
      const dir = ((s.weather?.windDirection || 45) * Math.PI) / 180; const deriva = Math.sin(dir) * (1 + s.wind * 5) * dpr;
      ctx.lineCap = "round"; for (const g of gotas) { const vel=(.45+g.z)*(.65+s.nearPrecipitation)*dpr*dt; g.y+=vel; g.x+=deriva*g.z*dt/16; if(g.y>h+30||g.x>w+40||g.x< -40) Object.assign(g,nuevaGota(w,h)); ctx.strokeStyle=`rgba(205,225,245,${.04+g.z*(.08+s.nearPrecipitation*.13)})`; ctx.lineWidth=Math.max(.6,g.z*1.25*dpr); ctx.beginPath(); ctx.moveTo(g.x,g.y); ctx.lineTo(g.x-deriva*3,g.y-vel*1.55); ctx.stroke(); }
      const objetivoH=Math.round(s.hail*q.hail); while(piedras.length<objetivoH) piedras.push(nuevaPiedra(w,h)); if(piedras.length>objetivoH) piedras.length=objetivoH; for(const p of piedras){p.y+=p.vy*dt/16*dpr;p.x+=(p.vx+deriva*.2)*dt/16*dpr;if(p.y>h+20)Object.assign(p,nuevaPiedra(w,h));ctx.fillStyle=`rgba(238,244,248,${.35+p.z*.35})`;ctx.beginPath();ctx.arc(p.x,p.y,p.z*2.1*dpr,0,Math.PI*2);ctx.fill();}
      if(s.wetness>.03){const g=ctx.createLinearGradient(0,h*.68,0,h);g.addColorStop(0,"rgba(90,130,155,0)");g.addColorStop(1,`rgba(42,74,91,${s.wetness*.16})`);ctx.fillStyle=g;ctx.fillRect(0,h*.65,w,h*.35);}
      if(s.heatHaze>.03){ctx.strokeStyle=`rgba(255,225,175,${s.heatHaze*.055})`;ctx.lineWidth=2*dpr;for(let i=0;i<5;i++){const y=h*(.62+i*.055);ctx.beginPath();for(let x=0;x<=w;x+=24*dpr)ctx.lineTo(x,y+Math.sin(x*.012+now*.002+i)*3*dpr);ctx.stroke();}}
      if(s.lightning>.12&&now>proximoRayo){flashHasta=now+110;proximoRayo=now+rnd(6500,11500)/Math.max(.35,s.lightning);let x=rnd(w*.2,w*.8),y=h*.05;const pts=[[x,y]];while(y<h*.48){y+=rnd(16,38)*dpr;x+=rnd(-28,28)*dpr;pts.push([x,y]);}rayo={pts,hasta:now+170};director.audio.playThunder();}
      if(now<flashHasta){ctx.fillStyle=`rgba(225,235,249,${.2*(flashHasta-now)/110})`;ctx.fillRect(0,0,w,h*.75);} if(rayo&&now<rayo.hasta){ctx.strokeStyle=`rgba(236,242,255,${.65*(rayo.hasta-now)/170})`;ctx.lineWidth=1.4*dpr;ctx.shadowColor="rgba(198,218,255,.75)";ctx.shadowBlur=9*dpr;ctx.beginPath();ctx.moveTo(...rayo.pts[0]);for(const p of rayo.pts.slice(1))ctx.lineTo(...p);ctx.stroke();ctx.shadowBlur=0;}
    }
    raf=requestAnimationFrame(frame);
    return()=>{vivo=false;cancelAnimationFrame(raf);window.removeEventListener("resize",resize);ctx.clearRect(0,0,canvas.width,canvas.height);};
  }, [active]);
  if (!active) return null;
  return <canvas ref={canvasRef} className="cinematic-fx" aria-hidden="true" />;
}
