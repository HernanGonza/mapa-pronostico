import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, ChevronRight, ChevronLeft } from "lucide";
import Icono from "./Icono";
import CampoFecha from "./CampoFecha";
import SelectorCondiciones from "./SelectorCondiciones";
import * as api from "../api";
import { confirmar } from "../lib/ui";
import { hayCondicion } from "../lib/condiciones";
import "../pages/ensamble.css"; // el cajón lateral (.ens-cajon) y los pasos son los mismos del informe del ensamble

/**
 * Informe «PREVISIÓN DEL TIEMPO PARA LA PROVINCIA DE MISIONES» armado paso a paso en el panel, en un cajón lateral que se
 * puede ocultar sin perder nada (el borrador se guarda solo en el navegador). Los pasos siguen el orden del informe de la
 * DGAT que se usaba en Word: datos generales, resumen por zona, el detalle de cada zona con sus localidades, el pronóstico
 * extendido y los informes de los días. El final es un PDF (cifrado y con marca de agua) que arma el servidor, y los mismos
 * datos alimentan el mapa público (`aMapa`).
 */
export const ZONAS = ["Norte", "Centro", "Sur"];
export const LOCALIDADES = {
  Norte: ["PUERTO IGUAZÚ", "BDO. DE IRIGOYEN", "ELDORADO", "SAN PEDRO"],
  Centro: ["MONTECARLO", "JARDÍN AMÉRICA", "SAN VICENTE", "A. DEL VALLE", "OBERÁ"],
  Sur: ["POSADAS", "L. N. ALEM", "APÓSTOLES", "SAN JAVIER"],
};
const CLAVE = "pronostico-informe-v1";
const AR = "America/Argentina/Buenos_Aires";
const hoyART = () => new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(new Date());
const sumarDias = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const partesDia = (iso) => { const d = new Date(`${iso}T12:00:00Z`), f = (o) => new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", ...o }).format(d); return { dia: cap(f({ weekday: "long" })), fecha: `${f({ day: "numeric" })} de ${f({ month: "long" })}` }; };
const encabezadoDia = (iso) => { const p = partesDia(iso); return `${p.dia} ${p.fecha}`; };
const ddmmaaaa = (iso) => iso.split("-").reverse().join("/");
const entero = (v) => { const n = Number(v); return String(v ?? "").trim() !== "" && Number.isInteger(n) && n >= -15 && n <= 55; };

const zonaVacia = () => ({ tmin: "", tmax: "", condicion: "", aviso: "SIN AVISOS.", humedad: "", viento: "", riesgo: "BAJO" });
const diaVacio = (fecha) => ({ fecha, tmin: "", tmax: "", condicion: "" });
const informeVacio = (fecha) => ({ fecha, resumen: "", precipitaciones: "", vientos: "", temperaturas: "" });

/** Las fechas que dependen de la del informe: el extendido (los dos días que siguen) y los tres textos (el día y los dos que siguen). */
function conFechas(b) {
  const f = b.fecha;
  return {
    ...b,
    extendido: Object.fromEntries(ZONAS.map((z) => [z, [1, 2].map((n, i) => ({ ...b.extendido[z][i], fecha: sumarDias(f, n) }))])),
    informes: [0, 1, 2].map((n, i) => ({ ...b.informes[i], fecha: sumarDias(f, n) })),
  };
}
export function borradorVacio() {
  const f = hoyART();
  return conFechas({
    fecha: f, emision: "09:00",
    generales: { sol: "", luna: "", vientos: "", humedad: "", presion: "", faseLunar: "", riesgo: "BAJO PARA TODA LA PROVINCIA." }, avisoGeneral: "SIN AVISOS.",
    zonas: Object.fromEntries(ZONAS.map((z) => [z, zonaVacia()])),
    localidades: ZONAS.flatMap((z) => LOCALIDADES[z].map((localidad) => ({ localidad, zona: z, tmin: "", tmax: "", condicion: "" }))),
    extendido: Object.fromEntries(ZONAS.map((z) => [z, [diaVacio(f), diaVacio(f)]])),
    informes: [informeVacio(f), informeVacio(f), informeVacio(f)],
  });
}

/** Lo que se carga en el mapa público: las 13 localidades y el pronóstico de 3 días por zona (la misma forma que traía el .docx). */
export function aMapa(b) {
  const filas = b.localidades.map((l) => ({ LOCALIDAD: l.localidad, TMIN: l.tmin, TMAX: l.tmax, CONDICION: l.condicion, ZONA: l.zona }));
  const extendido = {
    zonas: ["Sur", "Centro", "Norte"].map((zona) => ({ zona, dias: [
      { etiqueta: "Hoy", fecha: null, tmin: b.zonas[zona].tmin, tmax: b.zonas[zona].tmax, condicion: b.zonas[zona].condicion },
      ...b.extendido[zona].map((d) => ({ etiqueta: partesDia(d.fecha).dia, fecha: partesDia(d.fecha).fecha, tmin: d.tmin, tmax: d.tmax, condicion: d.condicion })),
    ] })),
    informes: b.informes.filter((i) => i.resumen.trim()).map((i) => ({ dia: partesDia(i.fecha).dia, fecha: partesDia(i.fecha).fecha,
      texto: [i.resumen, i.precipitaciones && `Precipitaciones: ${i.precipitaciones}`, i.vientos && `Vientos: ${i.vientos}`, i.temperaturas && `Temperaturas: ${i.temperaturas}`].filter(Boolean).join(" ").trim().slice(0, 800) })),
  };
  return { filas, extendido, fecha: b.fecha };
}

/** Arma un borrador a partir de lo que está publicado (para corregirlo en vez de empezar de cero). */
export function desdePublicado(actual) {
  const b = borradorVacio();
  if (actual?.fechaPronostico) b.fecha = String(actual.fechaPronostico).slice(0, 10);
  b.localidades = b.localidades.map((l) => { const f = (actual?.filas || []).find((x) => String(x.LOCALIDAD).trim().toUpperCase() === l.localidad); return f ? { ...l, tmin: String(f.TMIN), tmax: String(f.TMAX), condicion: f.CONDICION } : l; });
  for (const z of actual?.extendido?.zonas || []) {
    if (!ZONAS.includes(z.zona)) continue;
    const [hoy, ...dias] = z.dias || [];
    if (hoy) b.zonas[z.zona] = { ...b.zonas[z.zona], tmin: String(hoy.tmin ?? ""), tmax: String(hoy.tmax ?? ""), condicion: hoy.condicion || "" };
    dias.slice(0, 2).forEach((d, i) => { b.extendido[z.zona][i] = { ...b.extendido[z.zona][i], tmin: String(d.tmin ?? ""), tmax: String(d.tmax ?? ""), condicion: d.condicion || "" }; });
  }
  (actual?.extendido?.informes || []).slice(0, 3).forEach((i, n) => { b.informes[n] = { ...b.informes[n], resumen: i.texto || "" }; });
  return conFechas(b);
}

const leerGuardado = () => { try { const g = JSON.parse(localStorage.getItem(CLAVE)); return g?.borrador ? g : null; } catch { return null; } };
const poner = (obj, camino, valor) => {
  const [k, ...resto] = camino.split(".");
  const copia = Array.isArray(obj) ? [...obj] : { ...obj };
  copia[k] = resto.length ? poner(obj[k], resto.join("."), valor) : valor;
  return copia;
};

/** El borrador y el paso; se guarda solo. Lo usa la pantalla (siempre montada) para que ocultar el cajón no pierda nada. */
export function useInformePronostico() {
  const [estado, setEstado] = useState(() => { const g = leerGuardado(); return g ? { borrador: g.borrador, paso: g.paso || 0 } : { borrador: borradorVacio(), paso: 0 }; });
  useEffect(() => { try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch { /* sin almacenamiento: sigue andando, sólo que no se guarda */ } }, [estado]);
  const hayAlgo = useMemo(() => JSON.stringify(estado.borrador) !== JSON.stringify(borradorVacio()), [estado.borrador]);
  return {
    ...estado, hayAlgo,
    setCampo: (camino, valor) => setEstado((e) => {
      let borrador = poner(e.borrador, camino, valor);
      if (camino === "fecha") borrador = conFechas(borrador);
      return { ...e, borrador };
    }),
    setPaso: (paso) => setEstado((e) => ({ ...e, paso })),
    reemplazar: (borrador) => setEstado({ borrador: conFechas(borrador), paso: 0 }),
    reiniciar: () => setEstado({ borrador: borradorVacio(), paso: 0 }),
  };
}

// --- piezas de los pasos ---------------------------------------------------------------------------------------
const Etiqueta = ({ texto, children }) => <label className="paso-etiqueta"><span>{texto}</span>{children}</label>;
const Linea = ({ texto, valor, alCambiar, ...resto }) => <Etiqueta texto={texto}><input className="paso-input" value={valor} onChange={(e) => alCambiar(e.target.value)} {...resto} /></Etiqueta>;
const Texto = ({ texto, valor, alCambiar, filas = 4, ...resto }) => <Etiqueta texto={texto}><textarea className="paso-texto" rows={filas} value={valor} onChange={(e) => alCambiar(e.target.value)} {...resto} /></Etiqueta>;
const Temps = ({ min, max, alMin, alMax, etiqueta }) => <div className="ens-par pron-temps">
  <Linea texto="Mínima (°C)" valor={min} alCambiar={alMin} inputMode="numeric" aria-label={`Mínima ${etiqueta}`} />
  <Linea texto="Máxima (°C)" valor={max} alCambiar={alMax} inputMode="numeric" aria-label={`Máxima ${etiqueta}`} />
</div>;
const Condicion = ({ texto = "Condición", ...resto }) => <div className="paso-etiqueta"><span>{texto}</span><SelectorCondiciones etiqueta={texto} {...resto} /></div>;

function PasoGenerales({ b, set, publicado, alCargarPublicado }) {
  const [estado, setEstado] = useState({ cargando: false, error: "" });
  async function calcular() {
    setEstado({ cargando: true, error: "" });
    try { const a = await api.getAstronomia(b.fecha); set("generales.sol", a.sol); set("generales.luna", a.luna); set("generales.faseLunar", a.faseLunar); setEstado({ cargando: false, error: "" }); }
    catch (e) { setEstado({ cargando: false, error: e.message }); }
  }
  return <>
    <p className="paso__ayuda">La fecha define los días del pronóstico extendido (los dos siguientes) y de los informes. Estos son los «datos generales» del encabezado del informe.</p>
    <CampoFecha label="Fecha del informe" value={b.fecha} onChange={(v) => v && set("fecha", v)} />
    {publicado && <button type="button" className="btn btn--ghost" onClick={alCargarPublicado}>Partir de lo que está publicado</button>}
    <Etiqueta texto="Hora de emisión"><input className="paso-input" type="time" value={b.emision} onChange={(e) => set("emision", e.target.value)} /></Etiqueta>
    <button type="button" className="btn" disabled={estado.cargando} onClick={calcular}>{estado.cargando ? "Calculando…" : "Calcular sol, luna y fase lunar"}</button>
    {estado.error && <p className="paso-aviso" role="alert">{estado.error}</p>}
    <Linea texto="Sol" valor={b.generales.sol} alCambiar={(v) => set("generales.sol", v)} placeholder="5:59 - 18:41" />
    <Linea texto="Luna" valor={b.generales.luna} alCambiar={(v) => set("generales.luna", v)} placeholder="Sale 9:03 15/10/2026 - Se oculta 23:32 15/10/2026" />
    <Linea texto="Fase lunar" valor={b.generales.faseLunar} alCambiar={(v) => set("generales.faseLunar", v)} />
    <Linea texto="Vientos" valor={b.generales.vientos} alCambiar={(v) => set("generales.vientos", v)} placeholder="S/SO 1 - 15 km/h" />
    <Linea texto="Humedad" valor={b.generales.humedad} alCambiar={(v) => set("generales.humedad", v)} placeholder="65 - 100 %" />
    <Linea texto="Presión" valor={b.generales.presion} alCambiar={(v) => set("generales.presion", v)} placeholder="1010 – 1016 HPA" />
    <Linea texto="Riesgo" valor={b.generales.riesgo} alCambiar={(v) => set("generales.riesgo", v)} />
    <Linea texto="Aviso de alerta (toda la provincia)" valor={b.avisoGeneral} alCambiar={(v) => set("avisoGeneral", v)} />
  </>;
}

const PasoResumen = ({ b, set }) => <>
  <p className="paso__ayuda">Lo que se espera en cada zona, de un vistazo. Las condiciones se eligen de la lista y se pueden sumar varias con el «+».</p>
  {ZONAS.map((z) => <section key={z} className="ens-tarjeta-informe"><h3>Zona {z}</h3>
    <Temps min={b.zonas[z].tmin} max={b.zonas[z].tmax} alMin={(v) => set(`zonas.${z}.tmin`, v)} alMax={(v) => set(`zonas.${z}.tmax`, v)} etiqueta={z} />
    <Condicion valor={b.zonas[z].condicion} alCambiar={(v) => set(`zonas.${z}.condicion`, v)} texto={`Condición, zona ${z}`} />
    <Linea texto="Aviso de alerta" valor={b.zonas[z].aviso} alCambiar={(v) => set(`zonas.${z}.aviso`, v)} />
  </section>)}
</>;

const PasoZona = ({ b, set, zona }) => <>
  <p className="paso__ayuda">Zona {zona}: humedad, viento y riesgo, y la previsión de cada localidad.</p>
  <div className="ens-grilla-informe">
    <Linea texto="Humedad" valor={b.zonas[zona].humedad} alCambiar={(v) => set(`zonas.${zona}.humedad`, v)} placeholder="65 - 100 %" />
    <Linea texto="Viento" valor={b.zonas[zona].viento} alCambiar={(v) => set(`zonas.${zona}.viento`, v)} placeholder="SO 1-15 km/h" />
    <Linea texto="Riesgo" valor={b.zonas[zona].riesgo} alCambiar={(v) => set(`zonas.${zona}.riesgo`, v)} />
    <Linea texto="Aviso de alerta" valor={b.zonas[zona].aviso} alCambiar={(v) => set(`zonas.${zona}.aviso`, v)} />
  </div>
  <div className="pron-localidades">
    {b.localidades.map((l, i) => l.zona === zona && <section key={l.localidad} className="ens-tarjeta-informe"><h3>{l.localidad}</h3>
      <Temps min={l.tmin} max={l.tmax} alMin={(v) => set(`localidades.${i}.tmin`, v)} alMax={(v) => set(`localidades.${i}.tmax`, v)} etiqueta={l.localidad} />
      <Condicion valor={l.condicion} alCambiar={(v) => set(`localidades.${i}.condicion`, v)} texto={`Condición en ${l.localidad}`} />
    </section>)}
  </div>
</>;

const PasoExtendido = ({ b, set }) => <>
  <p className="paso__ayuda">Pronóstico extendido: los dos días que siguen a la fecha del informe, por zona.</p>
  {ZONAS.map((z) => <section key={z} className="ens-tarjeta-informe"><h3>Zona {z}</h3>
    {b.extendido[z].map((d, i) => <div key={d.fecha} className="pron-dia"><strong>{encabezadoDia(d.fecha)}</strong>
      <Temps min={d.tmin} max={d.tmax} alMin={(v) => set(`extendido.${z}.${i}.tmin`, v)} alMax={(v) => set(`extendido.${z}.${i}.tmax`, v)} etiqueta={`${z} ${ddmmaaaa(d.fecha)}`} />
      <Condicion valor={d.condicion} alCambiar={(v) => set(`extendido.${z}.${i}.condicion`, v)} texto={`Condición ${z} ${ddmmaaaa(d.fecha)}`} />
    </div>)}
  </section>)}
</>;

const PasoInformes = ({ b, set }) => <>
  <p className="paso__ayuda">El texto de cada día, como en «Informes de pronóstico» del informe: un resumen y tres líneas (precipitaciones, vientos y temperaturas). El primer día es el de la fecha del informe.</p>
  {b.informes.map((inf, i) => <section key={inf.fecha} className="ens-tarjeta-informe"><h3>{encabezadoDia(inf.fecha)}</h3>
    <Texto texto="Resumen" valor={inf.resumen} alCambiar={(v) => set(`informes.${i}.resumen`, v)} filas={4} placeholder="Tiempo húmedo con leve descenso de las temperaturas…" />
    <Texto texto="Precipitaciones" valor={inf.precipitaciones} alCambiar={(v) => set(`informes.${i}.precipitaciones`, v)} filas={2} placeholder="de 2 a 10 mm. Probabilidad de precipitaciones: 40/70 %." />
    <Texto texto="Vientos" valor={inf.vientos} alCambiar={(v) => set(`informes.${i}.vientos`, v)} filas={2} placeholder="del sur con velocidades entre 2 y 15 km/h." />
    <Texto texto="Temperaturas" valor={inf.temperaturas} alCambiar={(v) => set(`informes.${i}.temperaturas`, v)} filas={2} placeholder="máxima en la provincia estimada en 25 °C para Iguazú…" />
  </section>)}
</>;

/** Lo que falta para poder cargarlo en el mapa público. */
function problemasParaMapa(b) {
  const p = [];
  const revisar = (nombre, tmin, tmax, condicion) => {
    if (!entero(tmin) || !entero(tmax)) p.push(`${nombre}: falta la mínima o la máxima (sólo el número, de −15 a 55)`);
    else if (Number(tmin) > Number(tmax)) p.push(`${nombre}: la mínima supera la máxima`);
    if (!hayCondicion(condicion)) p.push(`${nombre}: falta elegir la condición`);
  };
  b.localidades.forEach((l) => revisar(l.localidad, l.tmin, l.tmax, l.condicion));
  ZONAS.forEach((z) => revisar(`Zona ${z}`, b.zonas[z].tmin, b.zonas[z].tmax, b.zonas[z].condicion));
  ZONAS.forEach((z) => b.extendido[z].forEach((d) => revisar(`Extendido ${z} ${ddmmaaaa(d.fecha)}`, d.tmin, d.tmax, d.condicion)));
  return p;
}
/** Lo que falta escribir (no bloquea: el PDF se puede bajar igual). */
function faltantes(b) {
  const f = [];
  if (!b.generales.sol.trim() || !b.generales.luna.trim()) f.push("sol y luna");
  const sinTexto = b.informes.filter((i) => !i.resumen.trim()).length;
  if (sinTexto) f.push(`el texto de ${sinTexto} día${sinTexto === 1 ? "" : "s"}`);
  return f;
}

function PasoRevision({ b, alUsarEnMapa, usadoEnMapa }) {
  const [estado, setEstado] = useState({ trabajando: "", error: "" });
  const problemas = useMemo(() => problemasParaMapa(b), [b]);
  const falta = faltantes(b);
  async function pdf(accion) {
    setEstado({ trabajando: accion === "ver" ? "Armando el PDF…" : "Preparando la descarga…", error: "" });
    try {
      const blob = await api.generarInformePdf(b), url = URL.createObjectURL(blob);
      if (accion === "ver") window.open(url, "_blank", "noopener");
      else { const a = Object.assign(document.createElement("a"), { href: url, download: `PREVISION DEL TIEMPO ${b.fecha}.pdf` }); document.body.append(a); a.click(); a.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setEstado({ trabajando: "", error: "" });
    } catch (e) { setEstado({ trabajando: "", error: e.message }); }
  }
  return <>
    <p className="paso__ayuda">El informe sale en <strong>PDF</strong>, con marca de agua y protegido (se puede abrir e imprimir; no copiar ni modificar). Los mismos datos se pueden <strong>cargar en la pantalla</strong> para ver el mapa y publicarlo.</p>
    {falta.length > 0 ? <p className="paso-aviso" role="status">Todavía falta: {falta.join(", ")}. Podés generar el PDF igual.</p> : <p className="paso-aviso ens-ok" role="status">Está todo completo.</p>}
    <div className="ens-hoja" aria-label="Resumen del informe">
      <h3>PREVISIÓN DEL TIEMPO PARA LA PROVINCIA DE MISIONES</h3>
      <p><strong>DATOS: {encabezadoDia(b.fecha).toUpperCase()} DE {b.fecha.slice(0, 4)}</strong> · emisión {b.emision} h</p>
      <table><thead><tr><th>ZONA</th><th>MÍN</th><th>MÁX</th><th>CONDICIÓN</th><th>ALERTA</th></tr></thead><tbody>
        {ZONAS.map((z) => <tr key={z}><th>{z.toUpperCase()}</th><td>{b.zonas[z].tmin}°</td><td>{b.zonas[z].tmax}°</td><td>{b.zonas[z].condicion}</td><td>{b.zonas[z].aviso}</td></tr>)}
      </tbody></table>
      <table><thead><tr><th>LOCALIDAD</th><th>MÍN</th><th>MÁX</th><th>CONDICIÓN</th></tr></thead><tbody>
        {b.localidades.map((l) => <tr key={l.localidad}><th>{l.localidad}</th><td>{l.tmin}°</td><td>{l.tmax}°</td><td>{l.condicion}</td></tr>)}
      </tbody></table>
    </div>
    {estado.error && <p className="paso-aviso" role="alert">{estado.error}</p>}
    {problemas.length > 0 && <div className="paso-aviso" role="status"><strong>Para cargarlo en el mapa falta:</strong><ul className="ens-problemas">{problemas.slice(0, 5).map((x) => <li key={x}>{x}</li>)}</ul>{problemas.length > 5 && <small>…y {problemas.length - 5} más.</small>}</div>}
    {usadoEnMapa && <p className="paso-aviso ens-ok" role="status">Cargado en la pantalla: revisá el mapa y tocá «Revisar y publicar».</p>}
    <div className="ens-acciones-informe">
      <button type="button" className="btn btn--primary" disabled={!!estado.trabajando} onClick={() => pdf("ver")}>{estado.trabajando || "Ver el PDF"}</button>
      <button type="button" className="btn" disabled={!!estado.trabajando} onClick={() => pdf("bajar")}>Descargar PDF</button>
      <button type="button" className="btn btn--ghost" disabled={problemas.length > 0 || !!estado.trabajando} onClick={alUsarEnMapa}>Cargar en la pantalla (mapa)</button>
    </div>
  </>;
}

const PASOS = [
  { id: "generales", titulo: "Fecha y datos generales" }, { id: "resumen", titulo: "Resumen por zona" },
  { id: "Norte", titulo: "Zona Norte" }, { id: "Centro", titulo: "Zona Centro" }, { id: "Sur", titulo: "Zona Sur" },
  { id: "extendido", titulo: "Pronóstico extendido" }, { id: "informes", titulo: "Informes de los días" }, { id: "revision", titulo: "Revisión y PDF" },
];

/** El botón que abre y oculta el cajón. */
export function BotonInformePronostico({ abierto, onClick, hayBorrador }) {
  return <button type="button" className={`ens-boton-informe pron-boton-informe${abierto ? " ens-boton-informe--abierto" : ""}`} onClick={onClick} aria-expanded={abierto} aria-controls="ens-cajon">
    <Icono icono={abierto ? ChevronRight : FileText} size={30} strokeWidth={1.5} />
    <span className="ens-boton-informe-texto"><strong>{abierto ? "Ocultar el informe" : "Armar el informe del día"}</strong>
      <small>{abierto ? "Lo escrito queda guardado" : hayBorrador ? "Seguir con el borrador guardado" : "Paso a paso, con salida en PDF"}</small></span>
    {!abierto && hayBorrador && <i className="ens-cajon-punto" title="Hay un borrador guardado" />}
  </button>;
}

/** El cajón: se abre y se oculta con el botón; lo escrito queda guardado en `informe`. */
export default function InformePronostico({ informe, abierto, onCerrar, publicado, alUsarEnMapa }) {
  const { borrador: b, paso, setPaso, setCampo, reemplazar, reiniciar } = informe;
  const cuerpo = useRef(null);
  const [usado, setUsado] = useState(false);
  const p = PASOS[Math.min(paso, PASOS.length - 1)], ultimo = paso === PASOS.length - 1;
  useEffect(() => { cuerpo.current?.scrollTo({ top: 0 }); setUsado(false); }, [paso]);

  async function empezarDeNuevo() {
    if (await confirmar({ titulo: "¿Empezar un informe nuevo?", texto: "Se borra todo lo escrito en este borrador.", confirmar: "Empezar de nuevo", peligro: true })) reiniciar();
  }
  async function cargarPublicado() {
    if (informe.hayAlgo && !(await confirmar({ titulo: "¿Partir de lo publicado?", texto: "Se reemplaza lo que escribiste en este borrador.", confirmar: "Reemplazar", peligro: true }))) return;
    reemplazar(desdePublicado(publicado));
  }
  const contenido = p.id === "generales" ? <PasoGenerales b={b} set={setCampo} publicado={publicado} alCargarPublicado={cargarPublicado} />
    : p.id === "resumen" ? <PasoResumen b={b} set={setCampo} />
    : ZONAS.includes(p.id) ? <PasoZona b={b} set={setCampo} zona={p.id} />
    : p.id === "extendido" ? <PasoExtendido b={b} set={setCampo} />
    : p.id === "informes" ? <PasoInformes b={b} set={setCampo} />
    : <PasoRevision b={b} usadoEnMapa={usado} alUsarEnMapa={() => { alUsarEnMapa(aMapa(b)); setUsado(true); }} />;

  return <aside id="ens-cajon" className={`ens-cajon ens-cajon--ancho${abierto ? " ens-cajon--abierto" : ""}`} aria-label="Informe de pronóstico" {...(abierto ? {} : { inert: "" })}>
    <header className="ens-cajon-cab">
      <div><h2>Informe del día</h2><p>Borrador guardado en este navegador</p></div>
      <div className="ens-cajon-acciones"><button type="button" className="btn-link" onClick={empezarDeNuevo}>Empezar de nuevo</button><button type="button" className="btn btn--ghost" onClick={onCerrar}>Ocultar <Icono icono={ChevronRight} size={16} /></button></div>
    </header>
    <div className="ens-cajon-cuerpo" ref={cuerpo}>
      <div className="paso-cabecera"><div className="paso-barra" role="progressbar" aria-label="Progreso" aria-valuemin={0} aria-valuemax={PASOS.length} aria-valuenow={paso + 1}><i style={{ "--desde": `${(paso / PASOS.length) * 100}%`, "--p": `${((paso + 1) / PASOS.length) * 100}%` }} /></div>
        <span className="paso-contador">Paso {paso + 1} de {PASOS.length}</span></div>
      <div className="paso" key={p.id}><h3 className="ens-cajon-titulo">{p.titulo}</h3>{contenido}</div>
    </div>
    <footer className="ens-cajon-pie">
      <button type="button" className="btn btn--ghost" disabled={paso === 0} onClick={() => setPaso(paso - 1)}><Icono icono={ChevronLeft} size={16} /> Atrás</button>
      {!ultimo && <button type="button" className="btn btn--primary" onClick={() => setPaso(paso + 1)}>Siguiente <Icono icono={ChevronRight} size={16} /></button>}
    </footer>
  </aside>;
}
