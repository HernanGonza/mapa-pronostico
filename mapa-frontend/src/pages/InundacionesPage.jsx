import { useEffect, useMemo, useState } from "react";
import { PanelLeft, PanelTop, PanelBottom, LayoutGrid, Map as IconoMapa, ChevronRight, Plus } from "lucide";
import VolverConfiguracion from "../components/VolverConfiguracion";
import BrandHeader from "../components/BrandHeader";
import ArroyosMap from "../components/ArroyosMap";
import TarjetaArroyo, { fmt } from "../components/TarjetaArroyo";
import EmbedShare from "../components/EmbedShare";
import Icono from "../components/Icono";
import { getArroyos, actualizarArroyos, crearPuntoArroyo, editarPuntoArroyo, borrarPuntoArroyo } from "../api";
import { tiempoRelativo } from "../lib/tiempoRelativo";
import { confirmar } from "../lib/ui";
import "./ensamble.css"; // el cajón lateral (.ens-cajon) es el mismo del informe del ensamble

const VACIO = { nombre: "", arroyo: "", estacion: "", ruta: "", municipio: "", lat: "", lng: "", vigilancia: "", alerta: "", corte: "", nota: "", activo: true };
const aForm = (p) => ({ nombre: p.nombre, arroyo: p.arroyo, estacion: p.estacion || "", ruta: p.ruta || "", municipio: p.municipio || "", lat: String(p.lat), lng: String(p.lng),
  vigilancia: String(p.umbrales.vigilancia ?? ""), alerta: String(p.umbrales.alerta ?? ""), corte: String(p.umbrales.corte ?? ""), nota: p.nota || "", activo: p.activo });

// Cómo se acomodan las tarjetas y el mapa. La elegida se recuerda en este navegador.
const VISTAS = [
  { id: "lateral", titulo: "Tarjetas a la izquierda, mapa a la derecha", icono: PanelLeft },
  { id: "arriba", titulo: "Tarjetas arriba, mapa abajo", icono: PanelTop },
  { id: "abajo", titulo: "Mapa arriba, tarjetas abajo", icono: PanelBottom },
  { id: "tira", titulo: "Mapa grande con una tira de tarjetas", icono: IconoMapa },
  { id: "tarjetas", titulo: "Sólo tarjetas", icono: LayoutGrid },
];
const CLAVE_VISTA = "arroyos-vista-v1", CLAVE_BORRADOR = "arroyos-borrador-v1";
const leerVista = () => { try { const v = localStorage.getItem(CLAVE_VISTA); return VISTAS.some((x) => x.id === v) ? v : "lateral"; } catch { return "lateral"; } };
const leerBorrador = () => { try { const b = JSON.parse(localStorage.getItem(CLAVE_BORRADOR)); return b?.form && b?.inicial ? b : null; } catch { return null; } };
const enNumero = (v) => { const n = Number(String(v).replace(",", ".")); return String(v).trim() !== "" && Number.isFinite(n) ? n : null; };

function Campo({ etiqueta, ayuda, children }) {
  return <label className="paso-etiqueta">{etiqueta}{children}{ayuda && <small className="arroyos-ayuda">{ayuda}</small>}</label>;
}

export default function InundacionesPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);
  const [sel, setSel] = useState(null);
  const [vista, setVista] = useState(leerVista);
  const [borrador, setBorrador] = useState(leerBorrador); // { id|null, inicial, form }: sigue acá aunque se oculte el cajón
  const [cajon, setCajon] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState("");

  useEffect(() => { try { localStorage.setItem(CLAVE_VISTA, vista); } catch { /* sin almacenamiento */ } }, [vista]);
  useEffect(() => {
    try { if (borrador) localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(borrador)); else localStorage.removeItem(CLAVE_BORRADOR); } catch { /* sin almacenamiento */ }
  }, [borrador]);

  async function cargar() {
    try { setData(await getArroyos()); setError(""); } catch (e) { setError(e.message); }
  }
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  // Al elegir un punto (en el mapa o en la lista), su tarjeta se muestra.
  useEffect(() => { if (sel) document.getElementById(`arroyo-${sel}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [sel, vista]);

  async function consultarAhora() {
    if (updating) return;
    setUpdating(true); setError("");
    try { setData(await actualizarArroyos()); } catch (e) { setError(e.message); } finally { setUpdating(false); }
  }

  const sucio = borrador && JSON.stringify(borrador.form) !== JSON.stringify(borrador.inicial);
  async function abrir(id, inicial) {
    setErrorForm("");
    if (borrador && borrador.id === id) { setCajon(true); return; }
    if (sucio && !(await confirmar({ titulo: "Hay un punto a medio cargar", texto: "Si seguís, se descarta lo que ya escribiste.", confirmar: "Descartar y seguir", cancelar: "Volver al borrador", peligro: true }))) { setCajon(true); return; }
    setBorrador({ id, inicial, form: inicial }); setCajon(true);
  }
  const cambiar = (k, v) => setBorrador((b) => ({ ...b, form: { ...b.form, [k]: v } }));
  const ubicar = ([lat, lng], desde) => setBorrador((b) => (b ? { ...b, form: { ...b.form, lat: String(lat), lng: String(lng),
    ...(desde?.ruta && !b.form.ruta ? { ruta: desde.ruta } : {}), ...(desde?.nombre && !b.form.nombre ? { nombre: desde.nombre } : {}) } } : b));
  async function descartar() {
    if (sucio && !(await confirmar({ titulo: "¿Descartar este punto?", texto: "Se pierde lo que escribiste.", confirmar: "Descartar", peligro: true }))) return;
    setBorrador(null); setCajon(false); setErrorForm("");
  }
  async function guardar(e) {
    e.preventDefault(); setGuardando(true); setErrorForm("");
    try {
      if (borrador.id) await editarPuntoArroyo(borrador.id, borrador.form); else await crearPuntoArroyo(borrador.form);
      setBorrador(null); setCajon(false); await cargar();
    } catch (err) { setErrorForm(err.message); } finally { setGuardando(false); }
  }
  async function eliminar() {
    if (!(await confirmar({ titulo: "¿Eliminar este punto?", texto: "No se puede deshacer. Para sacarlo de la vista sin perderlo, desactivalo.", confirmar: "Eliminar", peligro: true }))) return;
    try { await borrarPuntoArroyo(borrador.id); setBorrador(null); setCajon(false); setSel(null); await cargar(); } catch (err) { setErrorForm(err.message); }
  }

  const puntos = data?.puntos || [];
  const enAviso = puntos.filter((p) => p.activo && ["vigilancia", "alerta", "corte"].includes(p.estado.codigo));
  const conSensor = puntos.filter((p) => p.activo && p.estacion);
  const sinUmbral = useMemo(() => puntos.some((p) => p.activo && p.estado.codigo === "sin_umbral"), [puntos]);
  const f = borrador?.form;
  const lat = f && enNumero(f.lat), lng = f && enNumero(f.lng);
  const ubicacion = lat != null && lng != null ? [lat, lng] : null;
  const conMapa = vista !== "tarjetas";

  return <div className={`admin-layout cuencas-claro arr-vista--${vista}${vista === "tarjetas" ? " admin-layout--sin-mapa" : ""}`}>
    <BrandHeader subtitulo="Inundaciones"><VolverConfiguracion /></BrandHeader>
    <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="arr-barra">
        <div className="arr-vistas" role="group" aria-label="Cómo se ordena la pantalla">
          {VISTAS.map((v) => <button key={v.id} type="button" className={`arr-vista-boton${vista === v.id ? " arr-vista-boton--on" : ""}`} title={v.titulo} aria-label={v.titulo} aria-pressed={vista === v.id} onClick={() => setVista(v.id)}><Icono icono={v.icono} size={18} /></button>)}
        </div>
        <button className="btn" type="button" onClick={consultarAhora} disabled={updating}>{updating ? "Consultando…" : "Consultar ahora"}</button>
        <button className="btn btn--primary" type="button" onClick={() => abrir(null, VACIO)}><Icono icono={Plus} size={16} /> Agregar punto</button>
        {borrador && !cajon && <button className="btn btn--ghost arr-borrador" type="button" onClick={() => setCajon(true)}>Seguir con el borrador{borrador.form.nombre ? `: ${borrador.form.nombre}` : ""}<i className="ens-cajon-punto" aria-hidden="true" /></button>}
        <span className="admin-panel__hint arr-hint">{data ? `Última consulta ${data.consultadoEn ? tiempoRelativo(data.consultadoEn) : "sin datos aún"}` : "Consultando…"}</span>
      </div>

      <div className="editor-heading arr-titulo">
        <span className="editor-eyebrow">Red Hidrológica Nacional · snih.hidricosargentina.gob.ar</span>
        <h1>Arroyos de Misiones</h1>
        <p>Altura de los arroyos internos que, al crecer, obligan a cortar rutas y puentes. Las estaciones automáticas informan cada 4 horas. Son datos crudos del sensor, sin validar.</p>
      </div>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      {enAviso.length > 0 && <div className="cuencas-avisos" role="status">{enAviso.map((p) => <p key={p.id}><strong>{p.nombre} · {p.estado.etiqueta}</strong> — {p.arroyo}, {fmt(p.valor)} m. {p.estado.motivo}</p>)}</div>}
      {data && enAviso.length === 0 && conSensor.length > 0 &&
        <p className="admin-panel__hint arr-titulo">Ningún punto supera sus umbrales{sinUmbral ? " (los puntos sin umbrales cargados no se evalúan)" : ""}.</p>}

      <div className="cuencas-tarjetas arroyos-tarjetas">
        {puntos.map((p) => <TarjetaArroyo key={p.id} p={p} seleccionado={p.id === sel} onElegir={() => setSel(p.id)} onEditar={() => abrir(p.id, aForm(p))} />)}
        {data && !puntos.length && <p>No hay puntos cargados.</p>}
      </div>

      <div className="arr-pie">
        <details className="cuencas-criterios"><summary>Cómo se interpreta</summary>
          <p>La altura es la que mide cada estación en su propia escala (no es la altura sobre el nivel del mar ni la profundidad del arroyo). Una lectura se considera reciente hasta 9 horas; pasado ese tiempo el punto figura «Sin datos recientes».</p>
          <p>Los estados salen de los umbrales que se cargan en cada punto (vigilancia, alerta y nivel de corte de ruta). Hasta que Vialidad o Defensa Civil informen a qué altura se corta cada lugar, los puntos muestran la altura y la tendencia, sin estado.</p>
          <p>Tendencia: compara con la lectura de 3 a 12 horas atrás; «Sube» o «Baja» desde 2 cm por hora. Los puntos sin sensor se informan por otros canales y se van a poder cargar a mano.</p>
        </details>
        <details className="cuencas-criterios"><summary>Embeber en el sitio web</summary>
          <EmbedShare path="/embed/arroyos-mapa" title="Arroyos de Misiones · mapa" height={640} heading="Mapa para el sitio web"
            hint="Cada punto abre su tarjeta, que cambia de color según los umbrales. Se actualiza solo cada 5 minutos." linkLabel="Enlace al mapa" openLabel="Abrir mapa ↗" />
          <EmbedShare path="/embed/arroyos-tarjetas" title="Arroyos de Misiones · tarjetas" height={780} heading="Tarjetas para el sitio web"
            hint="Las tarjetas de todos los puntos con sensor, sin el mapa." linkLabel="Enlace a las tarjetas" openLabel="Abrir tarjetas ↗" />
        </details>
      </div>
    </section>

    {conMapa && <div className="admin-map-area">
      <ArroyosMap puntos={puntos} seleccionadoId={sel} onSeleccionar={setSel} onUbicar={cajon ? ubicar : undefined} ubicacion={cajon ? ubicacion : null} />
    </div>}

    {borrador && <aside id="ens-cajon" className={`ens-cajon${cajon ? " ens-cajon--abierto" : ""}`} aria-label="Punto de monitoreo" {...(cajon ? {} : { inert: "" })}>
      <header className="ens-cajon-cab">
        <div><h2>{borrador.id ? "Editar punto" : "Nuevo punto"}</h2><p>Lo que escribís queda guardado aunque ocultes el cajón.</p></div>
        <div className="ens-cajon-acciones"><button type="button" className="btn btn--ghost" onClick={() => setCajon(false)}>Ocultar <Icono icono={ChevronRight} size={16} /></button></div>
      </header>
      <form id="arr-form" className="ens-cajon-cuerpo" onSubmit={guardar}>
        {errorForm && <div className="alert alert--error" role="alert">{errorForm}</div>}
        <Campo etiqueta="Nombre del punto"><input className="paso-input" value={f.nombre} maxLength={80} required placeholder="Ej: Puente sobre RP 7" disabled={guardando} onChange={(e) => cambiar("nombre", e.target.value)} /></Campo>
        <Campo etiqueta="Arroyo"><input className="paso-input" value={f.arroyo} maxLength={80} required placeholder="Ej: Arroyo Tabay" disabled={guardando} onChange={(e) => cambiar("arroyo", e.target.value)} /></Campo>
        <div className="arroyos-form__fila">
          <Campo etiqueta="Ruta"><input className="paso-input" value={f.ruta} maxLength={80} placeholder="RP 7" disabled={guardando} onChange={(e) => cambiar("ruta", e.target.value)} /></Campo>
          <Campo etiqueta="Municipio"><input className="paso-input" value={f.municipio} maxLength={80} disabled={guardando} onChange={(e) => cambiar("municipio", e.target.value)} /></Campo>
        </div>
        <div className="arroyos-form__fila">
          <Campo etiqueta="Latitud"><input className="paso-input" value={f.lat} inputMode="decimal" required placeholder="-27.37" disabled={guardando} onChange={(e) => cambiar("lat", e.target.value)} /></Campo>
          <Campo etiqueta="Longitud"><input className="paso-input" value={f.lng} inputMode="decimal" required placeholder="-55.89" disabled={guardando} onChange={(e) => cambiar("lng", e.target.value)} /></Campo>
        </div>
        <p className="arroyos-ayuda">También podés hacer clic en el mapa para marcar la ubicación{vista === "tarjetas" ? " (cambiá a una vista con mapa)" : ""}.</p>
        <Campo etiqueta="Estación del SNIH (opcional)" ayuda="Código de la estación de la Red Hidrológica Nacional. Sin código, el punto no tiene sensor.">
          <input className="paso-input" value={f.estacion} inputMode="numeric" placeholder="Ej: 13404" disabled={guardando} onChange={(e) => cambiar("estacion", e.target.value)} />
        </Campo>
        <fieldset className="arroyos-form__umbrales"><legend>Umbrales de altura (m, en la escala de la estación)</legend>
          <div className="arroyos-form__fila arroyos-form__fila--3">
            <Campo etiqueta="Vigilancia"><input className="paso-input" value={f.vigilancia} inputMode="decimal" disabled={guardando} onChange={(e) => cambiar("vigilancia", e.target.value)} /></Campo>
            <Campo etiqueta="Alerta"><input className="paso-input" value={f.alerta} inputMode="decimal" disabled={guardando} onChange={(e) => cambiar("alerta", e.target.value)} /></Campo>
            <Campo etiqueta="Corte de ruta"><input className="paso-input" value={f.corte} inputMode="decimal" disabled={guardando} onChange={(e) => cambiar("corte", e.target.value)} /></Campo>
          </div>
          <small className="arroyos-ayuda">Opcionales. Tienen que ir de menor a mayor. Mientras no estén, el punto muestra la altura sin estado.</small>
        </fieldset>
        <Campo etiqueta="Nota interna (opcional)"><textarea className="paso-texto" value={f.nota} maxLength={400} rows={3} placeholder="Ej: Vialidad corta el puente cuando el agua llega a la baranda." disabled={guardando} onChange={(e) => cambiar("nota", e.target.value)} /></Campo>
        <label className="arroyos-form__activo"><input type="checkbox" checked={f.activo} disabled={guardando} onChange={(e) => cambiar("activo", e.target.checked)} /> Punto activo (si se desactiva, no se consulta y no sale en el sitio)</label>
      </form>
      <footer className="ens-cajon-pie">
        <div className="arroyos-pie-acciones">
          <button type="button" className="btn btn--ghost" disabled={guardando} onClick={descartar}>{borrador.id ? "Descartar cambios" : "Descartar"}</button>
          {borrador.id && <button type="button" className="btn btn--ghost" disabled={guardando} onClick={eliminar}>Eliminar punto</button>}
        </div>
        <button type="submit" form="arr-form" className="btn btn--primary" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
      </footer>
    </aside>}
  </div>;
}
