import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, ChevronRight, ChevronLeft } from "lucide";
import Icono from "./Icono";
import CampoFecha from "./CampoFecha";
import * as api from "../api";
import { Link } from "react-router-dom";
import { confirmar, esc } from "../lib/ui";
import { hayCondicion } from "../lib/condiciones";
import SelectorCondiciones from "./SelectorCondiciones";
import { filaInvalida } from "../lib/asistentesPronostico";
import { hayInvalidosExtendido } from "./PronosticoExtendidoEditor";
import { origenDe } from "./PronosticoPublicado";

/**
 * Informe «PREVISIÓN DEL TIEMPO PARA LA PROVINCIA DE MISIONES» armado paso a paso desde el ensamble, en un cajón
 * lateral que se puede ocultar sin perder nada: el borrador vive en `useInforme` (que la pantalla del ensamble
 * mantiene siempre montado) y se guarda solo en el navegador. El .docx sale del backend, completando la plantilla
 * oficial (mapa-backend/src/lib/informePronostico.js).
 *
 * Qué se completa solo: temperaturas, sensación térmica, humedad, lluvia y viento (provincia, zonas, ciudades y
 * extendido). Lo que escribe el equipo: el texto de los dos días, el estado del tiempo y la alerta. Lo que ya se
 * escribió a mano (campo «tocado») nunca lo pisa «Completar con los modelos».
 */
export const CIUDADES = ["POSADAS", "L. N. ALEM", "APÓSTOLES", "SAN JAVIER", "MONTECARLO", "JARDÍN AMÉRICA", "SAN VICENTE", "A. DEL VALLE", "OBERÁ", "PUERTO IGUAZÚ", "BDO. DE IRIGOYEN", "ELDORADO", "SAN PEDRO"];
export const ZONAS = ["Sur", "Centro", "Norte"];
const CLAVE = "ensamble-informe-v1";
const AR = "America/Argentina/Buenos_Aires";
// Los estados del tiempo que reconoce el mapa (con ellos, lo escrito entra al mapa público sin correcciones).
const ALERTAS = ["s/a", "Amarillo Tormentas", "Naranja Tormentas", "Rojo Tormentas", "Amarillo Lluvias", "Amarillo Vientos", "Amarillo Temperaturas extremas"];

const hoyART = () => new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(new Date());
const sumarDias = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const encabezadoDia = (iso) => { const d = new Date(`${iso}T12:00:00Z`), f = (o) => new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", ...o }).format(d); return `${cap(f({ weekday: "long" }))} ${f({ day: "numeric" })} de ${cap(f({ month: "long" }))}`; };
const ddmmaaaa = (iso) => iso.split("-").reverse().join("/");
const temp = (v) => { const s = String(v ?? "").trim(); return /^-?\d+([.,]\d+)?$/.test(s) ? `${s}º C` : s; };

const zonaVacia = () => ({ tmin: "", tmax: "", sens: "", humedad: "", vientos: "", estado: "", alerta: "" });
/** Las fechas que dependen de la emisión: los dos días con texto y los dos del extendido. */
function conFechas(b) {
  const f = b.emision.fecha;
  return { ...b, dias: [{ ...b.dias[0], fecha: f }, { ...b.dias[1], fecha: sumarDias(f, 1) }], extendido: Object.fromEntries(ZONAS.map((z) => [z, [0, 1].map((i) => ({ ...b.extendido[z][i], fecha: sumarDias(f, 2 + i) }))])) };
}
export function borradorVacio() {
  const f = hoyART();
  return conFechas({
    emision: { fecha: f, hora: 9 }, diaTablas: 0,
    dias: [{ texto: "", recomendaciones: "" }, { texto: "" }],
    provincia: { tmin: { valor: "", lugar: "" }, tmax: { valor: "", lugar: "" }, humedad: "", precipitaciones: "", vientos: "" },
    zonas: Object.fromEntries(ZONAS.map((z) => [z, zonaVacia()])),
    ciudades: CIUDADES.map(() => ({ tmin: "", tmax: "", estado: "", alerta: "" })),
    extendido: Object.fromEntries(ZONAS.map((z) => [z, [0, 1].map(() => ({ tmin: "", tmax: "", estado: "", alerta: "" }))])),
  });
}

const leerGuardado = () => { try { const g = JSON.parse(localStorage.getItem(CLAVE)); return g?.borrador ? g : null; } catch { return null; } };
const poner = (obj, camino, valor) => { // copia con `valor` en `camino` ("zonas.Sur.tmin", "ciudades.3.estado")
  const [k, ...resto] = camino.split(".");
  const copia = Array.isArray(obj) ? [...obj] : { ...obj };
  copia[k] = resto.length ? poner(obj[k], resto.join("."), valor) : valor;
  return copia;
};
const hojas = (obj, base = "") => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? hojas(v, `${base}${k}.`) : [[`${base}${k}`, v]]));

/** El borrador, el paso y qué campos se tocaron a mano; se guarda solo. Lo usa la pantalla del ensamble (siempre montada). */
export function useInforme() {
  const [estado, setEstado] = useState(() => { const g = leerGuardado(); return g ? { borrador: g.borrador, tocados: g.tocados || [], paso: g.paso || 0 } : { borrador: borradorVacio(), tocados: [], paso: 0 }; });
  const actual = useRef(estado); actual.current = estado;
  useEffect(() => { try { localStorage.setItem(CLAVE, JSON.stringify({ ...estado })); } catch { /* sin almacenamiento: sigue andando, sólo que no se guarda */ } }, [estado]);
  return {
    ...estado,
    /** Escribe un campo a mano: queda «tocado» y la propuesta de los modelos ya no lo pisa. */
    setCampo: (camino, valor) => setEstado((e) => {
      let borrador = poner(e.borrador, camino, valor);
      if (camino === "emision.fecha") borrador = conFechas(borrador); // los días siguen a la emisión (no cuentan como escritos a mano)
      const derivado = camino === "emision.fecha" || camino === "diaTablas" || camino === "emision.hora";
      return { ...e, borrador, tocados: derivado || e.tocados.includes(camino) ? e.tocados : [...e.tocados, camino] };
    }),
    setPaso: (paso) => setEstado((e) => ({ ...e, paso })),
    /** Vuelca la propuesta de los modelos en los campos que nadie escribió. Devuelve { puestos, respetados }. */
    aplicar: (propuesta) => {
      // Se calcula con el estado actual (no dentro del actualizador de React, que corre más tarde) para poder devolver los conteos.
      let puestos = 0, respetados = 0, borrador = actual.current.borrador;
      for (const [camino, valor] of hojas(propuesta)) {
        if (valor === "" || valor == null || /\.fecha$/.test(camino)) continue;
        if (actual.current.tocados.includes(camino)) { respetados++; continue; }
        borrador = poner(borrador, camino, valor); puestos++;
      }
      setEstado((e) => ({ ...e, borrador }));
      return { puestos, respetados };
    },
    reiniciar: () => setEstado({ borrador: borradorVacio(), tocados: [], paso: 0 }),
    escritos: estado.tocados.length,
  };
}

// --- piezas de los pasos ---------------------------------------------------------------------------------------
const Etiqueta = ({ texto, children }) => <label className="paso-etiqueta"><span>{texto}</span>{children}</label>;
const Linea = ({ texto, valor, alCambiar, ...resto }) => <Etiqueta texto={texto}><input className="paso-input" value={valor} onChange={(e) => alCambiar(e.target.value)} {...resto} /></Etiqueta>;
const Texto = ({ texto, valor, alCambiar, filas = 6, ...resto }) => <Etiqueta texto={texto}><textarea className="paso-texto" rows={filas} value={valor} onChange={(e) => alCambiar(e.target.value)} {...resto} /></Etiqueta>;
const Celda = ({ valor, alCambiar, etiqueta, lista, ancho, ...resto }) => <input className="ens-celda-informe" style={ancho ? { width: ancho } : undefined} value={valor} onChange={(e) => alCambiar(e.target.value)} aria-label={etiqueta} list={lista} {...resto} />;

function PasoEmision({ b, set }) {
  return <>
    <p className="paso__ayuda">La fecha de emisión define los dos días con texto (el de la emisión y el siguiente) y los dos del pronóstico extendido.</p>
    <CampoFecha label="Fecha de emisión" value={b.emision.fecha} onChange={(v) => v && set("emision.fecha", v)} />
    <Etiqueta texto="Hora de emisión"><select className="paso-input" value={b.emision.hora} onChange={(e) => set("emision.hora", Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h === 1 ? "a la 1 hora" : `a las ${h} horas`}</option>)}</select></Etiqueta>
    <fieldset className="ens-opciones-informe"><legend>¿De qué día son las tablas de provincia, zonas y ciudades?</legend>
      {[[0, `Del primer día (${encabezadoDia(b.dias[0].fecha)})`], [1, `Del segundo día (${encabezadoDia(b.dias[1].fecha)})`]].map(([v, t]) => <label key={v} className="ens-radio"><input type="radio" name="dia-tablas" checked={b.diaTablas === v} onChange={() => set("diaTablas", v)} /><span>{t}</span></label>)}
    </fieldset>
  </>;
}

function PasoModelos({ b, prendidos, modelos, alAplicar }) {
  const [estado, setEstado] = useState({ cargando: false, mensaje: "", avisos: [] });
  async function completar() {
    setEstado({ cargando: true, mensaje: "", avisos: [] });
    try {
      const r = await api.proponerInforme({ emision: b.emision, diaTablas: b.diaTablas, modelos: [...prendidos] });
      const { puestos, respetados } = alAplicar(r.propuesta);
      setEstado({ cargando: false, avisos: r.avisos, mensaje: `Se completaron ${puestos} campos con el promedio de ${r.modelos.length} modelo${r.modelos.length === 1 ? "" : "s"} para el ${ddmmaaaa(r.fechaTablas)}.${respetados ? ` Se respetaron ${respetados} que ya escribiste.` : ""}` });
    } catch (e) { setEstado({ cargando: false, mensaje: "", avisos: [e.message] }); }
  }
  return <>
    <p className="paso__ayuda">Completa con el <strong>promedio de los modelos prendidos</strong> (los de la izquierda del ensamble): temperaturas mínima y máxima, sensación térmica, humedad, lluvia y viento de la provincia, las zonas y las 13 ciudades, y el extendido. Pide datos recién cuando tocás el botón.</p>
    <ul className="paso-lista"><li>Modelos: <strong>{modelos.filter((m) => prendidos.has(m.id)).map((m) => m.nombre).join(", ")}</strong> <small>(se cambian en el ensamble)</small></li><li>Tablas del <strong>{encabezadoDia(b.dias[b.diaTablas].fecha)}</strong></li></ul>
    <button type="button" className="btn btn--primary" disabled={estado.cargando} onClick={completar}>{estado.cargando ? "Consultando a los modelos…" : "Completar con los modelos"}</button>
    {estado.mensaje && <p className="paso-aviso ens-ok" role="status">{estado.mensaje}</p>}
    {estado.avisos.map((a) => <p key={a} className="paso-aviso" role="alert">{a}</p>)}
    <p className="paso-nota">El texto de los días, el estado del tiempo y las alertas los escribe el equipo en los pasos siguientes. Si ya escribiste algo, no se pisa.</p>
  </>;
}

const PasoDia = ({ b, set, i }) => <>
  <p className="paso__ayuda">{i === 0 ? "Lo que se espera para el resto del día de la emisión." : "Lo que se espera para el día siguiente."}</p>
  <Texto texto={encabezadoDia(b.dias[i].fecha)} valor={b.dias[i].texto} alCambiar={(v) => set(`dias.${i}.texto`, v)} filas={9} placeholder={i === 0 ? "Un sistema de baja presión genera…" : "Se espera un ingreso de aire frío que hará…"} />
  {i === 0 && <Linea texto="Recomendaciones (opcional)" valor={b.dias[0].recomendaciones} alCambiar={(v) => set("dias.0.recomendaciones", v)} placeholder="HOY BERMUDAS" />}
</>;

const PasoProvincia = ({ b, set }) => <>
  <p className="paso__ayuda">Previsión para toda la provincia, del {encabezadoDia(b.dias[b.diaTablas].fecha)}. Temperaturas en °C (sólo el número).</p>
  <div className="ens-par"><Linea texto="Mínima (°C)" valor={b.provincia.tmin.valor} alCambiar={(v) => set("provincia.tmin.valor", v)} inputMode="numeric" /><Linea texto="…en" valor={b.provincia.tmin.lugar} alCambiar={(v) => set("provincia.tmin.lugar", v)} placeholder="San Pedro" /></div>
  <div className="ens-par"><Linea texto="Máxima (°C)" valor={b.provincia.tmax.valor} alCambiar={(v) => set("provincia.tmax.valor", v)} inputMode="numeric" /><Linea texto="…en" valor={b.provincia.tmax.lugar} alCambiar={(v) => set("provincia.tmax.lugar", v)} placeholder="Eldorado" /></div>
  <Texto texto="Humedad" valor={b.provincia.humedad} alCambiar={(v) => set("provincia.humedad", v)} filas={2} placeholder={"MÍN. PROMEDIO 60%  16 HORAS\nMAX. PROMEDIO  90%, 07 HORAS"} />
  <Linea texto="Precipitaciones" valor={b.provincia.precipitaciones} alCambiar={(v) => set("provincia.precipitaciones", v)} placeholder="2 a 10 mm en zona central (10 a 40 % de probabilidad)" />
  <Linea texto="Vientos" valor={b.provincia.vientos} alCambiar={(v) => set("provincia.vientos", v)} placeholder="3 a 15 km/h, de direcciones variables" />
</>;

const PasoZonas = ({ b, set }) => <>
  <p className="paso__ayuda">Una tarjeta por zona. Mínima y máxima en °C; el estado del tiempo y la alerta los escribís vos (hay sugerencias).</p>
  {ZONAS.map((z) => <section key={z} className="ens-tarjeta-informe"><h3>Zona {z}</h3><div className="ens-grilla-informe">
    <Linea texto="Mínima (°C)" valor={b.zonas[z].tmin} alCambiar={(v) => set(`zonas.${z}.tmin`, v)} inputMode="numeric" />
    <Linea texto="Máxima (°C)" valor={b.zonas[z].tmax} alCambiar={(v) => set(`zonas.${z}.tmax`, v)} inputMode="numeric" />
    <Texto texto="Sens. térmica" valor={b.zonas[z].sens} alCambiar={(v) => set(`zonas.${z}.sens`, v)} filas={2} />
    <Linea texto="Humedad relativa" valor={b.zonas[z].humedad} alCambiar={(v) => set(`zonas.${z}.humedad`, v)} />
    <Texto texto="Vientos" valor={b.zonas[z].vientos} alCambiar={(v) => set(`zonas.${z}.vientos`, v)} filas={2} />
    <div className="paso-etiqueta"><span>Estado del tiempo</span><SelectorCondiciones valor={b.zonas[z].estado} alCambiar={(v) => set(`zonas.${z}.estado`, v)} etiqueta={`Estado del tiempo, zona ${z}`} /></div>
    <Linea texto="Alerta" valor={b.zonas[z].alerta} alCambiar={(v) => set(`zonas.${z}.alerta`, v)} list="ens-alertas" />
  </div></section>)}
</>;

const PasoCiudades = ({ b, set }) => <>
  <p className="paso__ayuda">Las 13 ciudades principales, del {encabezadoDia(b.dias[b.diaTablas].fecha)}. Mínima y máxima en °C.</p>
  <table className="ens-tabla-informe"><thead><tr><th>Ciudad</th><th>Mín</th><th>Máx</th><th>Estado del tiempo</th><th>Alerta</th></tr></thead><tbody>
    {CIUDADES.map((c, i) => <tr key={c}><th scope="row">{c}</th>
      <td><Celda valor={b.ciudades[i].tmin} alCambiar={(v) => set(`ciudades.${i}.tmin`, v)} etiqueta={`Mínima de ${c}`} inputMode="numeric" ancho="3.2em" /></td>
      <td><Celda valor={b.ciudades[i].tmax} alCambiar={(v) => set(`ciudades.${i}.tmax`, v)} etiqueta={`Máxima de ${c}`} inputMode="numeric" ancho="3.2em" /></td>
      <td><SelectorCondiciones compacto valor={b.ciudades[i].estado} alCambiar={(v) => set(`ciudades.${i}.estado`, v)} etiqueta={`Estado del tiempo en ${c}`} /></td>
      <td><Celda valor={b.ciudades[i].alerta} alCambiar={(v) => set(`ciudades.${i}.alerta`, v)} etiqueta={`Alerta en ${c}`} lista="ens-alertas" /></td></tr>)}
  </tbody></table>
</>;

const PasoExtendido = ({ b, set }) => <>
  <p className="paso__ayuda">Pronóstico extendido: los dos días que siguen a los del texto, por zona.</p>
  {ZONAS.map((z) => <section key={z} className="ens-tarjeta-informe"><h3>Zona {z}</h3>
    <table className="ens-tabla-informe"><thead><tr><th>Fecha</th><th>Mín</th><th>Máx</th><th>Tiempo</th><th>Alerta</th></tr></thead><tbody>
      {b.extendido[z].map((d, i) => <tr key={d.fecha}><th scope="row">{ddmmaaaa(d.fecha)}</th>
        <td><Celda valor={d.tmin} alCambiar={(v) => set(`extendido.${z}.${i}.tmin`, v)} etiqueta={`Mínima ${z} ${ddmmaaaa(d.fecha)}`} inputMode="numeric" ancho="3.2em" /></td>
        <td><Celda valor={d.tmax} alCambiar={(v) => set(`extendido.${z}.${i}.tmax`, v)} etiqueta={`Máxima ${z} ${ddmmaaaa(d.fecha)}`} inputMode="numeric" ancho="3.2em" /></td>
        <td><SelectorCondiciones compacto valor={d.estado} alCambiar={(v) => set(`extendido.${z}.${i}.estado`, v)} etiqueta={`Tiempo ${z} ${ddmmaaaa(d.fecha)}`} /></td>
        <td><Celda valor={d.alerta} alCambiar={(v) => set(`extendido.${z}.${i}.alerta`, v)} etiqueta={`Alerta ${z} ${ddmmaaaa(d.fecha)}`} lista="ens-alertas" /></td></tr>)}
    </tbody></table></section>)}
</>;

/** Lo que falta escribir (no bloquea: el informe se puede bajar igual). */
function faltantes(b) {
  const f = [];
  if (!b.dias[0].texto.trim()) f.push("el texto del primer día");
  if (!b.dias[1].texto.trim()) f.push("el texto del segundo día");
  if (!b.provincia.tmin.valor || !b.provincia.tmax.valor) f.push("la mínima y la máxima de la provincia");
  const sinEstado = ZONAS.filter((z) => !b.zonas[z].estado.trim()).length + b.ciudades.filter((c) => !c.estado.trim()).length;
  if (sinEstado) f.push(`el estado del tiempo de ${sinEstado} lugar${sinEstado === 1 ? "" : "es"}`);
  const sinTemp = b.ciudades.filter((c) => !c.tmin || !c.tmax).length;
  if (sinTemp) f.push(`las temperaturas de ${sinTemp} ciudad${sinTemp === 1 ? "" : "es"}`);
  return f;
}

/**
 * Lo que impide cargarlo en el mapa público. Las 13 ciudades son las localidades del mapa, y el extendido y el «hoy» de las
 * zonas alimentan el pronóstico de 3 días: tienen que tener temperaturas en regla y un estado del tiempo que el mapa reconozca.
 */
function problemasParaMapa(b) {
  const p = [];
  const mala = (v) => { const n = Number(v); return String(v ?? "").trim() === "" || !Number.isInteger(n) || n < -15 || n > 55; };
  const revisar = (nombre, tmin, tmax, estado) => {
    if (mala(tmin) || mala(tmax)) p.push(`${nombre}: falta la mínima o la máxima (sólo el número, en °C)`);
    else if (Number(tmin) > Number(tmax)) p.push(`${nombre}: la mínima supera la máxima`);
    if (!hayCondicion(estado)) p.push(`${nombre}: falta el estado del tiempo`);
  };
  b.ciudades.forEach((c, i) => revisar(CIUDADES[i], c.tmin, c.tmax, c.estado));
  ZONAS.forEach((z) => { const d = b.zonas[z]; if (d.tmin || d.tmax || d.estado) revisar(`Zona ${z}`, d.tmin, d.tmax, d.estado); }); // la zona vacía se resume con sus ciudades
  ZONAS.forEach((z) => b.extendido[z].forEach((d) => revisar(`Extendido ${z} ${ddmmaaaa(d.fecha)}`, d.tmin, d.tmax, d.estado)));
  return p;
}

function PasoRevision({ b }) {
  const [estado, setEstado] = useState({ bajando: false, trabajando: "", error: "", hecho: null });
  const falta = faltantes(b), problemas = useMemo(() => problemasParaMapa(b), [b]);
  async function bajar() {
    setEstado({ bajando: true, trabajando: "", error: "", hecho: null });
    try { await api.descargarInformeDocx(b); setEstado({ bajando: false, trabajando: "", error: "", hecho: null }); }
    catch (e) { setEstado({ bajando: false, trabajando: "", error: e.message, hecho: null }); }
  }
  /** El mismo proceso que «Previsión del tiempo», hecho desde acá: armar el .docx, leerlo como si se hubiera subido, validar y publicar. */
  async function cargarEnMapa() {
    setEstado({ bajando: false, trabajando: "Armando y leyendo el informe…", error: "", hecho: null });
    try {
      const archivo = new File([await api.generarInformeDocx(b)], `PREVISION DEL TIEMPO ${b.emision.fecha}.docx`, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const { filas, extendido } = await api.parseDocx(archivo);
      const fecha = b.dias[b.diaTablas].fecha;
      if (!filas?.length || filas.some(filaInvalida) || !extendido || hayInvalidosExtendido(extendido)) throw new Error("El mapa no acepta algo del informe (temperaturas fuera de rango o un estado del tiempo vacío). Revisá las ciudades, las zonas y el extendido.");
      const actual = await api.getPublicado().catch(() => null); // lo que se ve ahora y desde dónde se hizo
      const ok = await confirmar({
        titulo: "¿Publicar en el mapa público?", confirmar: "Publicar ahora", cancelar: "Todavía no",
        html: `<p>Se va a publicar el pronóstico del <b>${esc(ddmmaaaa(fecha))}</b>: ${filas.length} localidades y el pronóstico de 3 días.</p>
          <p>Reemplaza lo que muestran ahora el <b>mapa público</b>, el <b>pronóstico de 3 días</b> y los <b>embebidos</b>${actual ? ` (hoy: el del ${esc(ddmmaaaa(actual.fechaPronostico || actual.publicadoEn))}, ${esc(origenDe(actual).toLowerCase())}${actual.publicadoPor ? `, por ${esc(actual.publicadoPor)}` : ""})` : ""}.</p>
          <p>Quedará registrado como hecho <b>desde el ensamble</b>, y así se va a ver en «Previsión del tiempo».</p>`,
      });
      if (!ok) { setEstado({ bajando: false, trabajando: "", error: "", hecho: null }); return; }
      setEstado({ bajando: false, trabajando: "Publicando…", error: "", hecho: null });
      await api.publicar(filas, fecha, extendido, "ensamble");
      setEstado({ bajando: false, trabajando: "", error: "", hecho: { fecha, localidades: filas.length } });
    } catch (e) { setEstado({ bajando: false, trabajando: "", error: e.message, hecho: null }); }
  }
  return <>
    <p className="paso__ayuda">Así queda el informe. Podés <strong>cargarlo en el mapa público</strong> (hace el mismo proceso que «Previsión del tiempo») o bajarlo como .docx, que se genera sobre la plantilla oficial.</p>
    {falta.length > 0 ? <p className="paso-aviso" role="status">Todavía falta: {falta.join(", ")}. Podés bajarlo igual y completarlo en Word.</p> : <p className="paso-aviso ens-ok" role="status">Está todo completo.</p>}
    <div className="ens-hoja" aria-label="Vista previa del informe">
      <h3>PREVISIÓN DEL TIEMPO PARA LA PROVINCIA DE MISIONES</h3>
      <p><strong>EMISIÓN: {ddmmaaaa(b.emision.fecha)}, a las {b.emision.hora} horas</strong></p>
      {b.dias.map((d, i) => <div key={d.fecha}><p><strong>{encabezadoDia(d.fecha)}</strong></p><p className="ens-hoja-texto">{d.texto || <em>(sin texto)</em>}</p>{i === 0 && d.recomendaciones && <p><strong>RECOMENDACIONES :</strong> {d.recomendaciones}</p>}</div>)}
      <table><tbody>
        <tr><th colSpan={2}>PREVISIÓN PARA LA PROVINCIA DE MISIONES</th></tr>
        <tr><th>TEMP. MÍNIMA</th><td>{temp(b.provincia.tmin.valor)}{b.provincia.tmin.lugar && ` en ${b.provincia.tmin.lugar}`}</td></tr>
        <tr><th>TEMP. MÁXIMA</th><td>{temp(b.provincia.tmax.valor)}{b.provincia.tmax.lugar && ` en ${b.provincia.tmax.lugar}`}</td></tr>
        <tr><th>HUMEDAD</th><td className="ens-hoja-texto">{b.provincia.humedad}</td></tr>
        <tr><th>PRECIPITACIONES</th><td>{b.provincia.precipitaciones}</td></tr>
        <tr><th>VIENTOS</th><td>{b.provincia.vientos}</td></tr>
      </tbody></table>
      <table><thead><tr><th colSpan={8}>PREVISIÓN POR ZONAS</th></tr><tr><th>ZONA</th><th>MÍN</th><th>MÁX</th><th>SENS.</th><th>HUM.</th><th>VIENTOS</th><th>ESTADO</th><th>ALERTA</th></tr></thead><tbody>
        {ZONAS.map((z) => <tr key={z}><th>{z.toUpperCase()}</th><td>{temp(b.zonas[z].tmin)}</td><td>{temp(b.zonas[z].tmax)}</td><td className="ens-hoja-texto">{b.zonas[z].sens}</td><td>{b.zonas[z].humedad}</td><td className="ens-hoja-texto">{b.zonas[z].vientos}</td><td>{b.zonas[z].estado}</td><td>{b.zonas[z].alerta}</td></tr>)}
      </tbody></table>
      <table><thead><tr><th colSpan={5}>PREVISIÓN POR PRINCIPALES CIUDADES</th></tr><tr><th>CIUDAD</th><th>MÍN</th><th>MÁX</th><th>ESTADO</th><th>ALERTA</th></tr></thead><tbody>
        {CIUDADES.map((c, i) => <tr key={c}><th>{c}</th><td>{temp(b.ciudades[i].tmin)}</td><td>{temp(b.ciudades[i].tmax)}</td><td>{b.ciudades[i].estado}</td><td>{b.ciudades[i].alerta}</td></tr>)}
      </tbody></table>
      <p><strong>PREVISIÓN EXTENDIDA</strong></p>
      {ZONAS.map((z) => <table key={z}><thead><tr><th colSpan={5}>ZONA {z.toUpperCase()}</th></tr></thead><tbody>
        {b.extendido[z].map((d) => <tr key={d.fecha}><th>{ddmmaaaa(d.fecha)}</th><td>{temp(d.tmin)}</td><td>{temp(d.tmax)}</td><td>{d.estado}</td><td>{d.alerta}</td></tr>)}
      </tbody></table>)}
    </div>
    {estado.error && <p className="paso-aviso" role="alert">{estado.error}</p>}
    {problemas.length > 0 && <div className="paso-aviso" role="status"><strong>Para cargarlo en el mapa público falta:</strong><ul className="ens-problemas">{problemas.slice(0, 5).map((x) => <li key={x}>{x}</li>)}</ul>{problemas.length > 5 && <small>…y {problemas.length - 5} más.</small>}</div>}
    {estado.hecho && <div className="paso-aviso ens-ok" role="status"><strong>Publicado desde el ensamble.</strong> El mapa público, el pronóstico de 3 días y los embebidos ya muestran el informe del {ddmmaaaa(estado.hecho.fecha)} ({estado.hecho.localidades} localidades). En «Previsión del tiempo» figura como hecho acá.
      <p className="ens-enlaces"><Link to="/panel/pronostico" className="btn-link">Ver «Previsión del tiempo»</Link> · <Link to="/panel/pronostico-3-dias" className="btn-link">Ver «Pronóstico de 3 días»</Link></p></div>}
    <div className="ens-acciones-informe">
      <button type="button" className="btn btn--primary ens-boton-publicar" disabled={problemas.length > 0 || !!estado.trabajando || estado.bajando} onClick={cargarEnMapa}>{estado.trabajando || "Cargar en el mapa público"}</button>
      <button type="button" className="btn btn--ghost" disabled={!!estado.trabajando || estado.bajando} onClick={bajar}>{estado.bajando ? "Armando el informe…" : "Descargar .docx"}</button>
    </div>
  </>;
}

const PASOS = [
  { id: "emision", titulo: "¿Cuándo se emite?" }, { id: "modelos", titulo: "Completar con los modelos" },
  { id: "hoy", titulo: "Primer día" }, { id: "manana", titulo: "Segundo día" }, { id: "provincia", titulo: "Provincia" },
  { id: "zonas", titulo: "Zonas" }, { id: "ciudades", titulo: "Ciudades" }, { id: "extendido", titulo: "Extendido" }, { id: "revision", titulo: "Revisión y descarga" },
];

/** El botón grande que abre y oculta el cajón (la pantalla lo pone a la derecha del cuadro del rango de fecha y hora). */
export function BotonInforme({ abierto, onClick, escritos }) {
  return <button type="button" className={`ens-boton-informe${abierto ? " ens-boton-informe--abierto" : ""}`} onClick={onClick} aria-expanded={abierto} aria-controls="ens-cajon">
    <Icono icono={abierto ? ChevronRight : FileText} size={34} strokeWidth={1.5} />
    <span className="ens-boton-informe-texto"><strong>{abierto ? "Ocultar el informe" : "Informe de pronóstico"}</strong>
      <small>{abierto ? "Lo escrito queda guardado" : escritos > 0 ? "Seguir con el borrador guardado" : "Armarlo paso a paso con los modelos"}</small></span>
    {!abierto && escritos > 0 && <i className="ens-cajon-punto" title="Hay un borrador guardado" />}
  </button>;
}

/** El cajón: se abre y se oculta con la pestaña de la derecha; lo escrito queda guardado en `informe`. */
export default function InformeEnsamble({ informe, abierto, onCerrar, prendidos, modelos }) {
  const { borrador: b, paso, setPaso, setCampo, aplicar, reiniciar, escritos } = informe;
  const cuerpo = useRef(null);
  const p = PASOS[Math.min(paso, PASOS.length - 1)], ultimo = paso === PASOS.length - 1;
  useEffect(() => { cuerpo.current?.scrollTo({ top: 0 }); }, [paso]);

  async function empezarDeNuevo() {
    if (await confirmar({ titulo: "¿Empezar un informe nuevo?", texto: "Se borra todo lo escrito en este borrador.", confirmar: "Empezar de nuevo", peligro: true })) reiniciar();
  }
  const contenido = {
    emision: <PasoEmision b={b} set={setCampo} />, modelos: <PasoModelos b={b} prendidos={prendidos} modelos={modelos} alAplicar={aplicar} />,
    hoy: <PasoDia b={b} set={setCampo} i={0} />, manana: <PasoDia b={b} set={setCampo} i={1} />, provincia: <PasoProvincia b={b} set={setCampo} />,
    zonas: <PasoZonas b={b} set={setCampo} />, ciudades: <PasoCiudades b={b} set={setCampo} />, extendido: <PasoExtendido b={b} set={setCampo} />, revision: <PasoRevision b={b} />,
  }[p.id];

  return <>
    <aside id="ens-cajon" className={`ens-cajon${abierto ? " ens-cajon--abierto" : ""}`} aria-label="Informe de pronóstico" {...(abierto ? {} : { inert: "" })}>
      <header className="ens-cajon-cab">
        <div><h2>Informe de pronóstico</h2><p>Borrador guardado en este navegador{escritos > 0 ? ` · ${escritos} campo${escritos === 1 ? "" : "s"} escrito${escritos === 1 ? "" : "s"} a mano` : ""}</p></div>
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
      <datalist id="ens-alertas">{ALERTAS.map((a) => <option key={a} value={a} />)}</datalist>
    </aside>
  </>;
}
