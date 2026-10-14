import { useEffect, useMemo, useRef, useState } from "react";
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
const difAngular = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Estadística de los modelos prendidos (misma regla que mapa-backend/src/lib/ensamble.js). */
function resumir(valores, visibles, variable) {
  const v = Object.entries(valores).filter(([id, x]) => visibles.has(id) && x != null).map(([, x]) => x);
  if (!v.length) return { media: null, min: null, max: null, rango: null, n: 0, discrepan: false };
  if (variable.circular) { // direcciones: promedio circular y ángulo máximo entre dos modelos
    const sen = v.reduce((a, g) => a + Math.sin((g * Math.PI) / 180), 0), cos = v.reduce((a, g) => a + Math.cos((g * Math.PI) / 180), 0);
    let rango = 0; for (const a of v) for (const b of v) rango = Math.max(rango, difAngular(a, b));
    return { media: ((Math.atan2(sen, cos) * 180) / Math.PI + 360) % 360, min: null, max: null, rango, n: v.length, discrepan: v.length > 1 && rango >= variable.umbral };
  }
  const min = Math.min(...v), max = Math.max(...v);
  const seco = (x) => x < 1;
  const lluvia = variable.clave === "lluvia" && v.some(seco) && v.some((x) => !seco(x)) && max - min >= 3;
  return { media: v.reduce((a, b) => a + b, 0) / v.length, min, max, rango: max - min, n: v.length, discrepan: v.length > 1 && (max - min >= variable.umbral || lluvia) };
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
 * Gráfico de líneas interactivo: al pasar el mouse (o con las flechas ← →) marca el día con una guía y muestra
 * el valor de cada modelo, el promedio y la diferencia; al hacer clic se deja fijado (y se resalta ese día en
 * la tabla de abajo). El modelo más cercano al puntero se destaca.
 */
function Grafico({ depto, variable, modelos, visibles, dia, onDia }) {
  const W = 760, H = 270, L = 46, R = 14, T = 14, B = 34;
  const [hover, setHover] = useState(null); // { i: día, m: id del modelo más cercano }
  const dias = depto.dias, activos = modelos.filter((m) => visibles.has(m.id));
  const todos = dias.flatMap((d) => activos.map((m) => d[variable.clave].valores[m.id])).filter((x) => x != null);
  if (!todos.length) return <p className="ens-vacio">Prendé al menos un modelo.</p>;
  let lo = Math.min(...todos), hi = Math.max(...todos);
  if (variable.circular) { lo = 0; hi = 360; } // direcciones: toda la rosa
  else if (variable.unidad === "%") { lo = 0; hi = 100; }
  else {
    if (["lluvia", "viento", "rafaga", "cape", "uh"].includes(variable.clave)) lo = 0; // no pueden ser negativos
    if (hi - lo < 1) hi = lo + 1;
    const pad = (hi - lo) * 0.08; hi += pad; if (lo !== 0) lo -= pad;
  }
  const x = (i) => (dias.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (dias.length - 1));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = Array.from({ length: 5 }, (_, k) => lo + ((hi - lo) * k) / 4);
  const etiquetaEje = (t) => (variable.circular ? ["N", "E", "S", "O", "N"][Math.round(t / 90)] : num(t, variable.decimales === 0 ? 0 : t % 1 ? 1 : 0));
  const banda = dias.map((d, i) => ({ i, r: resumir(d[variable.clave].valores, visibles, variable) })).filter((b) => b.r.n > 1);

  const activo = hover?.i ?? dia; // el día que se está mirando: el del puntero, o el fijado con un clic
  const cercano = (e) => { // día y modelo más cercanos al puntero
    const r = e.currentTarget.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    let i = 0, mejorX = Infinity;
    dias.forEach((_, k) => { const d = Math.abs(x(k) - px); if (d < mejorX) { mejorX = d; i = k; } });
    let m = null, mejorY = Infinity;
    for (const mod of activos) { const v = dias[i][variable.clave].valores[mod.id]; if (v != null && Math.abs(y(v) - py) < mejorY) { mejorY = Math.abs(y(v) - py); m = mod.id; } }
    return { i, m };
  };
  const tecla = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const paso = e.key === "ArrowRight" ? 1 : -1, i = Math.min(dias.length - 1, Math.max(0, (activo ?? (paso > 0 ? -1 : dias.length)) + paso));
    onDia(i); setHover(null);
  };
  const dato = activo != null ? dias[activo] : null, resumen = dato ? resumir(dato[variable.clave].valores, visibles, variable) : null;
  const izquierda = activo != null && x(activo) > W * 0.55; // la ventanita se abre hacia el lado con lugar

  return (
    <div className="ens-grafico-caja">
      <svg className="ens-grafico" viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} aria-label={`${variable.nombre} por modelo, ${depto.nombre}. Usá las flechas para recorrer los días.`}
        onPointerMove={(e) => setHover(cercano(e))} onPointerLeave={() => setHover(null)} onClick={(e) => { const { i } = cercano(e); onDia(dia === i ? null : i); }} onKeyDown={tecla}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="ens-grilla" /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="ens-eje">{etiquetaEje(t)}</text></g>)}
        {dias.map((d, i) => <text key={d.fecha} x={x(i)} y={H - 10} textAnchor="middle" className={`ens-eje${i === activo ? " ens-eje--on" : ""}`}>{diaCorto(d.fecha)} {diaMes(d.fecha).split("/")[0]}</text>)}
        {banda.length > 1 && <polygon className="ens-banda" points={[...banda.map((b) => `${x(b.i)},${y(b.r.max)}`), ...banda.slice().reverse().map((b) => `${x(b.i)},${y(b.r.min)}`)].join(" ")} />}
        {activo != null && <line x1={x(activo)} x2={x(activo)} y1={T} y2={H - B} className={`ens-guia${activo === dia ? " ens-guia--fija" : ""}`} />}
        {activos.map((m) => {
          const { color, forma } = ESTILO[m.id];
          const pts = dias.map((d, i) => ({ i, v: d[variable.clave].valores[m.id] })).filter((p) => p.v != null);
          return <g key={m.id}>
            <polyline fill="none" stroke={color} strokeWidth={hover?.m === m.id ? 3 : 2} strokeLinejoin="round" points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} opacity={hover && hover.m !== m.id ? 0.35 : 0.85} />
            {pts.map((p) => <Marca key={p.i} forma={forma} color={color} x={x(p.i)} y={y(p.v)} r={p.i === activo ? (hover?.m === m.id ? 8 : 6.5) : 5} />)}
          </g>;
        })}
      </svg>
      {dato && resumen && <div className={`ens-tip${izquierda ? " ens-tip--izq" : ""}${activo === dia ? " ens-tip--fija" : ""}`} style={{ left: `${(x(activo) / W) * 100}%` }} role="status">
        <p className="ens-tip-dia">{fechaDe(dato.fecha).toLocaleDateString("es-AR", { timeZone: AR, weekday: "long", day: "numeric", month: "long" })}{activo === dia && <span> · fijado</span>}</p>
        <ul>{activos.map((m) => { const v = dato[variable.clave].valores[m.id]; return <li key={m.id} className={hover?.m === m.id ? "is-cerca" : ""} style={{ "--c": ESTILO[m.id].color }}>
          <Icono id={m.id} /><span>{m.nombre}</span><strong>{v == null ? "sin dato" : fmtVal(v, variable)}</strong></li>; })}</ul>
        <p className="ens-tip-pie"><span>Promedio</span><strong>{resumen.media == null ? "—" : fmtVal(resumen.media, variable)}</strong></p>
        {resumen.n > 1 && <p className="ens-tip-pie"><span>Diferencia</span><strong className={resumen.discrepan ? "ens-alerta" : ""}>{fmtDif(resumen, variable)}{resumen.discrepan ? " · discrepan" : ""}</strong></p>}
      </div>}
      <p className="ens-nota">Pasá el mouse por el gráfico para ver el detalle de cada día; un clic lo deja fijado.</p>
    </div>
  );
}

export default function EnsamblePage() {
  const [datos, setDatos] = useState(null), [error, setError] = useState(""), [cargando, setCargando] = useState(false);
  const [clave, setClave] = useState("tmax"), [deptoId, setDeptoId] = useState("4");
  const [prendidos, setPrendidos] = useState(() => new Set(CATALOGO.filter((m) => !m.deshabilitado).map((m) => m.id))); // los que se consultan al tocar «Consultar»
  const [dia, setDia] = useState(null);
  // Rango a consultar (hora de Misiones). La pantalla NO pide nada sola: sólo al tocar «Consultar».
  const [fDesde, setFDesde] = useState(hoyART()), [hDesde, setHDesde] = useState("00:00");
  const [fHasta, setFHasta] = useState(sumarDias(hoyART(), 9)), [hHasta, setHHasta] = useState("23:00");
  const informe = useInforme(); // el borrador del informe vive acá (siempre montado): ocultar el cajón no pierde nada
  const [cajon, setCajon] = useState(false);
  const [avance, setAvance] = useState(null); // descarga (WRF-SMN, MONAN) en el servidor
  const [espera, setEspera] = useState(0); // > 0 mientras algún modelo sigue bajando (la consulta ya mostró los demás)
  const ultimo = useRef(null); // el pedido de la última consulta, para repetirlo cuando el WRF termina
  const atajo = (dias) => { setFDesde(hoyART()); setHDesde("00:00"); setFHasta(sumarDias(hoyART(), dias)); setHHasta("23:00"); };

  function consultar(repetir = false) {
    setCargando(true); setError("");
    if (!repetir) ultimo.current = { desde: `${fDesde}T${hDesde}`, hasta: `${fHasta}T${hHasta}`, modelos: [...prendidos] };
    api.getEnsamble(ultimo.current)
      .then((d) => {
        setDatos(d); setEspera((n) => (d.pendientes?.length ? n + 1 : 0));
        if (!repetir) setDia(null);
        setDeptoId((id) => (d.departamentos.some((x) => x.id === id) ? id : d.departamentos[0].id));
      })
      .catch((e) => { setError(e.message); setEspera(0); }).finally(() => setCargando(false));
  }
  const consultarRef = useRef(consultar); consultarRef.current = consultar;

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
  const filas = useMemo(() => (datos && variable ? datos.departamentos.map((d) => ({ d, celdas: d.dias.map((x) => resumir(x[clave].valores, visibles, variable)) })) : []), [datos, variable, clave, visibles]);
  const resumenDepto = depto && variable ? depto.dias.map((x) => resumir(x[clave].valores, visibles, variable)) : [];
  const generado = datos ? new Date(datos.generado).toLocaleString("es-AR", { timeZone: AR, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "";

  return <div className={`admin-layout ens-layout${cajon ? " ens-layout--cajon" : ""}`}>
    <BrandHeader subtitulo="Ensamble multimodelo"><VolverConfiguracion /></BrandHeader>
    <aside className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading"><h1>Ensamble multimodelo</h1>
        <p>Qué dice cada modelo numérico para cada departamento, a 10 días. Es una guía para el pronosticador; con el informe del cajón se arma el pronóstico del día y se puede publicar.</p></div>
      <h2>Modelos</h2>
      <div className="ens-modelos" role="group" aria-label="Modelos">
        {CATALOGO.map((m) => <button key={m.id} type="button" title={m.nota} disabled={!!m.deshabilitado} className={`ens-modelo${m.deshabilitado ? " ens-modelo--pendiente" : prendidos.has(m.id) ? "" : " ens-modelo--apagado"}`} style={{ "--c": ESTILO[m.id].color }} onClick={() => alternar(m.id)} aria-pressed={prendidos.has(m.id)}>
          <span className="ens-modelo-cab"><Icono id={m.id} /><strong>{m.nombre}</strong><span className="ens-interruptor" aria-hidden="true" /></span>
          <span className="ens-modelo-origen">{m.detalle}</span>
          {m.deshabilitado && <span className="ens-sin-consultar">Desactivado hasta tener acceso al CPTEC</span>}
          {datos && prendidos.has(m.id) && !consultados.has(m.id) && <span className="ens-sin-consultar">{pendientes.includes(m.id) ? "Descargando… se suma solo" : "Sin consultar: tocá «Consultar»"}</span>}
        </button>)}
      </div>
      <p className="ens-nota">Prendé los que querés comparar: <strong>Consultar</strong> pide sólo esos. Pasá el mouse por una tarjeta para ver el detalle.</p>
    </aside>

    <div className="admin-map-area ens-area">
      <form className="ens-rango" onSubmit={(e) => { e.preventDefault(); consultar(); }}>
        <div className="ens-rango-caja">
          <div className="ens-rango-cab"><h2>Rango a consultar</h2><p>Hora de Misiones · hasta 7 días atrás y 9 adelante, máximo 10 días de rango.</p></div>
          <div className="ens-rango-campos">
            <div className="ens-rango-par"><CampoFecha label="Desde" value={fDesde} onChange={(v) => v && setFDesde(v)} min={sumarDias(hoyART(), -7)} max={sumarDias(hoyART(), 9)} disabled={cargando} /><CampoHora label="Hora" value={hDesde} onChange={setHDesde} disabled={cargando} /></div>
            <span className="ens-rango-flecha" aria-hidden="true">→</span>
            <div className="ens-rango-par"><CampoFecha label="Hasta" value={fHasta} onChange={(v) => v && setFHasta(v)} min={fDesde} max={sumarDias(hoyART(), 9)} disabled={cargando} /><CampoHora label="Hora" value={hHasta} onChange={setHHasta} disabled={cargando} /></div>
          </div>
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
      {!datos && !error && <p className="ens-vacio">Elegí el rango de fecha y hora y tocá <strong>Consultar</strong>. La pantalla no pide datos sola: cada consulta se hace en el momento, cuando la pedís.</p>}
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

        <h2 className="ens-titulo">Promedio de los modelos por departamento <small>({variable.unidad}) · <span className="ens-disc-ej">resaltado</span> = los modelos discrepan {variable.clave === "lluvia" ? `(≥ ${variable.umbral} mm, o unos secos y otros con lluvia)` : (variable.circular ? `(≥ ${variable.umbral}° entre dos modelos)` : `(≥ ${variable.umbral} ${variable.unidad} entre el más alto y el más bajo)`)}</small></h2>
        <p className="ens-leyenda"><strong>Cómo leer esta tabla:</strong> cada número es el <strong>promedio</strong> de lo que pronostican <strong>todos los modelos que tenés prendidos</strong> a la izquierda ({[...visibles].map((id) => CATALOGO.find((m) => m.id === id)?.nombre).join(", ")}), para ese departamento y ese día. {{ sum: "Cada modelo aporta la lluvia acumulada del día.", min: "Cada modelo aporta su mínima del día.", max: "Cada modelo aporta su máximo del día.", mean: "Cada modelo aporta el promedio del día.", dir: "Cada modelo aporta la dirección de la que sopla el viento (predominante del día); el promedio es circular, no una suma de grados." }[variable.agrega]} <strong>Tocá un número o un departamento</strong> para ver abajo el desglose, modelo por modelo. Los días con «parcial» sólo cuentan las horas del rango elegido.</p>
        <div className="ens-matriz-caja">
          <table className="ens-matriz">
            <thead><tr><th scope="col">Departamento</th>{datos.dias.map((f) => <th key={f.fecha} scope="col" title={f.horas < 24 ? `Parcial: ${f.horas} de 24 h` : undefined}><span>{diaCorto(f.fecha)}</span>{diaMes(f.fecha)}{f.horas < 24 && <em className="ens-parcial">parcial</em>}</th>)}</tr></thead>
            <tbody>{filas.map(({ d, celdas }) => <tr key={d.id} className={d.id === deptoId ? "ens-fila--on" : ""}>
              <th scope="row"><button className="btn-link" onClick={() => { setDeptoId(d.id); setDia(null); }}>{d.nombre}</button></th>
              {celdas.map((c, i) => <td key={i} className={`${c.discrepan ? "ens-celda--disc" : ""}${d.id === deptoId && dia === i ? " ens-celda--sel" : ""}`} title={c.n ? `${c.n} modelo${c.n > 1 ? "s" : ""}: ${variable.circular ? `${fmtVal(c.media, variable)}, hasta ${Math.round(c.rango)}° de diferencia` : `de ${num(c.min, variable.decimales)} a ${num(c.max, variable.decimales)} ${variable.unidad}`}` : ""}>
                <button type="button" onClick={() => { setDeptoId(d.id); setDia(i); }}>{fmtCelda(c.media, variable)}</button></td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <p className="ens-nota">Más allá de los primeros días ICON y GEM dejan de cubrir el horizonte: ese día la media sale de menos modelos (lo dice el detalle).</p>

        {depto && <>
          <h2 className="ens-titulo">{depto.nombre} · {variable.nombre.toLowerCase()} <small>(centroide {num(depto.lat, 2)}, {num(depto.lng, 2)})</small></h2>
          <Grafico depto={depto} variable={variable} modelos={datos.modelos} visibles={visibles} dia={dia} onDia={setDia} />
          <div className="ens-detalle-caja">
            <table className="ens-detalle">
              <thead><tr><th scope="col">Día</th>{datos.modelos.filter((m) => visibles.has(m.id)).map((m) => <th key={m.id} scope="col" style={{ "--c": ESTILO[m.id].color }}><Icono id={m.id} /> {m.nombre}</th>)}<th scope="col">Media</th><th scope="col">Diferencia</th></tr></thead>
              <tbody>{depto.dias.map((x, i) => { const r = resumenDepto[i]; return <tr key={x.fecha} className={`${dia === i ? "ens-fila--on" : ""}${r.discrepan ? " ens-fila--disc" : ""}`} onClick={() => setDia(i)}>
                <th scope="row">{diaCorto(x.fecha)} {diaMes(x.fecha)}</th>
                {datos.modelos.filter((m) => visibles.has(m.id)).map((m) => <td key={m.id}>{variable.circular ? fmtVal(x[clave].valores[m.id], variable) : num(x[clave].valores[m.id], variable.decimales)}</td>)}
                <td><strong>{variable.circular ? fmtVal(r.media, variable) : num(r.media, variable.decimales)}</strong>{r.n > 0 && r.n < visibles.size ? <small> ({r.n} de {visibles.size})</small> : null}</td>
                <td>{r.n > 1 ? fmtDif(r, variable) : "—"}{r.discrepan ? <span className="ens-alerta"> discrepan</span> : null}</td>
              </tr>; })}</tbody>
            </table>
          </div>
        </>}
        <p className="ens-nota">Fuentes: Open-Meteo (ECMWF IFS, GFS, ICON y GEM){datos.modelos.some((m) => m.id === "wrf_smn") && "; WRF-SMN del Servicio Meteorológico Nacional (datos abiertos en AWS, CC BY 2.5 Argentina)"}{datos.modelos.some((m) => m.id.startsWith("monan")) && "; MONAN del CPTEC/INPE, Brasil (datos abiertos)"}. Corridas (inicio): {Object.entries(datos.corridas || {}).map(([id, iso]) => `${CATALOGO.find((m) => m.id === id)?.nombre} ${new Date(iso).toLocaleString("es-AR", { timeZone: "UTC", day: "2-digit", month: "2-digit", hour: "2-digit", hourCycle: "h23" }).replace(/, (\d+)$/, " $1")} UTC`).join(" · ") || "—"}. En el centroide de cada departamento. Ráfaga y viento son los máximos del día a 10 m. WRF-SMN: temperatura calibrada por el SMN (mínima de 21 a 9 h, máxima de 9 a 21 h, sólo si el rango cubre esas horas) y lluvia horaria. Reflectividad y helicidad: sólo MONAN 3 km. MONAN 10 km sale cada 3 horas: sus máximas y mínimas son aproximadas.</p>
      </>}
    </div>
    <InformeEnsamble informe={informe} abierto={cajon} onCerrar={() => setCajon(false)} prendidos={prendidos} modelos={CATALOGO} />
  </div>;
}
