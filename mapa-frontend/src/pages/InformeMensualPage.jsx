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
const pad = (n) => String(n).padStart(2, "0");
const isoDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return isoDe(d); };
const lunesPasado = () => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); return isoDe(d); }; // el lunes de la semana que acaba de terminar
const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
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
const borradorNuevo = (per, tipo) => ({ version: 1, ...(tipo === "semanal" ? { tipo: "semanal" } : {}), ...per, titulo: "", subtitulo: "", rotulos: {}, columnasOcultas: [], estaciones: ESTACIONES.map(estacionVacia), resumen: "", trimestral: { imagenes: [], texto: "" }, nino: { imagenes: [], texto: "" } });
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


const ROTULOS_BASE = {
  mensual: { valores: "Valores medios del mes", resumen: "Resumen meteorológico del mes", trimestral: "Pronóstico climático trimestral", nino: "Estado actual y proyección del fenómeno del Niño" },
  semanal: { valores: "Valores medios de la semana", resumen: "Resumen meteorológico de la semana", trimestral: "Pronóstico climático trimestral", nino: "Estado actual y proyección del fenómeno del Niño" },
};
const API = {
  mensual: { listar: api.listarInformesMensuales, obtener: (p) => api.getInformeMensual(p.anio, p.mes), guardar: (b) => api.guardarInformeMensual(b.anio, b.mes, b), borrar: (b) => api.borrarInformeMensual(b.anio, b.mes) },
  semanal: { listar: api.listarInformesSemanales, obtener: (p) => api.getInformeSemanal(p.desde), guardar: (b) => api.guardarInformeSemanal(b.desde, b), borrar: (b) => api.borrarInformeSemanal(b.desde) },
};
const claveDe = (p) => (p.desde ? `${p.desde}|${p.hasta}` : `${p.anio}-${p.mes}`);
const nombreArchivo = (b) => (b.tipo === "semanal" ? `BALANCE SEMANA ${b.desde}` : `BALANCE ${MESES[b.mes - 1].toUpperCase()} ${b.anio}`);
const etiquetaPeriodo = (p) => (p.desde ? `${dm(p.desde)} al ${dm(p.hasta)} de ${p.hasta.slice(0, 4)}` : `${MESES[p.mes - 1]} de ${p.anio}`);

/** Un título que se puede cambiar (informe semanal): vacío = el de siempre. */
function CampoRotulo({ id, valor, base, onChange, rotulo = "Título de esta sección" }) {
  return <label className="im-campo im-campo--rotulo" htmlFor={id}>
    <span>{rotulo}</span>
    <input id={id} type="text" maxLength={160} value={valor || ""} placeholder={base} onChange={(e) => onChange(e.target.value)} />
  </label>;
}

/** El informe del mes (`tipo` «mensual») o de la semana (`tipo` «semanal»: mismas partes, con todos los títulos editables). */
function PanelInforme({ tipo }) {
  const semanal = tipo === "semanal", api_ = API[tipo], base = ROTULOS_BASE[tipo];
  const hoy = new Date();
  const [per, setPer] = useState(() => (semanal ? { desde: lunesPasado(), hasta: sumarDias(lunesPasado(), 6) } : { anio: hoy.getFullYear(), mes: hoy.getMonth() === 0 ? 12 : hoy.getMonth() })); // por defecto, el mes / la semana que acaba de terminar
  const [cargado, setCargado] = useState(null); // el período que está en pantalla (cambia recién cuando termina de cargar)
  const [b, setB] = useState(null), [guardado, setGuardado] = useState(null); // `guardado`: { actualizadoEn, actualizadoPor } del informe de este período, o null
  const [sucio, setSucio] = useState(false), [lista, setLista] = useState([]);
  const [error, setError] = useState(""), [ocupado, setOcupado] = useState("");

  const refrescarLista = useCallback(() => api_.listar().then(setLista).catch(() => {}), [api_]);
  useEffect(() => { refrescarLista(); }, [refrescarLista]);

  const cargar = useCallback(async (p) => {
    setError("");
    try {
      const r = await api_.obtener(p);
      const sec = (x) => ({ imagenes: Array.isArray(x?.imagenes) ? x.imagenes : x?.imagen ? [x.imagen] : [], texto: x?.texto || "" }); // los guardados antes traían una sola imagen
      setB(r ? { ...borradorNuevo(p, tipo), ...r.borrador, columnasOcultas: r.borrador.columnasOcultas || [], titulo: r.borrador.titulo || "", subtitulo: r.borrador.subtitulo || "", rotulos: r.borrador.rotulos || {}, trimestral: sec(r.borrador.trimestral), nino: sec(r.borrador.nino), ...p } : borradorNuevo(p, tipo));
      setGuardado(r ? { actualizadoEn: r.actualizadoEn, actualizadoPor: r.actualizadoPor } : null);
      setSucio(false); setCargado(claveDe(p));
    } catch (e) { setError(e.message); }
  }, [api_, tipo]);
  useEffect(() => { cargar(per); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sucio) return undefined;
    const aviso = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sucio]);

  /** Cambia de período (con aviso si hay cambios sin guardar). */
  async function irA(p) {
    if (claveDe(p) === cargado) { setPer(p); return; }
    if (sucio && !(await confirmar({ titulo: "Cambios sin guardar", texto: `Hay cambios sin guardar en el informe de ${b ? etiquetaPeriodo(b) : "este período"}. Si cambiás se pierden.`, confirmar: "Descartar y cambiar", peligro: true }))) return;
    setPer(p); await cargar(p);
  }
  /** Semanal: la fecha de inicio manda el fin (a 6 días) salvo que se haya elegido otro. */
  const elegirDesde = (v) => { if (v) irA({ desde: v, hasta: sumarDias(v, 6) }); };
  const elegirHasta = (v) => { if (v && v >= per.desde && v <= sumarDias(per.desde, 30)) irA({ desde: per.desde, hasta: v }); };

  const cambiar = (f) => { setB((x) => f(x)); setSucio(true); };
  const ponerCelda = (i, campo, v) => cambiar((x) => ({ ...x, estaciones: x.estaciones.map((e, k) => (k === i ? { ...e, [campo]: v } : e)) }));
  const ponerSeccion = (clave, campo, v) => cambiar((x) => ({ ...x, [clave]: { ...x[clave], [campo]: v } }));
  const ponerRotulo = (clave, v) => cambiar((x) => ({ ...x, rotulos: { ...x.rotulos, [clave]: v } }));
  const R = (clave, defecto) => (b?.rotulos?.[clave] || "").trim() || defecto; // el título con el que sale

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
    if (!b.resumen.trim()) f.push(semanal ? "el resumen de la semana" : "el resumen del mes");
    if (!b.trimestral.imagenes.length) f.push("los mapas del pronóstico trimestral");
    if (!b.trimestral.texto.trim()) f.push("el análisis del pronóstico trimestral");
    if (!b.nino.imagenes.length) f.push("los mapas del fenómeno del Niño");
    if (!b.nino.texto.trim()) f.push("el texto del fenómeno del Niño");
    return f;
  }, [b, semanal]);

  async function guardar() {
    if (problemas.length) { setError("Corregí los valores marcados en rojo antes de guardar."); return; }
    setOcupado("guardar"); setError("");
    try {
      const r = await api_.guardar(b);
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
      if (descargar) { const a = document.createElement("a"); a.href = url; a.download = `${nombreArchivo(b)}.pdf`; a.click(); }
      else if (pestana) pestana.location.href = url; else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) { pestana?.close(); setError(e.message); }
    finally { setOcupado(""); }
  }
  /** Cancela lo que se está armando: descarta los cambios y vuelve a lo último guardado (o a un informe en blanco si nunca se guardó). */
  async function descartar() {
    const aviso = guardado ? "Se pierden los cambios hechos desde el último guardado y el informe vuelve a como estaba." : "Se pierde todo lo que cargaste (tabla, textos e imágenes) y el informe queda en blanco.";
    if (!(await confirmar({ titulo: "Descartar el informe", texto: `${aviso} No se puede deshacer.`, confirmar: "Descartar", cancelar: "Seguir editando", peligro: true }))) return;
    await cargar(per);
    notificar("info", guardado ? "Se descartaron los cambios." : "Informe descartado.");
  }
  async function borrar() {
    if (!(await confirmar({ titulo: "Borrar el informe guardado", texto: `Se borra el informe de ${etiquetaPeriodo(b)} (con sus imágenes). No se puede deshacer.`, confirmar: "Borrar", peligro: true }))) return;
    try { await api_.borrar(b); await cargar(per); refrescarLista(); notificar("success", "Informe borrado."); } catch (e) { setError(e.message); }
  }

  const anios = useMemo(() => Array.from({ length: 8 }, (_, i) => hoy.getFullYear() + 1 - i), []); // eslint-disable-line react-hooks/exhaustive-deps
  const celdaMala = (c, e) => !!problemaCelda(c, e[c.campo]);
  const columnasVisibles = b ? COLUMNAS.filter((c) => !b.columnasOcultas.includes(c.campo)) : COLUMNAS;
  const alternarColumna = (campo) => cambiar((x) => ({ ...x, columnasOcultas: x.columnasOcultas.includes(campo) ? x.columnasOcultas.filter((c) => c !== campo) : [...x.columnasOcultas, campo] }));
  const id = (n) => `im-${tipo}-${n}`;
  const subtituloBase = semanal ? `DE LA SEMANA DEL ${per.desde ? dm(per.desde) : ""} AL ${per.hasta ? dm(per.hasta) : ""} DE ${(per.hasta || "").slice(0, 4)}` : `DEL MES DE ${MESES[(b?.mes || per.mes) - 1].toUpperCase()} DE ${b?.anio || per.anio}`;

  return <>
    <div className="im-barra">
      {semanal ? <>
        <label className="im-select"><span>La semana empieza el</span><input type="date" value={per.desde} onChange={(e) => elegirDesde(e.target.value)} /></label>
        <label className="im-select"><span>y termina el</span><input type="date" value={per.hasta} min={per.desde} max={sumarDias(per.desde, 30)} onChange={(e) => elegirHasta(e.target.value)} /></label>
      </> : <>
        <label className="im-select"><span>Mes</span>
          <select value={per.mes} onChange={(e) => irA({ anio: per.anio, mes: Number(e.target.value) })}>{MESES.map((m, i) => <option key={m} value={i + 1}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}</select></label>
        <label className="im-select"><span>Año</span>
          <select value={per.anio} onChange={(e) => irA({ anio: Number(e.target.value), mes: per.mes })}>{anios.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
      </>}
      <p className="im-estado" role="status">
        {!b ? "Cargando…" : sucio ? <strong>Cambios sin guardar</strong> : guardado ? <>Guardado el <strong>{fechaHora(guardado.actualizadoEn)} h</strong>{guardado.actualizadoPor ? ` · ${guardado.actualizadoPor}` : ""}</> : "Informe nuevo, todavía sin guardar"}
      </p>
    </div>
    {lista.length > 0 && <div className="im-guardados" aria-label="Informes guardados">
      <span>Guardados:</span>
      {lista.map((i) => { const p = semanal ? { desde: i.desde, hasta: i.hasta } : { anio: i.anio, mes: i.mes }; return <button key={claveDe(p)} type="button" className={`im-chip${claveDe(p) === cargado ? " im-chip--on" : ""}`} onClick={() => irA(p)}>{etiquetaPeriodo(p)}</button>; })}
    </div>}

    {error && <div className="alert alert--error" role="alert">{error}</div>}

    {b && <>
      <section className="im-seccion" aria-labelledby={id("s0")}>
        <EsquemaHoja activo="titulo" />
        <div className="im-seccion-cuerpo">
          <h2 id={id("s0")}>Título</h2>
          <p className="im-ubicacion">Arriba de todo, con los logos y la dirección. Sale en dos renglones; si dejás uno vacío, se usa el texto de siempre{semanal ? " (con las fechas de la semana)" : " (con el mes y el año elegidos)"}.</p>
          <label className="im-campo" htmlFor={id("titulo")}><span>Título (renglón grande)</span>
            <input id={id("titulo")} type="text" maxLength={90} value={b.titulo} placeholder="BALANCE HIDROMETEOROLÓGICO" onChange={(e) => cambiar((x) => ({ ...x, titulo: e.target.value }))} /></label>
          <label className="im-campo" htmlFor={id("subtitulo")}><span>Subtítulo (segundo renglón)</span>
            <input id={id("subtitulo")} type="text" maxLength={90} value={b.subtitulo} placeholder={subtituloBase} onChange={(e) => cambiar((x) => ({ ...x, subtitulo: e.target.value }))} /></label>
        </div>
      </section>

      <section className="im-seccion" aria-labelledby={id("s1")}>
        <EsquemaHoja activo="valores" />
        <div className="im-seccion-cuerpo">
          <h2 id={id("s1")}>{semanal ? R("valores", base.valores) : "Valores medios del mes"}</h2>
          <p className="im-ubicacion">Tabla debajo del título, una fila por estación. Los números con coma o punto (24,5); los eventos, enteros.{semanal ? " Los títulos de las columnas también se pueden cambiar." : ""}</p>
          {semanal && <CampoRotulo id={id("r-valores")} valor={b.rotulos.valores} base={base.valores} onChange={(v) => ponerRotulo("valores", v)} />}
          <fieldset className="im-columnas">
            <legend>Columnas que salen en el PDF</legend>
            {COLUMNAS.map((c) => <label key={c.campo}><input type="checkbox" checked={!b.columnasOcultas.includes(c.campo)} onChange={() => alternarColumna(c.campo)} /> {c.corto}</label>)}
          </fieldset>
          <div className="im-tabla-envoltorio">
            <table className="im-tabla">
              <thead><tr>
                {semanal
                  ? <><th scope="col"><input type="text" className="im-th-input" aria-label="Título de la columna de estaciones" maxLength={160} placeholder="Estación" value={b.rotulos.estacion || ""} onChange={(e) => ponerRotulo("estacion", e.target.value)} /></th>
                    {columnasVisibles.map((c) => <th scope="col" key={c.campo}><input type="text" className="im-th-input" aria-label={`Título de la columna «${c.corto}»`} maxLength={160} placeholder={c.titulo} value={b.rotulos[c.campo] || ""} onChange={(e) => ponerRotulo(c.campo, e.target.value)} /></th>)}</>
                  : <><th scope="col">Estación</th>{columnasVisibles.map((c) => <th scope="col" key={c.campo}>{c.titulo}</th>)}</>}
                <th><span className="im-sr">Mostrar u ocultar</span></th><th><span className="im-sr">Quitar</span></th></tr></thead>
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
          {semanal && <CampoRotulo id={id("r-referencias")} rotulo="Referencias debajo de la tabla" valor={b.rotulos.referencias} base="° C  Grados Celsius      N°  Número de eventos      mm  Milímetros de precipitación (según las columnas visibles)" onChange={(v) => ponerRotulo("referencias", v)} />}
        </div>
      </section>

      <section className="im-seccion" aria-labelledby={id("s2")}>
        <EsquemaHoja activo="resumen" />
        <div className="im-seccion-cuerpo">
          <h2 id={id("s2")}>{semanal ? R("resumen", base.resumen) : "Resumen meteorológico del mes"}</h2>
          <p className="im-ubicacion">Texto libre, debajo de la tabla de valores medios. Un renglón nuevo arma un párrafo nuevo.</p>
          {semanal && <CampoRotulo id={id("r-resumen")} valor={b.rotulos.resumen} base={base.resumen} onChange={(v) => ponerRotulo("resumen", v)} />}
          <CampoTexto id={id("resumen")} rotulo="Resumen" valor={b.resumen} onChange={(v) => cambiar((x) => ({ ...x, resumen: v }))} filas={9} />
        </div>
      </section>

      <section className="im-seccion" aria-labelledby={id("s3")}>
        <EsquemaHoja activo="trimestral" />
        <div className="im-seccion-cuerpo">
          <h2 id={id("s3")}>{semanal ? R("trimestral", base.trimestral) : "Pronóstico climático trimestral"}</h2>
          <p className="im-ubicacion">Primero los mapas (precipitación y temperatura del trimestre; podés subir varios, van en una fila) y debajo el texto de análisis, bajo la barra «{R("trimestral", base.trimestral)}».</p>
          {semanal && <CampoRotulo id={id("r-trim")} valor={b.rotulos.trimestral} base={base.trimestral} onChange={(v) => ponerRotulo("trimestral", v)} />}
          <CampoImagenes valor={b.trimestral.imagenes} descripcion="Mapas del pronóstico climático trimestral" onChange={(v) => ponerSeccion("trimestral", "imagenes", v)} />
          <CampoTexto id={id("trim")} rotulo="Análisis de los mapas" valor={b.trimestral.texto} onChange={(v) => ponerSeccion("trimestral", "texto", v)} />
        </div>
      </section>

      <section className="im-seccion" aria-labelledby={id("s4")}>
        <EsquemaHoja activo="nino" />
        <div className="im-seccion-cuerpo">
          <h2 id={id("s4")}>{semanal ? R("nino", base.nino) : "Estado actual y proyección del fenómeno del Niño"}</h2>
          <p className="im-ubicacion">Al final: los mapas del fenómeno (varios, en una fila) y debajo su texto, bajo la barra «{R("nino", base.nino)}».</p>
          {semanal && <CampoRotulo id={id("r-nino")} valor={b.rotulos.nino} base={base.nino} onChange={(v) => ponerRotulo("nino", v)} />}
          <CampoImagenes valor={b.nino.imagenes} descripcion="Mapas del fenómeno del Niño" onChange={(v) => ponerSeccion("nino", "imagenes", v)} />
          <CampoTexto id={id("nino")} rotulo="Texto del fenómeno del Niño" valor={b.nino.texto} onChange={(v) => ponerSeccion("nino", "texto", v)} />
        </div>
      </section>

      {semanal && <section className="im-seccion im-seccion--simple" aria-label="Pie del informe">
        <div className="im-seccion-cuerpo">
          <h2>Pie del informe</h2>
          <CampoRotulo id={id("r-elaborado")} rotulo="Título del cierre («informe elaborado por…»)" valor={b.rotulos.elaborado} base="INFORME ELABORADO POR" onChange={(v) => ponerRotulo("elaborado", v)} />
        </div>
      </section>}

      <div className="im-pie" role="region" aria-label="Acciones del informe">
        <div className="im-pie-estado">
          {problemas.length > 0 && <p className="im-error" role="alert">Hay valores que no son válidos: {problemas.slice(0, 3).join("; ")}{problemas.length > 3 ? ` y ${problemas.length - 3} más` : ""}.</p>}
          {faltantes.length > 0 && <p className="im-faltan">Todavía falta: {faltantes.join(", ")}. El PDF se puede bajar igual, incompleto.</p>}
        </div>
        <div className="im-pie-botones">
          <button type="button" className="im-btn" disabled={!!ocupado || !sucio} onClick={descartar}
            title={sucio ? "Descarta lo que cargaste desde el último guardado" : "No hay cambios para descartar"}>Cancelar y descartar</button>
          {guardado && <button type="button" className="im-btn im-btn--peligro" onClick={borrar} title="Borra el informe guardado de este período">Borrar guardado</button>}
          <button type="button" className="im-btn" disabled={!!ocupado} onClick={() => pdf(false)}>{ocupado === "ver" ? "Armando…" : "Ver PDF"}</button>
          <button type="button" className="im-btn" disabled={!!ocupado} onClick={() => pdf(true)}>{ocupado === "descargar" ? "Armando…" : "Descargar PDF"}</button>
          <button type="button" className="im-btn im-btn--primario" disabled={!!ocupado || !sucio && !!guardado} onClick={guardar}>{ocupado === "guardar" ? "Guardando…" : "Guardar informe"}</button>
        </div>
      </div>
    </>}
  </>;
}

/** Cuántos hubo en un mes o en una semana (ACP, alertas, avisos…), leído de la base, y su PDF con el formato de los informes. */
function PanelEventos() {
  const hoy = new Date();
  const [modo, setModo] = useState("mes");
  const [anio, setAnio] = useState(hoy.getFullYear()), [mes, setMes] = useState(hoy.getMonth() === 0 ? 12 : hoy.getMonth());
  const [desdeSem, setDesdeSem] = useState(lunesPasado()), [hastaSem, setHastaSem] = useState(sumarDias(lunesPasado(), 6));
  const [datos, setDatos] = useState(null), [error, setError] = useState(""), [cargando, setCargando] = useState(false), [ocupado, setOcupado] = useState("");
  const rango = useMemo(() => {
    if (modo === "mes") { const ultimo = new Date(anio, mes, 0).getDate(); return { desde: `${anio}-${pad(mes)}-01`, hasta: `${anio}-${pad(mes)}-${pad(ultimo)}` }; }
    return { desde: desdeSem, hasta: hastaSem };
  }, [modo, anio, mes, desdeSem, hastaSem]);
  const valido = rango.desde && rango.hasta && rango.hasta >= rango.desde;
  useEffect(() => {
    if (!valido) { setDatos(null); return undefined; }
    let vigente = true;
    setCargando(true); setError("");
    api.getInformeEventos(rango.desde, rango.hasta).then((d) => { if (vigente) setDatos(d); }).catch((e) => { if (vigente) { setDatos(null); setError(e.message); } }).finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [rango.desde, rango.hasta, valido]);

  async function pdf(descargar) {
    setOcupado(descargar ? "descargar" : "ver"); setError("");
    const pestana = descargar ? null : window.open("", "_blank");
    try {
      const url = URL.createObjectURL(await api.generarInformeEventosPdf(rango.desde, rango.hasta));
      if (descargar) { const a = document.createElement("a"); a.href = url; a.download = `EVENTOS ${rango.desde} a ${rango.hasta}.pdf`; a.click(); }
      else if (pestana) pestana.location.href = url; else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) { pestana?.close(); setError(e.message); }
    finally { setOcupado(""); }
  }
  const anios = useMemo(() => Array.from({ length: 8 }, (_, i) => hoy.getFullYear() + 1 - i), []); // eslint-disable-line react-hooks/exhaustive-deps
  const r = datos?.resumen;
  const cuadros = r ? [["Avisos a muy corto plazo del SMN", r.acp], ["Alertas del SMN (por emisión)", r.alertasSmn], ["Alertas publicadas por el Ministerio", r.alertasPublicadas], ["Avisos publicados por el Ministerio", r.avisosPropios], ["Avisos especiales", r.avisosEspeciales], ...(r.eventos ? [["Eventos climáticos", r.eventos]] : [])] : [];
  const lista = (xs) => (xs?.length ? xs.join(", ") : "—");

  return <>
    <div className="im-barra">
      <div className="im-select"><span>Período</span>
        <div className="im-segmentos" role="group" aria-label="Tipo de período">
          <button type="button" className={`im-chip${modo === "mes" ? " im-chip--on" : ""}`} aria-pressed={modo === "mes"} onClick={() => setModo("mes")}>Un mes</button>
          <button type="button" className={`im-chip${modo === "semana" ? " im-chip--on" : ""}`} aria-pressed={modo === "semana"} onClick={() => setModo("semana")}>Una semana o rango</button>
        </div></div>
      {modo === "mes" ? <>
        <label className="im-select"><span>Mes</span><select value={mes} onChange={(e) => setMes(Number(e.target.value))}>{MESES.map((m, i) => <option key={m} value={i + 1}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}</select></label>
        <label className="im-select"><span>Año</span><select value={anio} onChange={(e) => setAnio(Number(e.target.value))}>{anios.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
      </> : <>
        <label className="im-select"><span>Desde</span><input type="date" value={desdeSem} onChange={(e) => { setDesdeSem(e.target.value); if (e.target.value && hastaSem < e.target.value) setHastaSem(sumarDias(e.target.value, 6)); }} /></label>
        <label className="im-select"><span>Hasta</span><input type="date" value={hastaSem} min={desdeSem} onChange={(e) => setHastaSem(e.target.value)} /></label>
      </>}
      <p className="im-estado" role="status">{cargando ? "Leyendo…" : datos ? `Del ${dm(datos.desde)} al ${dm(datos.hasta)} de ${datos.hasta.slice(0, 4)}` : ""}</p>
    </div>
    {error && <div className="alert alert--error" role="alert">{error}</div>}
    {datos && !datos.conBase && <div className="alert alert--error" role="alert">Sin conexión a la base de datos: no hay nada para mostrar.</div>}

    {datos && <>
      <ul className="im-cuadros" aria-label="Resumen del período">
        {cuadros.map(([t, n]) => <li key={t}><strong>{n}</strong><span>{t}</span></li>)}
      </ul>
      <p className="im-ubicacion">Lo del SMN sale del historial que guarda la app: lo que el SMN emitió mientras estuvo apagada no está. El PDF lleva estas mismas tablas con el formato de los informes.</p>

      <details className="im-detalle" open={r.acp > 0}><summary>Avisos a muy corto plazo (ACP) del SMN · {r.acp}</summary>
        {r.acp > 0 ? <div className="im-tabla-envoltorio"><table className="im-tabla im-tabla--datos"><thead><tr><th>Inicio</th><th>Fin</th><th>Nivel</th><th>Evento</th><th>Departamentos</th></tr></thead>
          <tbody>{datos.acp.map((a) => <tr key={a.id}><td>{fechaHora(a.inicio)}</td><td>{fechaHora(a.fin)}</td><td>{a.nivel}</td><td>{a.evento}</td><td>{lista(a.departamentos)}</td></tr>)}</tbody></table></div> : <p className="im-vacio">Sin avisos en este período.</p>}
        {r.acp > 0 && <p className="im-ubicacion">Por evento: {r.acpPorEvento.map((x) => `${x.nombre} (${x.cantidad})`).join(" · ")}</p>}
      </details>
      <details className="im-detalle"><summary>Alertas del SMN para Misiones · {r.alertasSmn}</summary>
        {r.alertasSmn > 0 ? <div className="im-tabla-envoltorio"><table className="im-tabla im-tabla--datos"><thead><tr><th>Emitida</th><th>Nivel</th><th>Fenómenos</th><th>Desde</th><th>Hasta</th><th>Departamentos</th></tr></thead>
          <tbody>{datos.alertasSmn.map((a) => <tr key={a.emitidoEn}><td>{fechaHora(a.emitidoEn)}</td><td>{a.nivel}</td><td>{lista(a.fenomenos)}</td><td>{fechaHora(a.inicio)}</td><td>{fechaHora(a.fin)}</td><td>{a.departamentos.length === 17 ? "Toda la provincia (17)" : lista(a.departamentos)}</td></tr>)}</tbody></table></div> : <p className="im-vacio">Sin alertas en este período.</p>}
      </details>
      <details className="im-detalle"><summary>Alertas publicadas por el Ministerio · {r.alertasPublicadas}</summary>
        {r.alertasPublicadas > 0 ? <div className="im-tabla-envoltorio"><table className="im-tabla im-tabla--datos"><thead><tr><th>N°</th><th>Publicada</th><th>Nivel</th><th>Fenómenos</th><th>Período</th><th>Origen</th></tr></thead>
          <tbody>{datos.alertasPublicadas.map((a) => <tr key={a.id}><td>{a.id}</td><td>{fechaHora(a.publicadoEn)}</td><td>{a.nivel}</td><td>{lista(a.fenomenos)}</td><td>{a.periodo || "—"}</td><td>{a.origen}</td></tr>)}</tbody></table></div> : <p className="im-vacio">Sin alertas publicadas en este período.</p>}
      </details>
      <details className="im-detalle"><summary>Avisos publicados por el Ministerio · {r.avisosPropios + r.avisosEspeciales}</summary>
        {r.avisosPropios + r.avisosEspeciales > 0 ? <div className="im-tabla-envoltorio"><table className="im-tabla im-tabla--datos"><thead><tr><th>Fecha</th><th>Tipo</th><th>Texto</th></tr></thead>
          <tbody>{[...datos.avisosPropios.map((a) => ({ k: `p${a.id}`, f: a.fecha, t: "Muy corto plazo", x: a.texto })), ...datos.avisosEspeciales.map((a) => ({ k: `e${a.id}`, f: a.fecha, t: "Especial", x: a.texto }))].sort((a, b) => Date.parse(a.f) - Date.parse(b.f)).map((a) => <tr key={a.k}><td>{fechaHora(a.f)}</td><td>{a.t}</td><td>{String(a.x || "").replace(/\s*\n+\s*/g, " · ")}</td></tr>)}</tbody></table></div> : <p className="im-vacio">Sin avisos en este período.</p>}
      </details>

      <div className="im-pie" role="region" aria-label="Acciones del resumen">
        <div className="im-pie-estado" />
        <div className="im-pie-botones">
          <button type="button" className="im-btn" disabled={!!ocupado || !valido} onClick={() => pdf(false)}>{ocupado === "ver" ? "Armando…" : "Ver PDF"}</button>
          <button type="button" className="im-btn im-btn--primario" disabled={!!ocupado || !valido} onClick={() => pdf(true)}>{ocupado === "descargar" ? "Armando…" : "Descargar PDF"}</button>
        </div>
      </div>
    </>}
  </>;
}

const PESTANAS = [
  { id: "mensual", titulo: "Informe mensual" },
  { id: "semanal", titulo: "Informe semanal" },
  { id: "eventos", titulo: "Resumen de eventos" },
];

export default function InformeMensualPage() {
  const [pestana, setPestana] = useState("mensual");
  return <div className="admin-layout admin-layout--sin-mapa">
    <BrandHeader subtitulo="Informes"><VolverConfiguracion /></BrandHeader>
    <div className="admin-panel im-pagina" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading">
        <h1>Informes</h1>
        <p>Balance hidrometeorológico del mes y de la semana (se cargan a mano: los valores medios todavía no se calculan solos) y el resumen de eventos del período (ACP, alertas, avisos), que sale solo de la base. Todos se bajan en PDF con el mismo formato.</p>
      </div>
      <div className="im-pestanas" role="tablist" aria-label="Tipo de informe">
        {PESTANAS.map((p) => <button key={p.id} type="button" role="tab" id={`im-tab-${p.id}`} aria-selected={pestana === p.id} aria-controls={`im-panel-${p.id}`} className={`im-pestana${pestana === p.id ? " im-pestana--on" : ""}`} onClick={() => setPestana(p.id)}>{p.titulo}</button>)}
      </div>
      {/* Los tres quedan montados: cambiar de pestaña no pierde lo que se estaba cargando. */}
      <div role="tabpanel" id="im-panel-mensual" aria-labelledby="im-tab-mensual" hidden={pestana !== "mensual"}><PanelInforme tipo="mensual" /></div>
      <div role="tabpanel" id="im-panel-semanal" aria-labelledby="im-tab-semanal" hidden={pestana !== "semanal"}><PanelInforme tipo="semanal" /></div>
      <div role="tabpanel" id="im-panel-eventos" aria-labelledby="im-tab-eventos" hidden={pestana !== "eventos"}><PanelEventos /></div>
    </div>
  </div>;
}
