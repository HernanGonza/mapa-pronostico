import { useMemo, useState } from "react";

/**
 * Los resultados del Informe de precipitaciones, interactivos como en el ensamble: una tabla de estaciones (tocá una columna para
 * cambiar de dato y una fila para elegir estación), un mapa donde cada estación es un círculo (pasá el puntero o tocá) y un gráfico
 * de líneas en el tiempo (pasá el puntero para ver el valor de cada estación a esa hora; tocá para fijarlo).
 */
const AR = "America/Argentina/Buenos_Aires";
const COLORES = ["#1f6fb2", "#d4572a", "#2f8f5b", "#8b3fc4", "#c9346c", "#b8940f", "#17847f", "#5a6bd6", "#a8552f", "#3c7a2a", "#9a2f6f"];
const coma = (n, d = 1) => (n == null ? "—" : (Math.round(n * 10 ** d) / 10 ** d).toString().replace(".", ","));
const corto = (nombre) => nombre.split(" - ")[0];
const diaDe = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(new Date(t));
const horaDe = (t) => new Date(t).toLocaleTimeString("es-AR", { timeZone: AR, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const ddmm = (f) => f.split("-").reverse().slice(0, 2).join("/");
const cuando = (t) => `${ddmm(diaDe(t))} ${horaDe(t)}`;

/** Los datos que se pueden mirar. `valor` es el número de la estación (tabla y mapa); `serie` los puntos del gráfico. */
export const VARIABLES = [
  { clave: "lluvia", grupo: "Lluvia", nombre: "Lluvia acumulada", unidad: "mm", color: "#1f6fb2", cero: true,
    valor: (e) => (e.resumen && !e.resumen.sinLluvia ? e.resumen.lluviaTotal : null),
    serie: (e) => { let s = 0; return (e.serie || []).map((r) => ({ t: r.t, v: Math.round((s += r.lluvia || 0) * 10) / 10 })); } },
  { clave: "lluvia30", grupo: "Lluvia", nombre: "Máx. en 30 min (1 h en las horarias)", unidad: "mm", color: "#17847f", cero: true,
    valor: (e) => (e.resumen?.lluvia30 ? e.resumen.lluvia30.mm : null),
    serie: (e) => (e.serie || []).map((r) => ({ t: r.t, v: r.lluvia || 0 })) },
  { clave: "rafaga", grupo: "Viento", nombre: "Ráfaga máxima", unidad: "km/h", color: "#d4572a", cero: true,
    valor: (e) => e.resumen?.rafaga?.kmh ?? null,
    serie: (e) => (e.serie || []).filter((r) => r.rafaga != null).map((r) => ({ t: r.t, v: r.rafaga })) },
  { clave: "viento", grupo: "Viento", nombre: "Viento medio máximo", unidad: "km/h", color: "#b8940f", cero: true,
    valor: (e) => e.resumen?.viento?.kmh ?? null,
    serie: (e) => (e.serie || []).filter((r) => r.viento != null).map((r) => ({ t: r.t, v: r.viento })) },
  { clave: "tmax", grupo: "Temperatura", nombre: "Temperatura máxima", unidad: "°C", color: "#c9346c", cero: false,
    valor: (e) => e.extremas?.tmax ?? e.resumen?.tMax?.c ?? null,
    serie: (e) => (e.serie || []).filter((r) => r.temperatura != null).map((r) => ({ t: r.t, v: r.temperatura })) },
  { clave: "tmin", grupo: "Temperatura", nombre: "Temperatura mínima", unidad: "°C", color: "#5a6bd6", cero: false,
    valor: (e) => e.extremas?.tmin ?? e.resumen?.tMin?.c ?? null,
    serie: (e) => (e.serie || []).filter((r) => r.temperatura != null).map((r) => ({ t: r.t, v: r.temperatura })) },
];
const GRUPOS = [...new Set(VARIABLES.map((v) => v.grupo))];

export default function PanelPrecipitaciones({ estaciones, geo, rango }) {
  const [clave, setClave] = useState("lluvia"), [sel, setSel] = useState(null), [orden, setOrden] = useState(null);
  const variable = VARIABLES.find((v) => v.clave === clave);
  const colorDe = useMemo(() => Object.fromEntries(estaciones.map((e, i) => [e.clave, COLORES[i % COLORES.length]])), [estaciones]);
  const valores = useMemo(() => Object.fromEntries(estaciones.map((e) => [e.clave, variable.valor(e)])), [estaciones, variable]);
  const maximo = Math.max(0, ...Object.values(valores).filter((v) => v != null));
  const filas = useMemo(() => {
    const f = [...estaciones];
    if (orden) f.sort((a, b) => (orden.dir * ((VARIABLES.find((v) => v.clave === orden.clave).valor(a) ?? -Infinity) - (VARIABLES.find((v) => v.clave === orden.clave).valor(b) ?? -Infinity))));
    return f;
  }, [estaciones, orden]);
  const elegida = estaciones.find((e) => e.clave === sel);

  const ordenarPor = (c) => setOrden((o) => (o?.clave === c ? (o.dir === -1 ? { clave: c, dir: 1 } : null) : { clave: c, dir: -1 }));
  const flecha = (c) => (orden?.clave === c ? (orden.dir === -1 ? " ↓" : " ↑") : "");

  return <div className="pp">
    <div className="ens-variables-caja">
      <div className="ens-grupos" role="tablist" aria-label="Tipo de dato">
        {GRUPOS.map((g) => <button key={g} role="tab" aria-selected={g === variable.grupo} className={`ens-grupo${g === variable.grupo ? " ens-grupo--on" : ""}`} onClick={() => setClave(VARIABLES.find((v) => v.grupo === g).clave)}>{g}</button>)}
      </div>
      <div className="ens-variables" role="tablist" aria-label="Dato">
        {VARIABLES.filter((v) => v.grupo === variable.grupo).map((v) => <button key={v.clave} role="tab" aria-selected={v.clave === clave} className={`ens-pestana${v.clave === clave ? " ens-pestana--on" : ""}`} onClick={() => setClave(v.clave)}>{v.nombre}</button>)}
      </div>
    </div>

    <h2 className="ens-titulo">Estaciones <small>· {variable.nombre.toLowerCase()} ({variable.unidad}) · tocá una columna para cambiar de dato y una fila para elegir una estación</small></h2>
    <div className="ens-matriz-caja pp-tabla">
      <table className="ens-matriz">
        <thead><tr><th scope="col">Estación</th><th scope="col">Red</th>
          {VARIABLES.map((v) => <th key={v.clave} scope="col" className={v.clave === clave ? "pp-col--on" : ""}><button type="button" onClick={() => { setClave(v.clave); ordenarPor(v.clave); }} title="Mostrar este dato y ordenar">{v.nombre}<small>{v.unidad}{flecha(v.clave)}</small></button></th>)}</tr></thead>
        <tbody>{filas.map((e) => <tr key={e.clave} className={e.clave === sel ? "ens-fila--on" : ""}>
          <th scope="row"><button type="button" className="btn-link" onClick={() => setSel(e.clave === sel ? null : e.clave)}><i className="pp-punto" style={{ background: colorDe[e.clave] }} />{corto(e.nombre)}</button></th>
          <td className="pp-red">{e.red}</td>
          {VARIABLES.map((v) => { const x = v.valor(e); return <td key={v.clave} className={`${v.clave === clave ? "pp-col--on" : ""}${v.clave === clave && x != null && x === maximo && maximo > 0 ? " pp-max" : ""}${e.clave === sel && v.clave === clave ? " ens-celda--sel" : ""}`}>
            <button type="button" onClick={() => { setClave(v.clave); setSel(e.clave); }}>{x == null ? (v.clave === "lluvia" && e.resumen?.sinLluvia ? "no mide" : "—") : coma(x)}</button></td>; })}
        </tr>)}</tbody>
      </table>
    </div>
    {estaciones.some((e) => e.avisoDatos) && <p className="ens-nota">Faltan algunos días del rango: {estaciones.filter((e) => e.avisoDatos).map((e) => `${e.red} ${corto(e.nombre)} (${e.avisoDatos})`).join(" · ")}.</p>}

    <h2 className="ens-titulo">Mapa <small>· círculo según {variable.nombre.toLowerCase()}; pasá el puntero o tocá una estación</small></h2>
    <MapaInteractivo geo={geo} estaciones={estaciones} variable={variable} valores={valores} maximo={maximo} sel={sel} onSel={setSel} colorDe={colorDe} />

    <h2 className="ens-titulo">{elegida ? `${corto(elegida.nombre)} y las demás` : "Todas las estaciones"} <small>· {variable.nombre.toLowerCase()} en el tiempo</small></h2>
    <GraficoInteractivo estaciones={estaciones} variable={variable} rango={rango} sel={sel} onSel={setSel} colorDe={colorDe} />
  </div>;
}

/** Mapa de Misiones (SVG): departamentos y un círculo por estación; el tamaño sigue el dato elegido. */
function MapaInteractivo({ geo, estaciones, variable, valores, maximo, sel, onSel, colorDe }) {
  const [hover, setHover] = useState(null);
  if (!geo) return <p className="admin-panel__hint">Cargando el mapa…</p>;
  const W = 640, H = 560, LON = [-56.1, -53.6], LAT = [-28.2, -25.45];
  const k = Math.min(W / (LON[1] - LON[0]), H / (LAT[1] - LAT[0]));
  const px = (lng) => (lng - LON[0]) * k + (W - (LON[1] - LON[0]) * k) / 2, py = (lat) => (LAT[1] - lat) * k;
  const camino = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((pol) => pol.map((anillo) => anillo.map(([x, y], i) => `${i ? "L" : "M"}${px(x).toFixed(1)},${py(y).toFixed(1)}`).join("") + "Z").join("")).join("");
  const ubicadas = estaciones.filter((e) => e.lat != null && e.lng != null && e.lng >= LON[0] && e.lng <= LON[1] && e.lat >= LAT[0] && e.lat <= LAT[1]);
  const sinUbicar = estaciones.filter((e) => !ubicadas.includes(e));
  const activa = estaciones.find((e) => e.clave === (hover || sel));
  return <div className="pp-mapa-caja">
    <svg viewBox={`0 0 ${W} ${H}`} className="pp-mapa" role="img" aria-label={`Mapa de estaciones: ${variable.nombre}`}>
      <rect width={W} height={H} fill="var(--surface)" />
      {geo.features.map((f, i) => <path key={i} d={camino(f.geometry)} fill="#e7eee8" stroke="#9cb2a4" strokeWidth="1" />)}
      {ubicadas.map((e) => {
        const v = valores[e.clave], x = px(e.lng), y = py(e.lat), radio = v == null ? 5 : 7 + 24 * Math.sqrt(Math.max(0, v) / (maximo || 1));
        const on = e.clave === sel, cerca = e.clave === hover;
        return <g key={e.clave} className="pp-estacion" tabIndex={0} role="button" aria-label={`${corto(e.nombre)}: ${v == null ? "sin dato" : `${coma(v)} ${variable.unidad}`}`}
          onPointerEnter={() => setHover(e.clave)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(e.clave)} onBlur={() => setHover(null)}
          onClick={() => onSel(on ? null : e.clave)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSel(on ? null : e.clave); } }}>
          {on && <circle cx={x} cy={y} r={radio + 5} fill="none" stroke="#16241e" strokeWidth="2.5" />}
          {e.red === "SMN" || e.manual
            ? <rect x={x - radio * 0.7} y={y - radio * 0.7} width={radio * 1.4} height={radio * 1.4} fill={v == null ? "none" : variable.color} fillOpacity={cerca ? 0.8 : 0.55} stroke={variable.color} strokeWidth="1.8" strokeDasharray={v == null ? "3 3" : undefined} />
            : <circle cx={x} cy={y} r={radio} fill={v == null ? "none" : variable.color} fillOpacity={cerca ? 0.8 : 0.55} stroke={variable.color} strokeWidth="1.8" strokeDasharray={v == null ? "3 3" : undefined} />}
          <circle cx={x} cy={y} r="2.2" fill={colorDe[e.clave]} />
          {(on || cerca || v != null && v >= maximo * 0.6) && <text x={x + radio + 5} y={y + 4} fontSize="12" fontWeight="700" fill="#16241e" stroke="#fff" strokeWidth="3" paintOrder="stroke">{corto(e.nombre)}</text>}
        </g>;
      })}
    </svg>
    {activa && activa.lat != null && <div className="ens-tip pp-tip" role="status">
      <p className="ens-tip-dia">{corto(activa.nombre)} <span>· {activa.red}</span></p>
      <ul>{VARIABLES.map((v) => { const x = v.valor(activa); return <li key={v.clave} className={v.clave === variable.clave ? "is-cerca" : ""} style={{ "--c": v.color }}><span>{v.nombre}</span><strong>{x == null ? "—" : `${coma(x)} ${v.unidad}`}</strong></li>; })}</ul>
    </div>}
    <p className="ens-nota">Círculo: estaciones automáticas · cuadrado: SMN y manuales · punteado: sin dato de {variable.nombre.toLowerCase()}.{sinUbicar.length > 0 && ` Sin ubicación en el mapa: ${sinUbicar.map((e) => corto(e.nombre)).join(", ")}.`}</p>
  </div>;
}

/** Líneas en el tiempo, una por estación; el puntero muestra el valor de cada una a esa hora y un clic fija la hora. */
function GraficoInteractivo({ estaciones, variable, rango, sel, onSel, colorDe }) {
  const [hover, setHover] = useState(null), [fija, setFija] = useState(null);
  const W = 760, H = 300, L = 46, R = 14, T = 14, B = 34;
  const series = useMemo(() => estaciones.map((e) => ({ e, puntos: variable.serie(e) })).filter((s) => s.puntos.length), [estaciones, variable]);
  const sinSerie = estaciones.filter((e) => !series.some((s) => s.e === e));
  if (!series.length) return <p className="ens-vacio">Ninguna de las estaciones prendidas trajo lecturas de {variable.nombre.toLowerCase()} en este rango{sinSerie.some((e) => e.manual) ? " (las manuales sólo tienen el dato resumido)" : ""}.</p>;
  const t0 = Date.parse(`${rango.fecha}T${rango.desde}:00-03:00`), t1 = Date.parse(`${rango.fechaHasta || rango.fecha}T${rango.hasta}:59-03:00`);
  const vals = series.flatMap((s) => s.puntos.map((p) => p.v));
  let lo = variable.cero ? 0 : Math.min(...vals), hi = Math.max(variable.cero ? 1 : lo + 1, ...vals);
  if (!variable.cero) { const pad = (hi - lo) * 0.08; lo -= pad; hi += pad; }
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const horas = (t1 - t0) / 3600e3, paso = horas <= 26 ? 3 : horas <= 50 ? 6 : horas <= 100 ? 12 : 24, conDia = diaDe(t0) !== diaDe(t1);
  const marcas = []; for (let t = Math.ceil((t0 - 3 * 3600e3) / (paso * 3600e3)) * paso * 3600e3 + 3 * 3600e3; t <= t1; t += paso * 3600e3) marcas.push(t);
  const ticks = [0, 1, 2, 3, 4].map((k) => lo + ((hi - lo) * k) / 4);

  // El valor de cada estación en la hora más cercana al puntero (hasta 90 min de distancia: las horarias no tienen más).
  const enHora = (s, t) => { let mejor = null; for (const p of s.puntos) if (!mejor || Math.abs(p.t - t) < Math.abs(mejor.t - t)) mejor = p; return mejor && Math.abs(mejor.t - t) <= 90 * 60e3 ? mejor : null; };
  const tDe = (ev) => { const r = ev.currentTarget.getBoundingClientRect(); return t0 + (((ev.clientX - r.left) / r.width) * W - L) / (W - L - R) * (t1 - t0); };
  const activo = hover ?? fija;
  const filas = activo == null ? [] : series.map((s) => ({ s, p: enHora(s, activo) })).filter((f) => f.p).sort((a, b) => b.p.v - a.p.v);
  const izquierda = activo != null && x(activo) > W * 0.55;

  return <div className="ens-grafico-caja">
    <svg className="ens-grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${variable.nombre} en el tiempo, una línea por estación`}
      onPointerMove={(ev) => setHover(Math.min(t1, Math.max(t0, tDe(ev))))} onPointerLeave={() => setHover(null)} onClick={(ev) => setFija(fija != null && Math.abs(x(fija) - x(tDe(ev))) < 6 ? null : tDe(ev))}>
      {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="ens-grilla" /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="ens-eje">{coma(t, hi - lo > 5 ? 0 : 1)}</text></g>)}
      {marcas.map((t) => <text key={t} x={x(t)} y={H - 10} textAnchor="middle" className="ens-eje">{conDia ? cuando(t) : horaDe(t)}</text>)}
      {activo != null && <line x1={x(activo)} x2={x(activo)} y1={T} y2={H - B} className={`ens-guia${activo === fija ? " ens-guia--fija" : ""}`} />}
      {[...series].sort((a, b) => (a.e.clave === sel) - (b.e.clave === sel)).map((s) => {
        const on = s.e.clave === sel, tenue = sel && !on;
        return <polyline key={s.e.clave} fill="none" stroke={colorDe[s.e.clave]} strokeWidth={on ? 3.2 : 1.8} strokeLinejoin="round" opacity={tenue ? 0.22 : 0.9} points={s.puntos.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} />;
      })}
      {filas.map(({ s, p }) => <circle key={s.e.clave} cx={x(p.t)} cy={y(p.v)} r={s.e.clave === sel ? 6 : 4.5} fill={colorDe[s.e.clave]} stroke="#fff" strokeWidth="1.5" />)}
    </svg>
    {filas.length > 0 && <div className={`ens-tip${izquierda ? " ens-tip--izq" : ""}${activo === fija ? " ens-tip--fija" : ""}`} style={{ left: `${(x(activo) / W) * 100}%` }} role="status">
      <p className="ens-tip-dia">{cuando(activo)}{activo === fija && <span> · fijado</span>}</p>
      <ul>{filas.slice(0, 12).map(({ s, p }) => <li key={s.e.clave} className={s.e.clave === sel ? "is-cerca" : ""} style={{ "--c": colorDe[s.e.clave] }}><span>{corto(s.e.nombre)}</span><strong>{coma(p.v)} {variable.unidad}</strong></li>)}</ul>
      {filas.length > 12 && <p className="ens-tip-pie"><span>y {filas.length - 12} más</span></p>}
    </div>}
    <div className="pp-leyenda">{series.map((s) => <button key={s.e.clave} type="button" className={`pp-chip${s.e.clave === sel ? " pp-chip--on" : ""}`} onClick={() => onSel(s.e.clave === sel ? null : s.e.clave)}><i style={{ background: colorDe[s.e.clave] }} />{corto(s.e.nombre)}</button>)}</div>
    {sinSerie.length > 0 && <p className="ens-nota">Sin lecturas para graficar: {sinSerie.map((e) => corto(e.nombre)).join(", ")}{sinSerie.some((e) => e.manual) ? " (las manuales sólo tienen el dato resumido)" : ""}.</p>}
  </div>;
}
