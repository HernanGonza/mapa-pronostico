import { useCallback, useEffect, useMemo, useState } from "react";
import BrandHeader from "../components/BrandHeader";
import VolverConfiguracion from "../components/VolverConfiguracion";
import CampoArchivos from "../components/CampoArchivos";
import * as api from "../api";
import { confirmar, notificar } from "../lib/ui";
import "./informeMensual.css";

/**
 * Informe mensual (módulo «Informe mensual»): el «Balance hidrometeorológico del mes» de la DGAT, cargado todo a mano (todavía no hay datos
 * suficientes, ordenados y validados para calcular las medias solas). Sigue el modelo .docx: valores medios por estación, resumen del mes,
 * pronóstico climático trimestral (mapas + análisis) y fenómeno del Niño (mapas + análisis). Sale en PDF con el formato de la previsión del tiempo.
 * Cada sección dice en qué lugar del PDF queda, con un esquema de la hoja.
 */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const ESTACIONES = ["Posadas", "Valle Hermoso", "San Pedro", "Andresito", "Campo Grande"];
const COLUMNAS = [
  { campo: "tmedia", titulo: "Temperatura media (°C)", corto: "T. media", unidad: "°C", entero: false },
  { campo: "tmin", titulo: "Temperatura mínima media (°C)", corto: "T. mínima media", unidad: "°C", entero: false },
  { campo: "tmax", titulo: "Temperatura máxima media (°C)", corto: "T. máxima media", unidad: "°C", entero: false },
  { campo: "eventos", titulo: "Eventos hidrometeorológicos (N°)", corto: "Eventos (N°)", unidad: "N°", entero: true },
  { campo: "precipitacion", titulo: "Precipitación acumulada (mm)", corto: "Precipitación (mm)", unidad: "mm", entero: false },
];
const LIMITE_TEXTO = 8000;
const RE_NUMERO = /^-?\d+([.,]\d+)?$/;

const estacionVacia = (estacion = "") => ({ oculta: false, estacion, tmedia: "", tmin: "", tmax: "", eventos: "", precipitacion: "" });
const borradorNuevo = (anio, mes) => ({ version: 1, anio, mes, columnasOcultas: [], estaciones: ESTACIONES.map(estacionVacia), resumen: "", trimestral: { imagenes: [], texto: "" }, nino: { imagenes: [], texto: "" } });
/** Lo que está mal de una celda (o ""): número con coma o punto; los eventos, entero; la lluvia, sin signo. */
function problemaCelda(col, valor) {
  const v = String(valor ?? "").trim();
  if (!v) return "";
  if (!RE_NUMERO.test(v)) return "Tiene que ser un número (ej.: 24,5)";
  if (col.entero && !/^\d+$/.test(v)) return "Tiene que ser un número entero";
  if (col.campo === "precipitacion" && v.startsWith("-")) return "No puede ser negativa";
  return "";
}

// --- esquema de la hoja: dónde queda cada cosa en el PDF --------------------------------------------------------------
const BLOQUES = [
  { id: "titulo", etiqueta: "Título del informe", alto: 7 },
  { id: "valores", etiqueta: "Valores medios del mes", alto: 17 },
  { id: "resumen", etiqueta: "Resumen del mes", alto: 14 },
  { id: "trimestral", etiqueta: "Mapas trimestrales + análisis", alto: 24, imagen: true },
  { id: "nino", etiqueta: "Mapas del Niño + análisis", alto: 24, imagen: true },
];
/** Una hoja en miniatura con los bloques en el orden del PDF; el de esta sección va resaltado (y la imagen, rayada). */
function EsquemaHoja({ activo }) {
  return <figure className="im-esquema" aria-label={`Esquema del PDF: esta sección es «${BLOQUES.find((b) => b.id === activo)?.etiqueta}»`}>
    <div className="im-hoja" aria-hidden="true">
      {BLOQUES.map((b) => <div key={b.id} className={`im-bloque${b.id === activo ? " im-bloque--activo" : ""}`} style={{ flex: b.alto }}>
        {b.imagen && <span className="im-bloque-imagen" />}<span className="im-bloque-texto" />
      </div>)}
    </div>
    <figcaption>Lugar en el PDF (de arriba hacia abajo)</figcaption>
  </figure>;
}

/** Baja la imagen a un tamaño razonable (máx. 1500 px de ancho) y la devuelve como data URL PNG o JPG, para que el informe no pese de más. */
async function procesarImagen(archivo) {
  if (!/^image\/(png|jpeg)$/.test(archivo.type)) throw new Error("La imagen tiene que ser PNG o JPG.");
  if (archivo.size > 20 * 1024 * 1024) throw new Error("La imagen es demasiado grande (más de 20 MB).");
  const bmp = await createImageBitmap(archivo);
  const k = Math.min(1, 1500 / bmp.width), c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  let url = archivo.type === "image/png" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.9);
  if (url.length > 3_400_000) url = c.toDataURL("image/jpeg", 0.88);
  if (url.length > 4_600_000) throw new Error("La imagen sigue siendo muy pesada: usá una más chica.");
  return url;
}

const MAX_IMAGENES = 6;
/** Varias imágenes en línea: se agregan, se reordenan con las flechas y se quitan. En el PDF van en una sola fila y se ajustan solas al ancho. */
function CampoImagenes({ valor, onChange, descripcion }) {
  const [error, setError] = useState(""), [leyendo, setLeyendo] = useState(false), [razones, setRazones] = useState({}); // ancho/alto de cada imagen, para que la vista previa las ajuste como el PDF
  async function elegir(e) {
    const archivos = (e.target.files || []).slice(0, MAX_IMAGENES - valor.length);
    if (!archivos.length) { if (e.target.files?.length) setError(`Entran hasta ${MAX_IMAGENES} imágenes: quitá alguna para agregar otra.`); return; }
    setLeyendo(true); setError("");
    try { const nuevas = []; for (const a of archivos) nuevas.push(await procesarImagen(a)); onChange([...valor, ...nuevas]); if ((e.target.files || []).length > archivos.length) setError(`Se agregaron ${archivos.length}: el máximo es ${MAX_IMAGENES}.`); }
    catch (err) { setError(err.message || "No se pudo leer la imagen."); }
    finally { setLeyendo(false); }
  }
  const mover = (i, d) => { const n = [...valor]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
  return <div className="im-imagen">
    {valor.length > 0 && <>
      <p className="im-ayuda-fila">Así van en el PDF: todas en una fila, del mismo alto, ajustadas al ancho de la hoja.</p>
      <ol className="im-fila-imagenes" aria-label={`Imágenes: ${descripcion}`}>
        {valor.map((src, i) => <li key={`${i}:${src.length}`} style={{ flexGrow: razones[`${i}:${src.length}`] || 1.5 }}>
          <img onLoad={(e) => { const razon = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight; setRazones((r) => ({ ...r, [`${i}:${src.length}`]: razon })); }} src={src} alt={`${descripcion}, imagen ${i + 1} de ${valor.length}`} />
          <div className="im-fila-acciones">
            <button type="button" className="im-btn im-btn--chico" disabled={i === 0} onClick={() => mover(i, -1)} aria-label={`Mover la imagen ${i + 1} a la izquierda`}>←</button>
            <button type="button" className="im-btn im-btn--chico" disabled={i === valor.length - 1} onClick={() => mover(i, 1)} aria-label={`Mover la imagen ${i + 1} a la derecha`}>→</button>
            <button type="button" className="im-btn im-btn--chico im-btn--peligro" onClick={() => onChange(valor.filter((_, k) => k !== i))} aria-label={`Quitar la imagen ${i + 1}`}>Quitar</button>
          </div>
        </li>)}
      </ol>
    </>}
    {valor.length < MAX_IMAGENES
      ? <CampoArchivos label={valor.length ? "Agregar más imágenes" : "Subir imágenes"} ayuda={`PNG o JPG, hasta ${MAX_IMAGENES} (podés elegir varias juntas). Se achican solas si son muy grandes.`} accept="image/png,image/jpeg" multiple limpiarAlElegir onChange={elegir} />
      : <p className="im-ayuda-fila">Llegaste al máximo de {MAX_IMAGENES} imágenes.</p>}
    {leyendo && <p className="im-ayuda-fila" role="status">Leyendo imágenes…</p>}
    {error && <p className="im-error" role="alert">{error}</p>}
  </div>;
}

function CampoTexto({ id, rotulo, ayuda, valor, onChange, filas = 6 }) {
  return <label className="im-campo" htmlFor={id}>
    <span>{rotulo}</span>
    <textarea id={id} rows={filas} value={valor} maxLength={LIMITE_TEXTO} onChange={(e) => onChange(e.target.value)} />
    <small>{ayuda ? `${ayuda} · ` : ""}{valor.length} / {LIMITE_TEXTO}</small>
  </label>;
}

const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export default function InformeMensualPage() {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear()), [mes, setMes] = useState(hoy.getMonth() === 0 ? 12 : hoy.getMonth()); // por defecto, el mes que acaba de terminar
  const [anioMes, setAnioMes] = useState(null); // el que está cargado en pantalla (cambia recién cuando termina de cargar)
  const [b, setB] = useState(null), [guardado, setGuardado] = useState(null); // `guardado`: { actualizadoEn, actualizadoPor } del informe de este mes, o null
  const [sucio, setSucio] = useState(false), [lista, setLista] = useState([]);
  const [error, setError] = useState(""), [ocupado, setOcupado] = useState("");

  const refrescarLista = useCallback(() => api.listarInformesMensuales().then(setLista).catch(() => {}), []);
  useEffect(() => { refrescarLista(); }, [refrescarLista]);

  const cargar = useCallback(async (a, m) => {
    setError("");
    try {
      const r = await api.getInformeMensual(a, m);
      const sec = (x) => ({ imagenes: Array.isArray(x?.imagenes) ? x.imagenes : x?.imagen ? [x.imagen] : [], texto: x?.texto || "" }); // los guardados antes traían una sola imagen
      setB(r ? { ...borradorNuevo(a, m), ...r.borrador, columnasOcultas: r.borrador.columnasOcultas || [], trimestral: sec(r.borrador.trimestral), nino: sec(r.borrador.nino), anio: a, mes: m } : borradorNuevo(a, m));
      setGuardado(r ? { actualizadoEn: r.actualizadoEn, actualizadoPor: r.actualizadoPor } : null);
      setSucio(false); setAnioMes(`${a}-${m}`);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(anio, mes); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sucio) return undefined;
    const aviso = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sucio]);

  /** Cambia de mes (con aviso si hay cambios sin guardar). */
  async function irA(a, m) {
    if (`${a}-${m}` === anioMes) { setAnio(a); setMes(m); return; }
    if (sucio && !(await confirmar({ titulo: "Cambios sin guardar", texto: `Hay cambios sin guardar en el informe de ${MESES[(b?.mes ?? m) - 1]} de ${b?.anio}. Si cambiás de mes se pierden.`, confirmar: "Descartar y cambiar", peligro: true }))) return;
    setAnio(a); setMes(m); await cargar(a, m);
  }

  const cambiar = (f) => { setB((x) => f(x)); setSucio(true); };
  const ponerCelda = (i, campo, v) => cambiar((x) => ({ ...x, estaciones: x.estaciones.map((e, k) => (k === i ? { ...e, [campo]: v } : e)) }));
  const ponerSeccion = (clave, campo, v) => cambiar((x) => ({ ...x, [clave]: { ...x[clave], [campo]: v } }));

  const problemas = useMemo(() => {
    if (!b) return [];
    const p = [];
    b.estaciones.forEach((e) => COLUMNAS.filter((c) => !b.columnasOcultas.includes(c.campo)).forEach((c) => { const t = problemaCelda(c, e[c.campo]); if (t) p.push(`${e.estacion || "Estación"} · ${c.corto}: ${t.toLowerCase()}`); }));
    return p;
  }, [b]);
  const faltantes = useMemo(() => {
    if (!b) return [];
    const f = [];
    const vacias = b.estaciones.filter((e) => !e.oculta).reduce((n, e) => n + COLUMNAS.filter((c) => !b.columnasOcultas.includes(c.campo)).filter((c) => !String(e[c.campo] ?? "").trim()).length, 0);
    if (vacias) f.push(`${vacias} ${vacias === 1 ? "celda" : "celdas"} de la tabla sin completar`);
    if (!b.resumen.trim()) f.push("el resumen del mes");
    if (!b.trimestral.imagenes.length) f.push("los mapas del pronóstico trimestral");
    if (!b.trimestral.texto.trim()) f.push("el análisis del pronóstico trimestral");
    if (!b.nino.imagenes.length) f.push("los mapas del fenómeno del Niño");
    if (!b.nino.texto.trim()) f.push("el texto del fenómeno del Niño");
    return f;
  }, [b]);

  async function guardar() {
    if (problemas.length) { setError("Corregí los valores marcados en rojo antes de guardar."); return; }
    setOcupado("guardar"); setError("");
    try {
      const r = await api.guardarInformeMensual(b.anio, b.mes, b);
      setGuardado({ actualizadoEn: r.actualizadoEn, actualizadoPor: r.actualizadoPor }); setSucio(false); refrescarLista();
      notificar("success", "Informe guardado.");
    } catch (e) { setError(e.message); }
    finally { setOcupado(""); }
  }
  async function pdf(descargar) {
    if (problemas.length) { setError("Corregí los valores marcados en rojo para armar el PDF."); return; }
    setOcupado(descargar ? "descargar" : "ver"); setError("");
    // La pestaña se abre ya (con el clic) y se completa cuando está el PDF, para que el navegador no la bloquee.
    const pestana = descargar ? null : window.open("", "_blank");
    try {
      const url = URL.createObjectURL(await api.generarInformeMensualPdf(b));
      if (descargar) { const a = document.createElement("a"); a.href = url; a.download = `BALANCE ${MESES[b.mes - 1].toUpperCase()} ${b.anio}.pdf`; a.click(); }
      else if (pestana) pestana.location.href = url; else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) { pestana?.close(); setError(e.message); }
    finally { setOcupado(""); }
  }
  /** Cancela lo que se está armando: descarta los cambios y vuelve a lo último guardado (o a un informe en blanco si nunca se guardó). */
  async function descartar() {
    const aviso = guardado ? "Se pierden los cambios hechos desde el último guardado y el informe vuelve a como estaba." : "Se pierde todo lo que cargaste (tabla, textos e imágenes) y el informe queda en blanco.";
    if (!(await confirmar({ titulo: "Descartar el informe", texto: `${aviso} No se puede deshacer.`, confirmar: "Descartar", cancelar: "Seguir editando", peligro: true }))) return;
    await cargar(b.anio, b.mes);
    notificar("info", guardado ? "Se descartaron los cambios." : "Informe descartado.");
  }
  async function borrar() {
    if (!(await confirmar({ titulo: "Borrar el informe guardado", texto: `Se borra el informe de ${MESES[b.mes - 1]} de ${b.anio} (con sus imágenes). No se puede deshacer.`, confirmar: "Borrar", peligro: true }))) return;
    try { await api.borrarInformeMensual(b.anio, b.mes); await cargar(b.anio, b.mes); refrescarLista(); notificar("success", "Informe borrado."); } catch (e) { setError(e.message); }
  }

  const anios = useMemo(() => Array.from({ length: 8 }, (_, i) => hoy.getFullYear() + 1 - i), []); // eslint-disable-line react-hooks/exhaustive-deps
  const columnasVisibles = b ? COLUMNAS.filter((c) => !b.columnasOcultas.includes(c.campo)) : COLUMNAS;
  const alternarColumna = (campo) => cambiar((x) => ({ ...x, columnasOcultas: x.columnasOcultas.includes(campo) ? x.columnasOcultas.filter((c) => c !== campo) : [...x.columnasOcultas, campo] }));
  const celdaMala = (c, e) => !!problemaCelda(c, e[c.campo]);

  return <div className="admin-layout admin-layout--sin-mapa">
    <BrandHeader subtitulo="Informe mensual"><VolverConfiguracion /></BrandHeader>
    <div className="admin-panel im-pagina" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading">
        <h1>Informe mensual</h1>
        <p>Balance hidrometeorológico del mes. Por ahora se carga todo a mano: los valores medios todavía no se calculan solos. Cada sección muestra en qué lugar del PDF queda.</p>
      </div>

      <div className="im-barra">
        <label className="im-select"><span>Mes</span>
          <select value={mes} onChange={(e) => irA(anio, Number(e.target.value))}>{MESES.map((m, i) => <option key={m} value={i + 1}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}</select></label>
        <label className="im-select"><span>Año</span>
          <select value={anio} onChange={(e) => irA(Number(e.target.value), mes)}>{anios.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
        <p className="im-estado" role="status">
          {!b ? "Cargando…" : sucio ? <strong>Cambios sin guardar</strong> : guardado ? <>Guardado el <strong>{fechaHora(guardado.actualizadoEn)} h</strong>{guardado.actualizadoPor ? ` · ${guardado.actualizadoPor}` : ""}</> : "Informe nuevo, todavía sin guardar"}
        </p>
      </div>
      {lista.length > 0 && <div className="im-guardados" aria-label="Informes guardados">
        <span>Guardados:</span>
        {lista.map((i) => <button key={`${i.anio}-${i.mes}`} type="button" className={`im-chip${i.anio === b?.anio && i.mes === b?.mes ? " im-chip--on" : ""}`} onClick={() => irA(i.anio, i.mes)}>{MESES[i.mes - 1]} {i.anio}</button>)}
      </div>}

      {error && <div className="alert alert--error" role="alert">{error}</div>}

      {b && <>
        <section className="im-seccion" aria-labelledby="im-s0">
          <EsquemaHoja activo="titulo" />
          <div className="im-seccion-cuerpo">
            <h2 id="im-s0">Título</h2>
            <p className="im-ubicacion">Arriba de todo, con los logos y la dirección: se arma solo con el mes y el año elegidos.</p>
            <p className="im-titulo-vista">BALANCE HIDROMETEOROLÓGICO DEL MES DE {MESES[b.mes - 1].toUpperCase()} DE {b.anio}</p>
          </div>
        </section>

        <section className="im-seccion" aria-labelledby="im-s1">
          <EsquemaHoja activo="valores" />
          <div className="im-seccion-cuerpo">
            <h2 id="im-s1">Valores medios del mes</h2>
            <p className="im-ubicacion">Tabla debajo del título, una fila por estación. Los números con coma o punto (24,5); los eventos, enteros.</p>
            <fieldset className="im-columnas">
              <legend>Columnas que salen en el PDF</legend>
              {COLUMNAS.map((c) => <label key={c.campo}><input type="checkbox" checked={!b.columnasOcultas.includes(c.campo)} onChange={() => alternarColumna(c.campo)} /> {c.corto}</label>)}
            </fieldset>
            <div className="im-tabla-envoltorio">
              <table className="im-tabla">
                <thead><tr><th scope="col">Estación</th>{columnasVisibles.map((c) => <th scope="col" key={c.campo}>{c.titulo}</th>)}<th><span className="im-sr">Mostrar u ocultar</span></th><th><span className="im-sr">Quitar</span></th></tr></thead>
                <tbody>
                  {b.estaciones.map((e, i) => <tr key={i} className={e.oculta ? "im-fila-oculta" : ""}>
                    <th scope="row"><input type="text" aria-label={`Nombre de la estación ${i + 1}`} value={e.estacion} maxLength={60} onChange={(ev) => ponerCelda(i, "estacion", ev.target.value)} /></th>
                    {columnasVisibles.map((c) => <td key={c.campo}><input type="text" inputMode="decimal" aria-label={`${e.estacion || "Estación"}: ${c.titulo}`} aria-invalid={celdaMala(c, e) || undefined} title={problemaCelda(c, e[c.campo]) || undefined}
                      className={celdaMala(c, e) ? "im-malo" : ""} value={e[c.campo]} maxLength={12} onChange={(ev) => ponerCelda(i, c.campo, ev.target.value)} /></td>)}
                    <td><button type="button" className="im-btn im-btn--chico" aria-pressed={!!e.oculta} title={e.oculta ? "Oculta: no sale en el PDF. Tocá para mostrarla" : "Ocultar esta fila del PDF"} aria-label={`${e.oculta ? "Mostrar" : "Ocultar"} ${e.estacion || "la estación"} en el PDF`} onClick={() => ponerCelda(i, "oculta", !e.oculta)}>{e.oculta ? "Mostrar" : "Ocultar"}</button></td>
                    <td><button type="button" className="im-btn im-btn--chico" aria-label={`Quitar ${e.estacion || "la estación"}`} onClick={() => cambiar((x) => ({ ...x, estaciones: x.estaciones.filter((_, k) => k !== i) }))}>✕</button></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            <div className="im-acciones-tabla">
              <button type="button" className="im-btn" disabled={b.estaciones.length >= 20} onClick={() => cambiar((x) => ({ ...x, estaciones: [...x.estaciones, estacionVacia()] }))}>+ Agregar estación</button>
              <small>Referencias que salen debajo de la tabla: ° C Grados Celsius · N° Número de eventos · mm Milímetros de precipitación.</small>
            </div>
          </div>
        </section>

        <section className="im-seccion" aria-labelledby="im-s2">
          <EsquemaHoja activo="resumen" />
          <div className="im-seccion-cuerpo">
            <h2 id="im-s2">Resumen meteorológico del mes</h2>
            <p className="im-ubicacion">Texto libre, debajo de la tabla de valores medios. Un renglón nuevo arma un párrafo nuevo.</p>
            <CampoTexto id="im-resumen" rotulo="Resumen" valor={b.resumen} onChange={(v) => cambiar((x) => ({ ...x, resumen: v }))} filas={9} />
          </div>
        </section>

        <section className="im-seccion" aria-labelledby="im-s3">
          <EsquemaHoja activo="trimestral" />
          <div className="im-seccion-cuerpo">
            <h2 id="im-s3">Pronóstico climático trimestral</h2>
            <p className="im-ubicacion">Primero los mapas (precipitación y temperatura del trimestre; podés subir varios, van en una fila) y debajo el texto de análisis, bajo la barra «Pronóstico climático trimestral».</p>
            <CampoImagenes valor={b.trimestral.imagenes} descripcion="Mapas del pronóstico climático trimestral" onChange={(v) => ponerSeccion("trimestral", "imagenes", v)} />
            <CampoTexto id="im-trim" rotulo="Análisis de los mapas" valor={b.trimestral.texto} onChange={(v) => ponerSeccion("trimestral", "texto", v)} />
          </div>
        </section>

        <section className="im-seccion" aria-labelledby="im-s4">
          <EsquemaHoja activo="nino" />
          <div className="im-seccion-cuerpo">
            <h2 id="im-s4">Estado actual y proyección del fenómeno del Niño</h2>
            <p className="im-ubicacion">Al final: los mapas del fenómeno (varios, en una fila) y debajo su texto, bajo la barra «Estado actual y proyección del fenómeno del Niño».</p>
            <CampoImagenes valor={b.nino.imagenes} descripcion="Mapas del fenómeno del Niño" onChange={(v) => ponerSeccion("nino", "imagenes", v)} />
            <CampoTexto id="im-nino" rotulo="Texto del fenómeno del Niño" valor={b.nino.texto} onChange={(v) => ponerSeccion("nino", "texto", v)} />
          </div>
        </section>

        <div className="im-pie" role="region" aria-label="Acciones del informe">
          <div className="im-pie-estado">
            {problemas.length > 0 && <p className="im-error" role="alert">Hay valores que no son válidos: {problemas.slice(0, 3).join("; ")}{problemas.length > 3 ? ` y ${problemas.length - 3} más` : ""}.</p>}
            {faltantes.length > 0 && <p className="im-faltan">Todavía falta: {faltantes.join(", ")}. El PDF se puede bajar igual, incompleto.</p>}
          </div>
          <div className="im-pie-botones">
            <button type="button" className="im-btn" disabled={!!ocupado || !sucio} onClick={descartar}
              title={sucio ? "Descarta lo que cargaste desde el último guardado" : "No hay cambios para descartar"}>Cancelar y descartar</button>
            {guardado && <button type="button" className="im-btn im-btn--peligro" onClick={borrar} title="Borra el informe guardado de este mes">Borrar guardado</button>}
            <button type="button" className="im-btn" disabled={!!ocupado} onClick={() => pdf(false)}>{ocupado === "ver" ? "Armando…" : "Ver PDF"}</button>
            <button type="button" className="im-btn" disabled={!!ocupado} onClick={() => pdf(true)}>{ocupado === "descargar" ? "Armando…" : "Descargar PDF"}</button>
            <button type="button" className="im-btn im-btn--primario" disabled={!!ocupado || !sucio && !!guardado} onClick={guardar}>{ocupado === "guardar" ? "Guardando…" : "Guardar informe"}</button>
          </div>
        </div>
      </>}
    </div>
  </div>;
}
