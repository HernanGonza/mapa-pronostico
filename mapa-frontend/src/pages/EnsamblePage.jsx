import { useEffect, useId, useMemo, useRef, useState } from "react";
import VolverConfiguracion from "../components/VolverConfiguracion";
import BrandHeader from "../components/BrandHeader";
import CampoFecha from "../components/CampoFecha";
import CampoHora from "../components/CampoHora";
import InformeEnsamble, { BotonInforme, useInforme } from "../components/InformeEnsamble";
import * as api from "../api";
import "./ensamble.css";

/**
 * Ensamble multimodelo (desde Configuración): lo que dice cada modelo numérico para el
 * centroide de cada uno de los 17 departamentos, a 10 días. Cada modelo tiene su color y su forma de
 * marcador (se distinguen también sin color); se pueden prender y apagar y la media y la discrepancia
 * se recalculan con los que quedan prendidos.
 */
const AR = "America/Argentina/Buenos_Aires";
const ESTILO = { // color + forma propios de cada modelo
  ecmwf_ifs025: { color: "#1f6fb2", forma: "circulo" },
  gfs_seamless: { color: "#d4572a", forma: "cuadrado" },
  icon_seamless: { color: "#2f8f5b", forma: "rombo" },
  gem_seamless: { color: "#8b3fc4", forma: "triangulo" },
  wrf_smn: { color: "#c9346c", forma: "cruz" },
  monan_3km: { color: "#c28f00", forma: "hexagono" },
  monan_10km: { color: "#00838f", forma: "estrella" },
};
// Espejo de MODELOS en mapa-backend/src/lib/ensamble.js (las tarjetas existen antes de la primera consulta).
const CATALOGO = [
  { id: "ecmwf_ifs025", nombre: "ECMWF", detalle: "Centro Europeo · 3–10 días", nota: "Centro Europeo. Referencia a 3–10 días." },
  { id: "gfs_seamless", nombre: "GFS", detalle: "EE. UU. (NOAA) · viento y temperatura", nota: "EE. UU. (NOAA). Tendencias de viento y temperatura." },
  { id: "icon_seamless", nombre: "ICON", detalle: "Alemania (DWD) · consenso", nota: "Alemania (DWD). Validador de consenso." },
  { id: "gem_seamless", nombre: "GEM", detalle: "Canadá (ECCC) · consenso", nota: "Canadá (ECCC). Validador de consenso." },
  { id: "wrf_smn", nombre: "WRF-SMN", detalle: "Argentina (SMN) · 4 km, 72 h · tormentas", nota: "Servicio Meteorológico Nacional, 4 km, hasta 72 h. Tormentas y lluvia convectiva. Aporta temperatura, lluvia, humedad y viento; no publica ráfagas, nubosidad ni sensación térmica. Pesa (≈12 MB por hora de pronóstico): tarda en bajar la primera vez." },
  { id: "monan_3km", nombre: "MONAN 3 km", detalle: "Brasil (CPTEC) · 3 km, 72 h · convección", deshabilitado: true, nota: "Apagado: el CPTEC/INPE puso el MONAN detrás de usuario y clave. CPTEC/INPE (Brasil), regional, 3 km, hasta 72 h (una corrida por día, 00 UTC). Es el único con ráfagas, CAPE, reflectividad de radar y helicidad de ascenso: tormentas severas. Sin nubosidad." },
  { id: "monan_10km", nombre: "MONAN 10 km", detalle: "Brasil (CPTEC) · 10 km, 11 días", deshabilitado: true, nota: "Apagado: el CPTEC/INPE puso el MONAN detrás de usuario y clave. CPTEC/INPE (Brasil), global, 10 km, hasta 11 días, una salida cada 3 horas (las máximas y mínimas del día son aproximadas). Trae nubosidad; sin ráfagas." },
];
const fechaDe = (f) => new Date(`${f}T12:00:00-03:00`);
const diaCorto = (f) => fechaDe(f).toLocaleDateString("es-AR", { timeZone: AR, weekday: "short" }).replace(".", "");
const diaMes = (f) => f.split("-").reverse().slice(0, 2).join("/");
const hoyART = () => new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(new Date());
const sumarDias = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** Atajos de rango: desde las 00:00 de hoy hasta el final del día N. */
const ATAJOS = [{ txt: "Hoy", dias: 0 }, { txt: "3 días", dias: 2 }, { txt: "10 días", dias: 9 }];
const num = (n, dec) => (n == null ? "—" : n.toFixed(dec).replace(".", ","));

/** «hoy 15:40», «ayer 03:10», «15/10 03:10» (hora de Misiones). */
function cuando(iso) {
  if (!iso) return "—";
  const d = new Date(iso), dia = (x) => new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(x);
  const hora = d.toLocaleTimeString("es-AR", { timeZone: AR, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const hoy = dia(new Date()), ayer = dia(new Date(Date.now() - 864e5)), manana = dia(new Date(Date.now() + 864e5)), f = dia(d);
  return `${f === hoy ? "hoy" : f === ayer ? "ayer" : f === manana ? "mañana" : diaMes(f)} ${hora}`;
}
const horaUtc = (iso) => `${String(new Date(iso).getUTCHours()).padStart(2, "0")} UTC`;
/** Cuándo se espera la próxima corrida de un modelo, para el panel. */
const proximaTxt = (e) => (!e.proxima ? "calculando…" : Date.parse(e.proxima) > Date.now() ? `≈ ${cuando(e.proxima)}` : "ya debería estar: se baja en cuanto salga");

/** Cómo se parte el rango en columnas (espejo de INTERVALOS en mapa-backend/src/lib/ensamble.js). */
const INTERVALOS = [
  { id: "hora", txt: "1 hora" }, { id: "3h", txt: "3 horas" }, { id: "6h", txt: "6 horas" }, { id: "12h", txt: "12 horas" },
  { id: "dia", txt: "Día" }, { id: "mes", txt: "Mes" }, { id: "anio", txt: "Año" }, { id: "rango", txt: "Todo el rango" },
];
const hh = (stamp) => stamp.slice(11, 13);
const finHora = (stamp) => (hh(stamp) === "00" ? "24" : hh(stamp)); // el fin de las 00:00 del día siguiente es «24»
/** Rótulo de una columna: { a: principal, b: secundario } según el intervalo. */
function etiquetaPeriodo(p, intervalo) {
  if (intervalo === "dia") return { a: diaCorto(p.fecha), b: diaMes(p.fecha) };
  if (intervalo === "mes") return { a: fechaDe(p.fecha).toLocaleDateString("es-AR", { timeZone: AR, month: "short" }).replace(".", ""), b: p.fecha.slice(0, 4) };
  if (intervalo === "anio") return { a: p.fecha.slice(0, 4), b: "" };
  if (intervalo === "rango") return { a: "Todo el rango", b: `${diaMes(p.desde.slice(0, 10))} ${hh(p.desde)}:00 → ${diaMes(p.hasta.slice(0, 10))} ${hh(p.hasta)}:00` };
  return { a: `${hh(p.desde)}–${finHora(p.hasta)} h`, b: `${diaCorto(p.fecha)} ${diaMes(p.fecha)}` };
}
/** El mismo rótulo en una sola línea (ventanita del gráfico y filas del detalle). */
const etiquetaLarga = (p, intervalo) => {
  if (intervalo === "dia") return fechaDe(p.fecha).toLocaleDateString("es-AR", { timeZone: AR, weekday: "long", day: "numeric", month: "long" });
  const e = etiquetaPeriodo(p, intervalo); return e.b ? `${e.a} · ${e.b}` : e.a;
};
/** El arco más corto que contiene todas las direcciones (grados): [desde, hasta]. */
function arcoCircular(angulos) {
  const a = angulos.map((g) => ((g % 360) + 360) % 360).sort((x, y) => x - y);
  if (a.length < 2) return [a[0], a[0]];
  let mejor = 0, hueco = -1;
  a.forEach((g, i) => { const d = (a[(i + 1) % a.length] - g + 360) % 360; if (d > hueco) { hueco = d; mejor = i; } });
  return [a[(mejor + 1) % a.length], a[mejor]];
}

/** Estadística de los modelos prendidos (misma regla que mapa-backend/src/lib/ensamble.js). */
const PUNTOS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
/** 0–360° → «SSE» (de dónde sopla el viento). */
const cardinal = (g) => PUNTOS[Math.round((((g % 360) + 360) % 360) / 22.5) % 16];
/** Valor con su unidad: «22,7 °C»; las direcciones, «SSE 172°». */
const fmtVal = (v, variable) => (v == null ? "—" : variable.circular ? `${cardinal(v)} ${Math.round(v)}°` : `${num(v, variable.decimales)} ${variable.unidad}`);
/** Sólo el número para las celdas de la matriz (las direcciones, la sigla). */
const fmtCelda = (v, variable) => (v == null ? "—" : variable.circular ? cardinal(v) : num(v, variable.decimales));
/** Diferencia entre modelos: «3,3 °C»; en las direcciones, el ángulo máximo entre dos modelos. */
const fmtDif = (r, variable) => (variable.circular ? `${Math.round(r.rango)}°` : `${num(r.max - r.min, variable.decimales)} ${variable.unidad}`);
/** El intervalo entre modelos para una celda de la matriz: «22,1–24,3»; las direcciones, «SSE–SO». Un solo valor si coinciden. */
function fmtIntervalo(r, variable) {
  if (!r.n) return "—";
  if (variable.circular) { const [a, b] = arcoCircular(r.valores), ca = cardinal(a), cb = cardinal(b); return ca === cb ? ca : `${ca}–${cb}`; }
  const a = num(r.min, variable.decimales), b = num(r.max, variable.decimales);
  return a === b ? a : `${a}–${b}`;
}
/** Lo mismo con la unidad, para los detalles: «de 22,1 a 24,3 °C». */
function fmtIntervaloLargo(r, variable) {
  if (!r.n) return "—";
  if (variable.circular) { const [a, b] = arcoCircular(r.valores), ca = cardinal(a), cb = cardinal(b); return ca === cb ? `${ca} ${Math.round(a)}°` : `de ${ca} ${Math.round(a)}° a ${cb} ${Math.round(b)}°`; }
  const a = num(r.min, variable.decimales), b = num(r.max, variable.decimales);
  return a === b ? `${a} ${variable.unidad}` : `de ${a} a ${b} ${variable.unidad}`;
}
const difAngular = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Estadística de los modelos prendidos (misma regla que mapa-backend/src/lib/ensamble.js). */
function resumir(valores, visibles, variable, horas = 24) {
  const v = Object.entries(valores).filter(([id, x]) => visibles.has(id) && x != null).map(([, x]) => x);
  if (!v.length) return { media: null, min: null, max: null, rango: null, n: 0, discrepan: false, valores: [] };
  // La lluvia se acumula: el umbral de «discrepan» vale para un día y se achica en proporción si el período es más corto.
  const escala = variable.clave === "lluvia" ? Math.min(1, horas / 24) : 1;
  const umbral = variable.clave === "lluvia" ? Math.max(2, variable.umbral * escala) : variable.umbral, difSecoMojado = Math.max(1, 3 * escala);
  if (variable.circular) { // direcciones: promedio circular y ángulo máximo entre dos modelos
    const sen = v.reduce((a, g) => a + Math.sin((g * Math.PI) / 180), 0), cos = v.reduce((a, g) => a + Math.cos((g * Math.PI) / 180), 0);
    let rango = 0; for (const a of v) for (const b of v) rango = Math.max(rango, difAngular(a, b));
    return { media: ((Math.atan2(sen, cos) * 180) / Math.PI + 360) % 360, min: null, max: null, rango, n: v.length, discrepan: v.length > 1 && rango >= umbral, valores: v };
  }
  const min = Math.min(...v), max = Math.max(...v);
  const seco = (x) => x < 1;
  const lluvia = variable.clave === "lluvia" && v.some(seco) && v.some((x) => !seco(x)) && max - min >= difSecoMojado;
  return { media: v.reduce((a, b) => a + b, 0) / v.length, min, max, rango: max - min, n: v.length, discrepan: v.length > 1 && (max - min >= umbral || lluvia), valores: v };
}

function Marca({ forma, color, x = 0, y = 0, r = 5 }) {
  const p = { fill: color, stroke: "#fff", strokeWidth: 1.2 };
  if (forma === "cuadrado") return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} rx="1" {...p} />;
  if (forma === "cruz") { const a = r + 1, g = 2; return <polygon points={`${x - g},${y - a} ${x + g},${y - a} ${x + g},${y - g} ${x + a},${y - g} ${x + a},${y + g} ${x + g},${y + g} ${x + g},${y + a} ${x - g},${y + a} ${x - g},${y + g} ${x - a},${y + g} ${x - a},${y - g} ${x - g},${y - g}`} {...p} />; }
  if (forma === "hexagono") { const q = r + 1; return <polygon points={Array.from({ length: 6 }, (_, k) => `${x + q * Math.cos((Math.PI / 3) * k)},${y + q * Math.sin((Math.PI / 3) * k)}`).join(" ")} {...p} />; }
  if (forma === "estrella") { const q = r + 2; return <polygon points={Array.from({ length: 10 }, (_, k) => { const rr = k % 2 ? q * 0.45 : q, a = (Math.PI / 5) * k - Math.PI / 2; return `${x + rr * Math.cos(a)},${y + rr * Math.sin(a)}`; }).join(" ")} {...p} />; }
  if (forma === "rombo") return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} {...p} />;
  if (forma === "triangulo") return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y + r} ${x - r - 1},${y + r}`} {...p} />;
  return <circle cx={x} cy={y} r={r} {...p} />;
}
const Icono = ({ id }) => <svg className="ens-marca" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><Marca forma={ESTILO[id].forma} color={ESTILO[id].color} x={7} y={7} r={4.5} /></svg>;

/**
 * Gráfico de líneas interactivo: al pasar el mouse (o con las flechas ← →) marca el período con una guía y muestra
 * el valor de cada modelo, el intervalo y la diferencia; al hacer clic se deja fijado (y se resalta en la tabla de
 * abajo). El modelo más cercano al puntero se destaca. Con muchos períodos (por ejemplo, 10 días por hora) se puede
 * hacer zoom: rueda del mouse (o botones ＋ −, o las teclas + y -), arrastrar para moverse y doble clic (o «Ver todo») para volver.
 */
function Grafico({ depto, variable, modelos, visibles, dia, onDia, intervalo = "dia" }) {
  const W = 760, H = 270, L = 46, R = 14, T = 14, B = 34;
  const [hover, setHover] = useState(null); // { i: período, m: id del modelo más cercano }
  const [vista, setVista] = useState(null); // zoom: { a, b } (primer y último período a la vista) o null = todo
  const svgRef = useRef(null), arrastre = useRef(null), clipId = useId().replace(/:/g, "");
  const dias = depto.dias, n = dias.length, activos = modelos.filter((m) => visibles.has(m.id));
  useEffect(() => setVista(null), [depto.id, variable.clave, n, intervalo]); // otros datos: se vuelve a ver todo
  const a = vista ? Math.max(0, vista.a) : 0, b = vista ? Math.min(n - 1, vista.b) : n - 1;
  const nVis = b - a + 1, enVista = (i) => i >= a && i <= b;
  const MIN_SPAN = Math.min(n - 1, 5); // como mínimo, 6 períodos a la vista

  // Acerca o aleja alrededor de `frac` (0 = borde izquierdo del gráfico, 1 = derecho).
  const zoomEn = (factor, frac = 0.5) => {
    if (n < 3) return;
    const span = b - a, nuevo = Math.max(MIN_SPAN, Math.min(n - 1, Math.round(span * factor)));
    const centro = a + span * frac, na = Math.min(Math.max(0, Math.round(centro - nuevo * frac)), n - 1 - nuevo);
    setVista(nuevo >= n - 1 ? null : { a: na, b: na + nuevo });
  };
  const zoomRef = useRef(zoomEn); zoomRef.current = zoomEn;
  useEffect(() => { // la rueda tiene que ser un listener nativo no pasivo para que no desplace la página mientras se hace zoom
    const el = svgRef.current;
    if (!el) return undefined;
    const alRodar = (e) => {
      if (n < 7) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), frac = Math.min(1, Math.max(0, ((((e.clientX - r.left) / r.width) * W) - L) / (W - L - R)));
      zoomRef.current(e.deltaY < 0 ? 0.75 : 1.33, frac);
    };
    el.addEventListener("wheel", alRodar, { passive: false });
    return () => el.removeEventListener("wheel", alRodar);
  }, [n, depto.id, variable.clave]); // eslint-disable-line react-hooks/exhaustive-deps

  const enRango = dias.slice(a, b + 1);
  const todos = enRango.flatMap((d) => activos.map((m) => d[variable.clave].valores[m.id])).filter((x) => x != null);
  if (!todos.length) return <p className="ens-vacio">{activos.length ? "Sin datos en esta parte del rango." : "Prendé al menos un modelo."}</p>;
  let lo = Math.min(...todos), hi = Math.max(...todos);
  if (variable.circular) { lo = 0; hi = 360; } // direcciones: toda la rosa
  else if (variable.unidad === "%") { lo = 0; hi = 100; }
  else {
    if (["lluvia", "viento", "rafaga", "cape", "uh"].includes(variable.clave)) lo = 0; // no pueden ser negativos
    if (hi - lo < 1) hi = lo + 1;
    const pad = (hi - lo) * 0.08; hi += pad; if (lo !== 0) lo -= pad;
  }
  const x = (i) => (b === a ? (L + W - R) / 2 : L + ((i - a) * (W - L - R)) / (b - a));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = Array.from({ length: 5 }, (_, k) => lo + ((hi - lo) * k) / 4);
  const etiquetaEje = (t) => (variable.circular ? ["N", "E", "S", "O", "N"][Math.round(t / 90)] : num(t, variable.decimales === 0 ? 0 : t % 1 ? 1 : 0));
  const banda = enRango.map((d, k) => ({ i: a + k, r: resumir(d[variable.clave].valores, visibles, variable, d.horas) })).filter((q) => q.r.n > 1);
  const paso = Math.max(1, Math.ceil(nVis / 12)); // con muchos períodos a la vista, se rotula uno de cada tantos
  const radio = nVis > 120 ? 0 : nVis > 60 ? 2.2 : nVis > 30 ? 3.2 : 5; // marcadores más chicos cuanto más hay

  const activo = hover?.i ?? dia; // el período que se está mirando: el del puntero, o el fijado con un clic
  const cercano = (e) => { // período y modelo más cercanos al puntero
    const r = e.currentTarget.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    const i = Math.min(b, Math.max(a, b === a ? a : Math.round(a + ((px - L) / (W - L - R)) * (b - a))));
    let m = null, mejorY = Infinity;
    for (const mod of activos) { const v = dias[i][variable.clave].valores[mod.id]; if (v != null && Math.abs(y(v) - py) < mejorY) { mejorY = Math.abs(y(v) - py); m = mod.id; } }
    return { i, m };
  };
  const alBajar = (e) => { if (vista && e.button === 0) { arrastre.current = { x0: e.clientX, a, b, movido: false }; e.currentTarget.setPointerCapture?.(e.pointerId); } };
  const alMover = (e) => {
    const g = arrastre.current;
    if (g) { // arrastrando con zoom: se corre la ventana
      const r = e.currentTarget.getBoundingClientRect(), porPunto = ((r.width * (W - L - R)) / W) / Math.max(1, g.b - g.a), dx = e.clientX - g.x0;
      if (Math.abs(dx) > 4) g.movido = true;
      if (g.movido) { const d = Math.round(-dx / porPunto), na = Math.min(Math.max(0, g.a + d), n - 1 - (g.b - g.a)); setVista({ a: na, b: na + (g.b - g.a) }); setHover(null); return; }
    }
    setHover(cercano(e));
  };
  const alSoltar = () => { if (arrastre.current?.movido) arrastre.current.suprimirClic = true; setTimeout(() => { arrastre.current = null; }, 0); };
  const tecla = (e) => {
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomEn(0.6); return; }
    if (e.key === "-") { e.preventDefault(); zoomEn(1.6); return; }
    if (e.key === "0") { e.preventDefault(); setVista(null); return; }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const sentido = e.key === "ArrowRight" ? 1 : -1, i = Math.min(n - 1, Math.max(0, (activo ?? (sentido > 0 ? a - 1 : b + 1)) + sentido));
    onDia(i); setHover(null);
    if (vista && !enVista(i)) { const ancho = b - a, na = Math.min(Math.max(0, sentido > 0 ? i - ancho : i), n - 1 - ancho); setVista({ a: na, b: na + ancho }); }
  };
  const dato = activo != null && enVista(activo) ? dias[activo] : null, resumen = dato ? resumir(dato[variable.clave].valores, visibles, variable, dato.horas) : null;
  const izquierda = dato && x(activo) > W * 0.55; // la ventanita se abre hacia el lado con lugar

  return (
    <div className="ens-grafico-caja">
      {n > 6 && <div className="ens-zoom" role="group" aria-label="Zoom del gráfico">
        <span>{vista ? `${etiquetaLarga(dias[a], intervalo)} → ${etiquetaLarga(dias[b], intervalo)}` : `Todo el rango (${n} períodos)`}</span>
        <button type="button" onClick={() => zoomEn(0.6)} disabled={nVis <= MIN_SPAN + 1} aria-label="Acercar" title="Acercar (rueda del mouse o +)">＋</button>
        <button type="button" onClick={() => zoomEn(1.6)} disabled={!vista} aria-label="Alejar" title="Alejar (rueda del mouse o -)">－</button>
        <button type="button" onClick={() => setVista(null)} disabled={!vista} title="Volver a ver todo el rango (doble clic o 0)">Ver todo</button>
      </div>}
      <svg ref={svgRef} className={`ens-grafico${vista ? " ens-grafico--zoom" : ""}`} viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} aria-label={`${variable.nombre} por modelo, ${depto.nombre}. Usá las flechas para recorrer los períodos y + o - para el zoom.`}
        onPointerDown={alBajar} onPointerMove={alMover} onPointerUp={alSoltar} onPointerCancel={alSoltar} onPointerLeave={() => setHover(null)}
        onDoubleClick={() => setVista(null)}
        onClick={(e) => { if (arrastre.current?.suprimirClic) return; const { i } = cercano(e); onDia(dia === i ? null : i); }} onKeyDown={tecla}>
        <defs><clipPath id={clipId}><rect x={L} y={T - 4} width={W - L - R} height={H - T - B + 8} /></clipPath></defs>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="ens-grilla" /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="ens-eje">{etiquetaEje(t)}</text></g>)}
        {enRango.map((d, k) => { const i = a + k; return (k % paso === 0 || i === activo) && <text key={`${d.desde}|${i}`} x={x(i)} y={H - 10} textAnchor="middle" className={`ens-eje${i === activo ? " ens-eje--on" : ""}`}>{intervalo === "dia" ? `${diaCorto(d.fecha)} ${diaMes(d.fecha).split("/")[0]}` : etiquetaPeriodo(d, intervalo).a}</text>; })}
        <g clipPath={`url(#${clipId})`}>
          {banda.length > 1 && <polygon className="ens-banda" points={[...banda.map((q) => `${x(q.i)},${y(q.r.max)}`), ...banda.slice().reverse().map((q) => `${x(q.i)},${y(q.r.min)}`)].join(" ")} />}
          {activo != null && enVista(activo) && <line x1={x(activo)} x2={x(activo)} y1={T} y2={H - B} className={`ens-guia${activo === dia ? " ens-guia--fija" : ""}`} />}
          {activos.map((m) => {
            const { color, forma } = ESTILO[m.id];
            const pts = enRango.map((d, k) => ({ i: a + k, v: d[variable.clave].valores[m.id] })).filter((p) => p.v != null);
            return <g key={m.id}>
              <polyline fill="none" stroke={color} strokeWidth={hover?.m === m.id ? 3 : nVis > 60 ? 1.5 : 2} strokeLinejoin="round" points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} opacity={hover && hover.m !== m.id ? 0.35 : 0.85} />
              {pts.filter((p) => radio > 0 || p.i === activo).map((p) => <Marca key={p.i} forma={forma} color={color} x={x(p.i)} y={y(p.v)} r={p.i === activo ? (hover?.m === m.id ? 8 : 6.5) : radio} />)}
            </g>;
          })}
        </g>
      </svg>
      {dato && resumen && <div className={`ens-tip${izquierda ? " ens-tip--izq" : ""}${activo === dia ? " ens-tip--fija" : ""}`} style={{ left: `${(x(activo) / W) * 100}%` }} role="status">
        <p className="ens-tip-dia">{etiquetaLarga(dato, intervalo)}{activo === dia && <span> · fijado</span>}</p>
        <ul>{activos.map((m) => { const v = dato[variable.clave].valores[m.id]; return <li key={m.id} className={hover?.m === m.id ? "is-cerca" : ""} style={{ "--c": ESTILO[m.id].color }}>
          <Icono id={m.id} /><span>{m.nombre}</span><strong>{v == null ? "sin dato" : fmtVal(v, variable)}</strong></li>; })}</ul>
        <p className="ens-tip-pie"><span>Intervalo</span><strong>{fmtIntervaloLargo(resumen, variable)}</strong></p>
        {resumen.n > 1 && <p className="ens-tip-pie"><span>Diferencia</span><strong className={resumen.discrepan ? "ens-alerta" : ""}>{fmtDif(resumen, variable)}{resumen.discrepan ? " · discrepan" : ""}</strong></p>}
      </div>}
      <p className="ens-nota">Pasá el mouse por el gráfico para ver el detalle de cada período; un clic lo deja fijado.{n > 6 ? " Rueda del mouse: zoom · arrastrar: moverse (con zoom) · doble clic: ver todo." : ""}</p>
    </div>
  );
}

/**
 * Hora por hora (o de 6 en 6 h si el período es muy largo) del período elegido en la matriz, para el departamento y la variable
 * que se están mirando: gráfico y tabla con lo que dice cada modelo, el intervalo entre ellos y, en la lluvia, el acumulado.
 */
function Desglose({ estado, depto, variable, visibles, periodo, intervalo }) {
  const [sel, setSel] = useState(null);
  useEffect(() => setSel(null), [estado?.datos]);
  const dh = estado?.datos, dd = dh?.departamentos.find((d) => d.id === depto.id);
  const modelos = dh ? dh.modelos.filter((m) => visibles.has(m.id)) : [];
  const filas = dd ? dd.dias.map((p) => ({ p, v: p[variable.clave].valores, r: resumir(p[variable.clave].valores, visibles, variable, p.horas) })) : [];
  const suma = (id) => { const vs = filas.map((f) => f.v[id]); return vs.length && vs.every((x) => x != null) ? vs.reduce((a, b) => a + b, 0) : null; };
  const paso = dh?.intervalo === "hora" ? "hora por hora" : "cada 6 horas";
  return <div className="ens-desglose">
    <h2 className="ens-titulo">{paso[0].toUpperCase() + paso.slice(1)} · {depto.nombre} · {variable.nombre.toLowerCase()} <small>({etiquetaLarga(periodo, intervalo)})</small></h2>
    {estado.cargando && <p className="ens-vacio" role="status">Consultando {paso}…</p>}
    {estado.error && <div className="risk-message risk-message--error" role="alert">{estado.error}</div>}
    {dd && <>
      <Grafico depto={dd} variable={variable} modelos={dh.modelos} visibles={visibles} dia={sel} onDia={setSel} intervalo={dh.intervalo} />
      <div className="ens-detalle-caja">
        <table className="ens-detalle">
          <thead><tr><th scope="col">{dh.intervalo === "hora" ? "Hora" : "Horas"}</th>{modelos.map((m) => <th key={m.id} scope="col" style={{ "--c": ESTILO[m.id].color }}><Icono id={m.id} /> {m.nombre}</th>)}<th scope="col">Intervalo</th><th scope="col">Diferencia</th></tr></thead>
          <tbody>{filas.map(({ p, v, r }, i) => <tr key={p.desde} className={`${sel === i ? "ens-fila--on" : ""}${r.discrepan ? " ens-fila--disc" : ""}`} onClick={() => setSel(i)}>
            <th scope="row">{etiquetaPeriodo(p, dh.intervalo).a} <small>{p.fecha === periodo.fecha ? "" : etiquetaPeriodo(p, dh.intervalo).b}</small></th>
            {modelos.map((m) => <td key={m.id}>{variable.circular ? fmtVal(v[m.id], variable) : num(v[m.id], variable.decimales)}</td>)}
            <td><strong>{fmtIntervaloLargo(r, variable)}</strong>{r.n > 0 && r.n < visibles.size ? <small> ({r.n} de {visibles.size})</small> : null}</td>
            <td>{r.n > 1 ? fmtDif(r, variable) : "—"}{r.discrepan ? <span className="ens-alerta"> discrepan</span> : null}</td>
          </tr>)}</tbody>
          {variable.clave === "lluvia" && filas.length > 1 && <tfoot><tr><th scope="row">Acumulado</th>{modelos.map((m) => <td key={m.id}><strong>{num(suma(m.id), variable.decimales)}</strong></td>)}<td colSpan={2}>Suma de las horas de arriba ({variable.unidad})</td></tr></tfoot>}
        </table>
      </div>
      {dh.intervalo === "hora" && <p className="ens-nota">Cada fila es la hora entre las dos horas indicadas: la lluvia es lo acumulado en ese lapso; la temperatura y el viento, lo que ocurre entre ambas. Algunos modelos publican cada 3 o 6 horas y en las horas intermedias el valor es interpolado.</p>}
    </>}
  </div>;
}

export default function EnsamblePage() {
  const [datos, setDatos] = useState(null), [error, setError] = useState(""), [cargando, setCargando] = useState(false);
  const [clave, setClave] = useState("tmax"), [deptoId, setDeptoId] = useState("4");
  const [prendidos, setPrendidos] = useState(() => new Set(CATALOGO.filter((m) => !m.deshabilitado).map((m) => m.id))); // los que se consultan al tocar «Consultar»
  const [dia, setDia] = useState(null);
  const [descargas, setDescargas] = useState(null); // lo que bajó el servidor de cada modelo: { ahora, modelos: [...] }
  const [buscando, setBuscando] = useState(false);
  const [intervalo, setIntervalo] = useState("dia"); // cómo se parte el rango en columnas
  const [desglose, setDesglose] = useState(null); // hora por hora del período elegido: { cargando, error, datos }
  // Rango a consultar (hora de Misiones). La pantalla NO pide nada sola: sólo al tocar «Consultar».
  const [fDesde, setFDesde] = useState(hoyART()), [hDesde, setHDesde] = useState("00:00");
  const [fHasta, setFHasta] = useState(sumarDias(hoyART(), 9)), [hHasta, setHHasta] = useState("23:00");
  const informe = useInforme(); // el borrador del informe vive acá (siempre montado): ocultar el cajón no pierde nada
  const [cajon, setCajon] = useState(false);
  const [avance, setAvance] = useState(null); // descarga (WRF-SMN, MONAN) en el servidor
  const [espera, setEspera] = useState(0); // > 0 mientras algún modelo sigue bajando (la consulta ya mostró los demás)
  const ultimo = useRef(null); // el pedido de la última consulta, para repetirlo cuando el WRF termina
  const atajo = (dias) => { setFDesde(hoyART()); setHDesde("00:00"); setFHasta(sumarDias(hoyART(), dias)); setHHasta("23:00"); };

  // Cambiar el intervalo (hora, 3 h, día…) rehace al instante la tabla, el gráfico y el detalle con el mismo rango: los datos ya están en el servidor.
  function cambiarIntervalo(id) {
    setIntervalo(id);
    if (datos && ultimo.current && !cargando) { ultimo.current = { ...ultimo.current, intervalo: id }; setDia(null); consultar(true); }
  }

  function consultar(repetir = false) {
    setCargando(true); setError("");
    if (!repetir) ultimo.current = { desde: `${fDesde}T${hDesde}`, hasta: `${fHasta}T${hHasta}`, modelos: [...prendidos], intervalo };
    api.getEnsamble(ultimo.current)
      .then((d) => {
        setDatos(d); setEspera((n) => (d.pendientes?.length ? n + 1 : 0));
        if (!repetir) setDia(null);
        setDeptoId((id) => (d.departamentos.some((x) => x.id === id) ? id : d.departamentos[0].id));
      })
      .catch((e) => { setError(e.message); setEspera(0); }).finally(() => setCargando(false));
  }
  const consultarRef = useRef(consultar); consultarRef.current = consultar;

  // El servidor baja cada modelo solo, apenas sale una corrida nueva. Acá sólo se lee, cada minuto, qué tiene y cuándo espera lo próximo.
  const cargarDescargas = () => api.getEnsambleEstado().then(setDescargas).catch(() => {});
  useEffect(() => { cargarDescargas(); const t = setInterval(cargarDescargas, 60000); return () => clearInterval(t); }, []);
  async function buscarActualizaciones() {
    setBuscando(true);
    try { setDescargas(await api.actualizarEnsamble()); } catch (e) { setError(e.message); } finally { setBuscando(false); }
  }
  const bajando = descargas?.modelos.some((m) => m.descargando);
  useEffect(() => { if (!bajando) return undefined; const t = setInterval(cargarDescargas, 8000); return () => clearInterval(t); }, [bajando]);
  const descargaDe = (id) => descargas?.modelos.find((m) => m.id === id);
  const ultimaDescarga = descargas?.modelos.map((m) => m.descargadoEn).filter(Boolean).sort().at(-1) || null;
  const proximas = (descargas?.modelos || []).filter((m) => m.proxima).sort((a, b) => Date.parse(a.proxima) - Date.parse(b.proxima));
  const proxima = proximas.find((m) => Date.parse(m.proxima) > Date.now()) || proximas[0] || null;

  // El WRF-SMN y el MONAN bajan en el servidor (el WRF puede llevar minutos): se mira el avance cada 3 s SÓLO mientras eso dura y,
  // al terminar, se repite la consulta una vez para sumarlos. Si la consulta no se pidió, no se mira nada.
  useEffect(() => {
    if (!espera) { setAvance(null); return undefined; }
    const inicio = Date.now();
    const t = setInterval(async () => {
      try {
        const p = await api.getEnsambleProgreso();
        setAvance(p.activo ? p : null);
        if (Date.now() - inicio > 20 * 60000) { clearInterval(t); setEspera(0); setError("Algún modelo no terminó de descargarse. Probá consultar de nuevo en un rato."); }
        else if (!p.activo) { clearInterval(t); consultarRef.current(true); }
      } catch { /* se reintenta en el próximo ciclo */ }
    }, 3000);
    return () => clearInterval(t);
  }, [espera]);

  const variable = datos?.variables.find((v) => v.clave === clave);
  const depto = datos?.departamentos.find((d) => d.id === deptoId);
  // Lo que se muestra: los prendidos que están en la última consulta (el resto no se pidió, no hay dato).
  const consultados = useMemo(() => new Set((datos?.modelos || []).map((m) => m.id)), [datos]);
  const visibles = useMemo(() => new Set([...prendidos].filter((id) => !datos || consultados.has(id))), [prendidos, consultados, datos]);
  const pendientes = datos?.pendientes || [];
  const sinConsultar = datos ? [...prendidos].filter((id) => !consultados.has(id) && !pendientes.includes(id)) : [];
  const alternar = (id) => CATALOGO.find((m) => m.id === id)?.deshabilitado || setPrendidos((s) => { const n = new Set(s); if (n.has(id)) { if (n.size > 1) n.delete(id); } else n.add(id); return n; });
  const intDatos = datos?.intervalo || "dia"; // el de la última consulta (puede no ser el que está elegido ahora)
  const filas = useMemo(() => (datos && variable ? datos.departamentos.map((d) => ({ d, celdas: d.dias.map((x) => resumir(x[clave].valores, visibles, variable, x.horas)) })) : []), [datos, variable, clave, visibles]);
  const resumenDepto = depto && variable ? depto.dias.map((x) => resumir(x[clave].valores, visibles, variable, x.horas)) : [];

  // Al elegir un período en la matriz o el gráfico se pide su detalle hora por hora (salvo que ya se esté viendo por hora).
  const periodoElegido = dia != null ? datos?.dias[dia] : null;
  const consultadosClave = [...consultados].join(",");
  useEffect(() => {
    if (!periodoElegido || intDatos === "hora" || !consultadosClave || periodoElegido.desde >= periodoElegido.hasta) { setDesglose(null); return undefined; }
    let cancelado = false;
    setDesglose({ cargando: true, error: "", datos: null });
    api.getEnsamble({ desde: periodoElegido.desde, hasta: periodoElegido.hasta, intervalo: periodoElegido.horas <= 72 ? "hora" : "6h", modelos: consultadosClave.split(",") })
      .then((d) => { if (!cancelado) setDesglose({ cargando: false, error: "", datos: d }); })
      .catch((e) => { if (!cancelado) setDesglose({ cargando: false, error: e.message, datos: null }); });
    return () => { cancelado = true; };
  }, [periodoElegido?.desde, periodoElegido?.hasta, intDatos, consultadosClave, datos?.generado]); // eslint-disable-line react-hooks/exhaustive-deps
  const generado = datos ? new Date(datos.generado).toLocaleString("es-AR", { timeZone: AR, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "";

  return <div className={`admin-layout ens-layout${cajon ? " ens-layout--cajon" : ""}`}>
    <BrandHeader subtitulo="Ensamble multimodelo"><VolverConfiguracion /></BrandHeader>
    <aside className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading"><h1>Ensamble multimodelo</h1>
        <p>Qué dice cada modelo numérico para cada departamento, a 10 días. Es una guía para el pronosticador; con el informe del cajón se arma el pronóstico del día y se puede publicar.</p></div>
      <h2>Modelos</h2>
      <div className="ens-modelos" role="group" aria-label="Modelos">
        {CATALOGO.map((m) => <button key={m.id} type="button" title={m.nota} disabled={!!m.deshabilitado} className={`ens-modelo${m.deshabilitado ? " ens-modelo--apagado ens-modelo--no-disponible" : prendidos.has(m.id) ? "" : " ens-modelo--apagado"}`} style={{ "--c": ESTILO[m.id].color }} onClick={() => alternar(m.id)} aria-pressed={prendidos.has(m.id)}>
          <span className="ens-modelo-cab"><Icono id={m.id} /><strong>{m.nombre}</strong><span className="ens-interruptor" aria-hidden="true" /></span>
          <span className="ens-modelo-origen">{m.detalle}</span>
          {!m.deshabilitado && (() => { const e = descargaDe(m.id); return e && <span className="ens-modelo-datos">{e.descargando ? "Descargando una corrida nueva…" : e.descargadoEn ? `Corrida ${horaUtc(e.corrida)} · bajada ${cuando(e.descargadoEn)} · próxima ${proximaTxt(e)}` : e.error ? `Error al descargar: ${e.error}` : "Todavía sin descargar"}</span>; })()}
          {m.deshabilitado && <span className="ens-sin-consultar">Desactivado hasta tener acceso al CPTEC</span>}
          {datos && prendidos.has(m.id) && !consultados.has(m.id) && <span className="ens-sin-consultar">{pendientes.includes(m.id) ? "Descargando… se suma solo" : "Sin consultar: tocá «Consultar»"}</span>}
        </button>)}
      </div>
      <p className="ens-nota">Prendé los que querés comparar: <strong>Consultar</strong> usa sólo esos. Pasá el mouse por una tarjeta para ver el detalle.</p>
    </aside>

    <div className="admin-map-area ens-area">
      <form className="ens-rango" onSubmit={(e) => { e.preventDefault(); consultar(); }}>
        <div className="ens-rango-caja">
          <div className="ens-rango-cab"><h2>Rango a consultar</h2><p>Hora de Misiones · hasta 7 días atrás y 9 adelante, máximo 10 días de rango.</p></div>
          <div className="ens-descargas" role="status">
            <p><strong>Datos de los modelos:</strong> los descarga el servidor solo cuando sale cada corrida y quedan guardados; al consultar no se baja nada.</p>
            <p>Última descarga: <strong>{ultimaDescarga ? cuando(ultimaDescarga) : descargas ? "ninguna todavía" : "…"}</strong> · Próxima actualización: <strong>{proxima ? `${proximaTxt(proxima)} (${proxima.nombre})` : "…"}</strong>
              {bajando && <> · <em>descargando ahora: {descargas.modelos.filter((m) => m.descargando).map((m) => m.nombre).join(", ")}</em></>}
              {" "}<button type="button" className="btn-link" onClick={buscarActualizaciones} disabled={buscando}>{buscando ? "Buscando…" : "Buscar actualizaciones ahora"}</button></p>
          </div>
          <div className="ens-rango-campos">
            <div className="ens-rango-par"><CampoFecha label="Desde" value={fDesde} onChange={(v) => v && setFDesde(v)} min={sumarDias(hoyART(), -7)} max={sumarDias(hoyART(), 9)} disabled={cargando} /><CampoHora label="Hora" value={hDesde} onChange={setHDesde} disabled={cargando} /></div>
            <span className="ens-rango-flecha" aria-hidden="true">→</span>
            <div className="ens-rango-par"><CampoFecha label="Hasta" value={fHasta} onChange={(v) => v && setFHasta(v)} min={fDesde} max={sumarDias(hoyART(), 9)} disabled={cargando} /><CampoHora label="Hora" value={hHasta} onChange={setHHasta} disabled={cargando} /></div>
          </div>
          <div className="ens-intervalos" role="group" aria-label="Intervalo de tiempo">
            <span>Ver por</span>
            {INTERVALOS.map((i) => <button key={i.id} type="button" className={`ens-chip${intervalo === i.id ? " ens-chip--on" : ""}`} aria-pressed={intervalo === i.id} disabled={cargando} onClick={() => cambiarIntervalo(i.id)}>{i.txt}</button>)}
          </div>
          <p className="ens-nota ens-intervalos-nota">{{ hora: "Una columna por hora (hasta 10 días de rango, 240 columnas). La lluvia es lo acumulado en esa hora.", "3h": "Una columna cada 3 horas, de 00 a 03, de 03 a 06…", "6h": "Una columna cada 6 horas, de 00 a 06, de 06 a 12…", "12h": "Una columna cada 12 horas (de 00 a 12 y de 12 a 24).", dia: "Una columna por día. Al tocar una, abajo se abre el detalle hora por hora.", mes: "Los modelos llegan a 10 días: «Mes» y «Año» resumen lo que haya del rango dentro de ese mes o año.", anio: "Los modelos llegan a 10 días: «Mes» y «Año» resumen lo que haya del rango dentro de ese mes o año.", rango: "Una sola columna con todo el rango: la lluvia es lo acumulado entre las dos horas elegidas." }[intervalo]}</p>
          <div className="ens-rango-pie">
            <span className="ens-atajos"><span>Atajos</span>{ATAJOS.map((a) => <button key={a.txt} type="button" className="ens-chip" disabled={cargando} onClick={() => atajo(a.dias)}>{a.txt}</button>)}</span>
            <button type="submit" className="ens-consultar" disabled={cargando}>{cargando ? "Consultando…" : datos ? "Consultar de nuevo" : "Consultar"}</button>
          </div>
          {(cargando || espera > 0) && <div className="ens-avance" role="status">
            {espera > 0
              ? <><span>Los modelos que faltan ({new Intl.ListFormat("es", { style: "long", type: "conjunction" }).format(pendientes.map((id) => CATALOGO.find((m) => m.id === id)?.nombre))}) se están descargando{(() => { const t = (avance?.wrf?.total || 0) + (avance?.monan?.total || 0), h = (avance?.wrf?.hechos || 0) + (avance?.monan?.hechos || 0); return t ? `: ${h} de ${t} archivos` : "…"; })()}. Los demás ya están abajo; se suman solos cuando terminan.</span>{((avance?.wrf?.total || 0) + (avance?.monan?.total || 0)) > 0 && <progress value={(avance.wrf.hechos || 0) + (avance.monan.hechos || 0)} max={(avance.wrf.total || 0) + (avance.monan.total || 0)} />}</>
              : <span>Consultando a los modelos…</span>}
          </div>}
        </div>
        <BotonInforme abierto={cajon} onClick={() => setCajon((a) => !a)} escritos={informe.escritos} />
        {datos && !cargando && <span className="ens-actualizado">Último pedido a las {generado}</span>}
      </form>
      {error && <div className="risk-message risk-message--error" role="alert">{error}</div>}
      {datos?.avisos?.length > 0 && <div className="risk-message risk-message--error" role="alert">{datos.avisos.map((a) => <div key={a}>{a}</div>)}</div>}
      {sinConsultar.length > 0 && <div className="risk-message" role="status">Prendiste {sinConsultar.map((id) => CATALOGO.find((m) => m.id === id).nombre).join(", ")} después de consultar: todavía no tiene datos. Tocá <strong>Consultar de nuevo</strong> para sumarlo.</div>}
      {!datos && !error && <p className="ens-vacio">Elegí el rango de fecha y hora y tocá <strong>Consultar</strong>. Los datos ya están guardados en el servidor (lo de arriba dice cuándo se bajaron), así que la consulta es instantánea.</p>}
      {datos && variable && <>
        <div className="ens-barra">
          <div className="ens-variables-caja">
            <div className="ens-grupos" role="tablist" aria-label="Tipo de dato">
              {[...new Set(datos.variables.map((v) => v.grupo))].map((g) => <button key={g} role="tab" aria-selected={g === variable.grupo} className={`ens-grupo${g === variable.grupo ? " ens-grupo--on" : ""}`} onClick={() => setClave(datos.variables.find((v) => v.grupo === g).clave)}>{g}</button>)}
            </div>
            <div className="ens-variables" role="tablist" aria-label="Variable">
              {datos.variables.filter((v) => v.grupo === variable.grupo).map((v) => <button key={v.clave} role="tab" aria-selected={v.clave === clave} className={`ens-pestana${v.clave === clave ? " ens-pestana--on" : ""}`} onClick={() => setClave(v.clave)}>{v.nombre}</button>)}
            </div>
          </div>
        </div>

        <div className="ens-intervalos ens-intervalos--resultado" role="group" aria-label="Ver la tabla, el gráfico y el detalle por">
          <span>Ver por</span>
          {INTERVALOS.map((i) => <button key={i.id} type="button" className={`ens-chip${intervalo === i.id ? " ens-chip--on" : ""}`} aria-pressed={intervalo === i.id} disabled={cargando} onClick={() => cambiarIntervalo(i.id)}>{i.txt}</button>)}
        </div>
        <h2 className="ens-titulo">Intervalo entre modelos por departamento <small>({variable.unidad}) · <span className="ens-disc-ej">resaltado</span> = los modelos discrepan {variable.clave === "lluvia" ? `(≥ ${variable.umbral} mm en un día, proporcional si el período es más corto; o unos secos y otros con lluvia)` : (variable.circular ? `(≥ ${variable.umbral}° entre dos modelos)` : `(≥ ${variable.umbral} ${variable.unidad} entre el más alto y el más bajo)`)}</small></h2>
        <p className="ens-leyenda"><strong>Cómo leer esta tabla:</strong> cada celda muestra el <strong>valor más bajo y el más alto</strong> entre los modelos que tenés prendidos a la izquierda ({[...visibles].map((id) => CATALOGO.find((m) => m.id === id)?.nombre).join(", ")}), para ese departamento y ese período; si todos coinciden, un solo número. {{ sum: "Cada modelo aporta la lluvia acumulada en el período (entre sus dos horas).", min: "Cada modelo aporta su mínima del período.", max: "Cada modelo aporta su máximo del período.", mean: "Cada modelo aporta el promedio del período.", dir: "Cada modelo aporta la dirección de la que sopla el viento (predominante del período); la celda muestra de qué punto a qué punto cardinal va el abanico." }[variable.agrega]} <strong>Tocá una celda o un departamento</strong> para ver abajo el desglose, modelo por modelo{intDatos !== "hora" ? " y hora por hora" : ""}. {intDatos === "dia" ? "Los días con «parcial» sólo cuentan las horas del rango elegido." : ""}</p>
        <div className="ens-matriz-caja">
          <table className="ens-matriz">
            <thead><tr><th scope="col">Departamento</th>{datos.dias.map((f, i) => { const e = etiquetaPeriodo(f, intDatos); return <th key={`${f.desde}|${i}`} scope="col" title={intDatos === "dia" && f.horas < 24 ? `Parcial: ${f.horas} de 24 h` : undefined}><span>{e.a}</span>{e.b}{intDatos === "dia" && f.horas < 24 && <em className="ens-parcial">parcial</em>}</th>; })}</tr></thead>
            <tbody>{filas.map(({ d, celdas }) => <tr key={d.id} className={d.id === deptoId ? "ens-fila--on" : ""}>
              <th scope="row"><button className="btn-link" onClick={() => { setDeptoId(d.id); setDia(null); }}>{d.nombre}</button></th>
              {celdas.map((c, i) => <td key={i} className={`${c.discrepan ? "ens-celda--disc" : ""}${d.id === deptoId && dia === i ? " ens-celda--sel" : ""}`} title={c.n ? `${c.n} modelo${c.n > 1 ? "s" : ""}: ${fmtIntervaloLargo(c, variable)}` : ""}>
                <button type="button" onClick={() => { setDeptoId(d.id); setDia(i); }}>{fmtIntervalo(c, variable)}</button></td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <p className="ens-nota">Más allá de los primeros días ICON y GEM dejan de cubrir el horizonte: ese período el intervalo sale de menos modelos (lo dice el detalle).</p>

        {depto && <>
          <h2 className="ens-titulo">{depto.nombre} · {variable.nombre.toLowerCase()} <small>(centroide {num(depto.lat, 2)}, {num(depto.lng, 2)})</small></h2>
          <Grafico depto={depto} variable={variable} modelos={datos.modelos} visibles={visibles} dia={dia} onDia={setDia} intervalo={intDatos} />
          <div className="ens-detalle-caja">
            <table className="ens-detalle">
              <thead><tr><th scope="col">Período</th>{datos.modelos.filter((m) => visibles.has(m.id)).map((m) => <th key={m.id} scope="col" style={{ "--c": ESTILO[m.id].color }}><Icono id={m.id} /> {m.nombre}</th>)}<th scope="col">Intervalo</th><th scope="col">Diferencia</th></tr></thead>
              <tbody>{depto.dias.map((x, i) => { const r = resumenDepto[i]; return <tr key={`${x.desde}|${i}`} className={`${dia === i ? "ens-fila--on" : ""}${r.discrepan ? " ens-fila--disc" : ""}`} onClick={() => setDia(i)}>
                <th scope="row">{(() => { const e = etiquetaPeriodo(x, intDatos); return intDatos === "dia" ? `${e.a} ${e.b}` : <>{e.a} <small>{e.b}</small></>; })()}</th>
                {datos.modelos.filter((m) => visibles.has(m.id)).map((m) => <td key={m.id}>{variable.circular ? fmtVal(x[clave].valores[m.id], variable) : num(x[clave].valores[m.id], variable.decimales)}</td>)}
                <td><strong>{fmtIntervaloLargo(r, variable)}</strong>{r.n > 0 && r.n < visibles.size ? <small> ({r.n} de {visibles.size})</small> : null}</td>
                <td>{r.n > 1 ? fmtDif(r, variable) : "—"}{r.discrepan ? <span className="ens-alerta"> discrepan</span> : null}</td>
              </tr>; })}</tbody>
            </table>
          </div>
          {desglose && periodoElegido && <Desglose estado={desglose} depto={depto} variable={variable} visibles={visibles} periodo={periodoElegido} intervalo={intDatos} />}
        </>}
        <p className="ens-nota">Fuentes: Open-Meteo (ECMWF IFS, GFS, ICON y GEM){datos.modelos.some((m) => m.id === "wrf_smn") && "; WRF-SMN del Servicio Meteorológico Nacional (datos abiertos en AWS, CC BY 2.5 Argentina)"}{datos.modelos.some((m) => m.id.startsWith("monan")) && "; MONAN del CPTEC/INPE, Brasil (datos abiertos)"}. Corridas (inicio): {Object.entries(datos.corridas || {}).map(([id, iso]) => `${CATALOGO.find((m) => m.id === id)?.nombre} ${new Date(iso).toLocaleString("es-AR", { timeZone: "UTC", day: "2-digit", month: "2-digit", hour: "2-digit", hourCycle: "h23" }).replace(/, (\d+)$/, " $1")} UTC`).join(" · ") || "—"}. En el centroide de cada departamento. Ráfaga y viento son los máximos del día a 10 m. WRF-SMN: temperatura calibrada por el SMN (mínima de 21 a 9 h, máxima de 9 a 21 h, sólo si el rango cubre esas horas) y lluvia horaria. Reflectividad y helicidad: sólo MONAN 3 km. MONAN 10 km sale cada 3 horas: sus máximas y mínimas son aproximadas.</p>
      </>}
    </div>
    <InformeEnsamble informe={informe} abierto={cajon} onCerrar={() => setCajon(false)} prendidos={prendidos} modelos={CATALOGO} />
  </div>;
}
