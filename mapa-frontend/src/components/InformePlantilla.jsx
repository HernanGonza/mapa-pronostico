import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronLeft } from "lucide";
import Icono from "./Icono";
import CampoFecha from "./CampoFecha";
import { Linea, Texto, Condicion } from "./InformePronostico";
import * as api from "../api";
import { confirmar } from "../lib/ui";
import { borradorNuevo, BOTONES, ZONAS_ORDEN, ROTULO_TEMP, CORTO_TEMP, botonDe, nombreDeBoton, fechaDia, fechaCorta, nombreDia, problemasV2, textoRango, diaSemana } from "../lib/informePlantillas";
import "../pages/ensamble.css"; // el cajón lateral (.ens-cajon) y los pasos son los mismos del resto de los informes

/**
 * Cajón de los informes con plantilla (5 botones, 3 plantillas: ver lib/informePlantillas.js). Empieza en la pantalla de elección
 * y, según el botón, arma los pasos: datos del informe → por cada uno de los 3 días (texto y zonas, ciudades) → revisión y PDF.
 * Los campos que no corresponden a la plantilla (por ejemplo la máxima de un informe nocturno) directamente no aparecen.
 */
const Rango = ({ texto, r, base, set, unidad, hasta = true }) => <div className="ens-par pron-temps">
  <Linea texto={hasta ? `${texto} · desde` : texto} valor={r.desde} alCambiar={(v) => set(`${base}.desde`, v)} inputMode="numeric" aria-label={`${texto} desde`} />
  {hasta && <Linea texto={`hasta${unidad ? ` (${unidad})` : ""}`} valor={r.hasta} alCambiar={(v) => set(`${base}.hasta`, v)} inputMode="numeric" aria-label={`${texto} hasta`} placeholder="igual si es uno solo" />}
</div>;

function Elegir({ alElegir }) {
  const grupos = [...new Set(BOTONES.map((x) => x.grupo))];
  return <>
    <p className="paso__ayuda">Elegí el informe que vas a armar. Cada uno tiene su vigencia y sus datos; el sistema te pide sólo lo que corresponde.</p>
    {grupos.map((g) => <section key={g} className="pron-elegir" aria-label={g}>
      <h3>{g}</h3>
      {BOTONES.filter((x) => x.grupo === g).map((x) => <button key={x.id} type="button" className="pron-elegir__boton" onClick={() => alElegir(x.id)}>
        <strong>{x.nombre}</strong><span>{x.resumen}</span>
      </button>)}
    </section>)}
  </>;
}

function PasoDatos({ b, set }) {
  const x = botonDe(b.boton), dom = diaSemana(b.fecha) === 0, mal = x.domingo ? !dom : dom;
  return <>
    <p className="paso__ayuda">Estás armando el <strong>{nombreDeBoton(b.boton)}</strong>. Los tres días y la vigencia se calculan solos a partir del día de trabajo.</p>
    <CampoFecha label="Día de trabajo" value={b.fecha} onChange={(v) => v && set("fecha", v)} />
    {mal && <p className="paso-aviso" role="alert">{x.domingo ? `Este es un informe de domingo y el día elegido es ${nombreDia(b.fecha).toLowerCase()}.` : "Este es un informe de lunes a sábado y el día elegido es domingo."} Cambiá el día o elegí otro informe.</p>}
    <ul className="paso-lista">
      <li>Sale a las <strong>{b.emision} h</strong></li>
      <li>Vigencia: hasta las <strong>{b.vigencia.hasta === "23:59" ? "23:59" : `${b.vigencia.hasta.slice(0, 2)} horas`}</strong> del <strong>{fechaCorta(b.vigencia.fecha)}</strong></li>
      <li>Días del pronóstico: <strong>{b.dias.map((d) => fechaDia(d.fecha)).join(" · ")}</strong></li>
    </ul>
    {b.plantilla === "C" && <p className="paso-nota">Este informe sale a las 00 h: el día de trabajo es el día en que se arma, y su primer día de pronóstico es el siguiente.</p>}
  </>;
}

function PasoDia({ b, i, set }) {
  const d = b.dias[i], base = `dias.${i}`;
  return <>
    <p className="paso__ayuda">{d.hoy ? "Para lo que resta del día. " : ""}Las temperaturas se cargan como rango (de un mínimo a un máximo); si es un solo valor, dejá «hasta» vacío.</p>
    <Texto texto="Texto del día" valor={d.resumen} alCambiar={(v) => set(`${base}.resumen`, v)} filas={4} placeholder="Un sistema de alta presión permite el ingreso de aire frío…" />
    {ZONAS_ORDEN.map((z) => <section key={z} className="ens-tarjeta-informe"><h3>Zona {z}</h3>
      {d.temps.map((t) => <Rango key={t} texto={ROTULO_TEMP[t]} r={d.zonas[z][t]} base={`${base}.zonas.${z}.${t}`} set={set} unidad="°C" />)}
    </section>)}
    <section className="ens-tarjeta-informe"><h3>Toda la provincia</h3>
      <Rango texto="Humedad" r={d.humedad} base={`${base}.humedad`} set={set} unidad="%" />
      {d.presion && <Rango texto="Presión atmosférica" r={d.presionRango} base={`${base}.presionRango`} set={set} unidad="hPa" />}
      <Linea texto="Precipitaciones" valor={d.precipitaciones} alCambiar={(v) => set(`${base}.precipitaciones`, v)} placeholder="Sin probabilidades" />
      <Linea texto="Vientos" valor={d.vientos} alCambiar={(v) => set(`${base}.vientos`, v)} placeholder="3 a 15 km/h, del sector sur" />
      <Linea texto="Alertas" valor={d.alertas} alCambiar={(v) => set(`${base}.alertas`, v)} placeholder="------ (si no hay alertas, dejalo vacío)" />
    </section>
  </>;
}

function PasoCiudades({ b, i, set }) {
  const d = b.dias[i], base = `dias.${i}`;
  return <>
    <p className="paso__ayuda">Las 13 ciudades de {fechaDia(d.fecha)}: {d.temps.map((t) => ROTULO_TEMP[t].toLowerCase()).join(" y ")}, estado del tiempo y alerta. En la alerta, «s/a» es sin alerta.</p>
    <div className="pron-localidades">
      {d.ciudades.map((c, k) => <section key={c.ciudad} className="ens-tarjeta-informe"><h3>{c.ciudad}</h3>
        <div className="ens-par pron-temps">{d.temps.map((t) => <Linea key={t} texto={`${CORTO_TEMP[t]} (°C)`} valor={c[t]} alCambiar={(v) => set(`${base}.ciudades.${k}.${t}`, v)} inputMode="numeric" aria-label={`${CORTO_TEMP[t]} ${c.ciudad}`} />)}</div>
        <Condicion valor={c.condicion} alCambiar={(v) => set(`${base}.ciudades.${k}.condicion`, v)} texto={`Estado del tiempo en ${c.ciudad}`} />
        <Linea texto="Alerta" valor={c.alerta} alCambiar={(v) => set(`${base}.ciudades.${k}.alerta`, v)} />
      </section>)}
    </div>
  </>;
}

function PasoRevision({ b, problemas, esNuevo, alGuardar, guardando }) {
  const [estado, setEstado] = useState({ trabajando: "", error: "" });
  async function pdf(accion) {
    setEstado({ trabajando: accion === "ver" ? "Armando el PDF…" : accion === "docx" ? "Armando el .docx…" : "Preparando la descarga…", error: "" });
    try {
      const blob = await (accion === "docx" ? api.generarInformeDocxPronostico(b) : api.generarInformePdf(b)), url = URL.createObjectURL(blob);
      if (accion === "ver") window.open(url, "_blank", "noopener");
      else { const a = Object.assign(document.createElement("a"), { href: url, download: `PREVISION DEL TIEMPO ${b.fecha} ${nombreDeBoton(b.boton)}.${accion === "docx" ? "docx" : "pdf"}` }); document.body.append(a); a.click(); a.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setEstado({ trabajando: "", error: "" });
    } catch (e) { setEstado({ trabajando: "", error: e.message }); }
  }
  return <>
    <p className="paso__ayuda">Revisá los datos contra lo que escribiste: el PDF sale cifrado y con marca de agua; el Word (.docx) es editable, sin marca, para los medios. La publicación en los mapas se define más adelante.</p>
    {problemas.length ? <div className="paso-aviso" role="status"><strong>Falta revisar ({problemas.length}):</strong><ul className="ens-problemas">{problemas.slice(0, 8).map((x) => <li key={x}>{x}</li>)}</ul>{problemas.length > 8 && <small>…y {problemas.length - 8} más.</small>}</div>
      : <p className="paso-aviso ens-ok" role="status">Informe completo.</p>}
    <div className="ens-hoja" aria-label="Resumen del informe">
      <h3>PREVISIÓN DEL TIEMPO PARA LA PROVINCIA DE MISIONES</h3>
      <p><strong>VIGENCIA: hasta las {b.vigencia.hasta} del {fechaCorta(b.vigencia.fecha)}</strong> · {nombreDeBoton(b.boton)}</p>
      {b.dias.map((d) => <table key={d.fecha}><caption>{fechaDia(d.fecha)}</caption><thead><tr><th>ZONA</th>{d.temps.map((t) => <th key={t}>{ROTULO_TEMP[t].replace("Temperaturas ", "").toUpperCase()}</th>)}</tr></thead><tbody>
        {ZONAS_ORDEN.map((z) => <tr key={z}><th>{z.toUpperCase()}</th>{d.temps.map((t) => <td key={t}>{textoRango(d.zonas[z][t]) || "—"}</td>)}</tr>)}
      </tbody></table>)}
    </div>
    {estado.error && <p className="paso-aviso" role="alert">{estado.error}</p>}
    {esNuevo && <p className="paso-aviso" role="status"><strong>Todavía no está guardado.</strong> La tarjeta del informe aparece en la pila cuando lo guardes.</p>}
    <div className="ens-acciones-informe">
      {esNuevo && <button type="button" className="btn btn--primary" disabled={guardando} onClick={alGuardar}>{guardando ? "Guardando…" : "Guardar informe"}</button>}
      <button type="button" className="btn" disabled={!!estado.trabajando} onClick={() => pdf("ver")}>{estado.trabajando || "Ver el PDF"}</button>
      <button type="button" className="btn" disabled={!!estado.trabajando} onClick={() => pdf("bajar")}>Descargar PDF</button>
      <button type="button" className="btn" disabled={!!estado.trabajando} onClick={() => pdf("docx")} title="Word editable, para que los medios armen sus notas">Descargar Word (.docx)</button>
    </div>
  </>;
}

/** Los pasos del informe según su plantilla: datos, (texto y zonas + ciudades) × 3 días, revisión. */
export function pasosDe(b) {
  return [{ id: "datos", titulo: "Datos del informe" },
    ...b.dias.flatMap((d, i) => [{ id: `dia${i}`, titulo: `${fechaDia(d.fecha)} · texto y zonas`, i }, { id: `ciu${i}`, titulo: `${fechaDia(d.fecha)} · ciudades`, i }]),
    { id: "revision", titulo: "Revisión y PDF" }];
}

/** `elegir`: muestra la pantalla de los 5 botones (informe nuevo); `informe`: el que se está armando. */
export default function InformePlantilla({ informe, elegir, alElegir, abierto, onCerrar, paso, setPaso, setCampo, reemplazar, guardado, alGuardar: guardarSinPreguntar, guardando, alCambiarTipo, alNuevo = null }) {
  const alGuardar = async () => {
    if (await confirmar({ titulo: "¿Guardar el informe?", texto: "Se crea la tarjeta en la pila de informes. Después lo podés seguir editando.", confirmar: "Guardar" })) guardarSinPreguntar();
  };
  const b = informe?.borrador;
  const pasos = useMemo(() => (b ? pasosDe(b) : []), [b?.boton]); // eslint-disable-line react-hooks/exhaustive-deps
  const cuerpo = useRef(null);
  const problemas = useMemo(() => (b ? problemasV2(b) : []), [b]);
  useEffect(() => { cuerpo.current?.scrollTo({ top: 0 }); }, [paso, informe?.id, elegir]);
  const clases = `ens-cajon ens-cajon--ancho${abierto ? " ens-cajon--abierto" : ""}`;
  const inerte = abierto ? {} : { inert: "" };

  if (elegir || !b) {
    return <aside id="ens-cajon" className={clases} aria-label="Informe de pronóstico" {...inerte}>
      <header className="ens-cajon-cab"><div><h2>Informe nuevo</h2><p>¿Cuál vas a armar?</p></div><div className="ens-cajon-acciones"><button type="button" className="btn-link" onClick={onCerrar}>Ocultar</button></div></header>
      <div className="ens-cajon-cuerpo" ref={cuerpo}><div className="paso"><h3 className="ens-cajon-titulo">Tipo de informe</h3><Elegir alElegir={alElegir} /></div></div>
    </aside>;
  }

  const p = pasos[Math.min(paso, pasos.length - 1)], ultimo = paso === pasos.length - 1, esNuevo = informe.id == null;
  async function vaciar() {
    if (await confirmar({ titulo: "¿Vaciar este informe?", texto: "Se borra todo lo escrito en este informe.", confirmar: "Vaciar", peligro: true })) { reemplazar(borradorNuevo(b.boton, b.fecha)); setPaso(0); }
  }
  const contenido = p.id === "datos" ? <PasoDatos b={b} set={setCampo} />
    : p.id.startsWith("dia") ? <PasoDia b={b} i={p.i} set={setCampo} />
    : p.id.startsWith("ciu") ? <PasoCiudades b={b} i={p.i} set={setCampo} />
    : <PasoRevision b={b} problemas={problemas} esNuevo={esNuevo} alGuardar={alGuardar} guardando={guardando} />;
  const textoGuardado = esNuevo ? "Sin guardar: la tarjeta aparece cuando lo guardes, en el último paso" : guardado?.estado === "error" ? `No se pudo guardar: ${guardado.error}` : guardado?.estado === "guardando" ? "Guardando…" : guardado?.hora ? `Guardado ${guardado.hora}` : "Guardado";

  return <aside id="ens-cajon" className={clases} aria-label="Informe de pronóstico" {...inerte}>
    <header className="ens-cajon-cab">
      <div><h2>{esNuevo ? "Informe nuevo" : `Informe #${informe.id}`} · {nombreDeBoton(b.boton)}</h2><p className={!esNuevo && guardado?.estado === "error" ? "pron-guardado--error" : undefined} role="status">{fechaDia(b.dias[0].fecha)} · {textoGuardado}</p></div>
      <div className="ens-cajon-acciones">{esNuevo && <button type="button" className="btn-link" onClick={alCambiarTipo}>Cambiar tipo</button>}{alNuevo && !esNuevo && <button type="button" className="btn-link" onClick={alNuevo}>Informe nuevo</button>}<button type="button" className="btn-link" onClick={vaciar}>Vaciar</button><button type="button" className="btn-link" onClick={onCerrar}>Ocultar</button></div>
    </header>
    <div className="ens-cajon-cuerpo" ref={cuerpo}>
      <div className="paso-cabecera"><div className="paso-barra" role="progressbar" aria-label="Progreso" aria-valuemin={0} aria-valuemax={pasos.length} aria-valuenow={paso + 1}><i style={{ "--desde": `${(paso / pasos.length) * 100}%`, "--p": `${((paso + 1) / pasos.length) * 100}%` }} /></div>
        <span className="paso-contador">Paso {paso + 1} de {pasos.length}</span></div>
      <div className="paso" key={p.id}><h3 className="ens-cajon-titulo">{p.titulo}</h3>{contenido}</div>
    </div>
    <footer className="ens-cajon-pie">
      <button type="button" className="btn btn--ghost" disabled={paso === 0} onClick={() => setPaso(paso - 1)}><Icono icono={ChevronLeft} size={16} /> Atrás</button>
      {!ultimo && <button type="button" className="btn btn--primary" onClick={() => setPaso(paso + 1)}>Siguiente <Icono icono={ChevronRight} size={16} /></button>}
      {ultimo && esNuevo && <button type="button" className="btn btn--primary" disabled={guardando} onClick={alGuardar}>{guardando ? "Guardando…" : "Guardar informe"}</button>}
    </footer>
  </aside>;
}
