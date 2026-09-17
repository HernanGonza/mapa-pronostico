import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import EmbedShare from "../components/EmbedShare";
import PolygonDrawMap from "../components/PolygonDrawMap";
import SerieClimaticaChart from "../components/SerieClimaticaChart";
import { useAuth } from "../context/AuthContext";
import * as api from "../api";

const MAX_IMAGENES = 8;
const MAX_IMAGEN_BYTES = 5 * 1024 * 1024;

function hoyIso() { return new Date().toISOString().slice(0, 10); }
function haceUnAnioIso() { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); }

function adivinarColumna(columnas, candidatos) {
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return columnas.find((c) => candidatos.includes(norm(c))) || "";
}

const EVENTO_VACIO = {
  tipo: "", tipoOtro: "", titulo: "", descripcion: "", severidad: "",
  fechaInicio: hoyIso(), fechaFin: "", departamento: "", municipio: "", fuente: "",
};

export default function HistoricoPage() {
  const { usuario } = useAuth();
  const puedeEscribir = !!usuario && ["admin", "superadmin"].includes(usuario.rol);
  const [pestana, setPestana] = useState("clima");
  const [catalogo, setCatalogo] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { api.getCatalogoEventos().then(setCatalogo).catch(() => {}); }, []);

  const TABS = [
    ["clima", "Clima histórico"],
    ["eventos", "Eventos"],
    ["estadisticas", "Estadísticas"],
  ];

  return (
    <div className="historico-layout">
      <BrandHeader subtitulo="Registro histórico y estadísticas">
        <Link to="/panel" className="btn-link">← Panel</Link>
      </BrandHeader>
      <nav className="historico-nav" aria-label="Sección del registro histórico">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className="historico-nav__tab" aria-current={pestana === id ? "page" : undefined} onClick={() => setPestana(id)}>
            {label}
          </button>
        ))}
      </nav>
      <main id="contenido-principal" tabIndex={-1} className="historico-body">
        {error && <div className="risk-message risk-message--error" role="alert">{error}</div>}
        {mensaje && <p className="risk-message" role="status">{mensaje}</p>}

        {pestana === "clima" && <ClimaHistorico puedeEscribir={puedeEscribir} setError={setError} setMensaje={setMensaje} />}
        {pestana === "eventos" && <Eventos puedeEscribir={puedeEscribir} catalogo={catalogo} setError={setError} setMensaje={setMensaje} />}
        {pestana === "estadisticas" && <Estadisticas />}

        <div className="historico-compartir"><EmbedShare path="/embed/historico" title="Registro histórico · Misiones" /></div>
      </main>
    </div>
  );
}

// --- Pestaña "Clima histórico" ---------------------------------------------

function ClimaHistorico({ puedeEscribir, setError, setMensaje }) {
  const [estaciones, setEstaciones] = useState([]);
  const [estacion, setEstacion] = useState("");
  const [desde, setDesde] = useState(haceUnAnioIso());
  const [hasta, setHasta] = useState(hoyIso());
  const [serie, setSerie] = useState(null);
  const [cargandoSerie, setCargandoSerie] = useState(false);

  useEffect(() => {
    api.getEstacionesClimaticas().then((r) => {
      setEstaciones(r.estaciones);
      if (r.estaciones.length && !estacion) setEstacion(r.estaciones[0]);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!estacion) return;
    setCargandoSerie(true);
    api.getSerieClimatica(estacion, desde, hasta).then((r) => setSerie(r.serie)).catch((e) => setError(e.message)).finally(() => setCargandoSerie(false));
  }, [estacion, desde, hasta, setError]);

  function recargarEstaciones() {
    api.getEstacionesClimaticas().then((r) => { setEstaciones(r.estaciones); if (!estacion && r.estaciones.length) setEstacion(r.estaciones[0]); }).catch(() => {});
  }

  return (
    <div className="historico-grid historico-grid--clima">
      <div className="historico-card historico-card--chart">
        <h2>Serie histórica por estación</h2>
        <div className="historico-filtros">
          <label className="field"><span>Estación</span>
            <select value={estacion} onChange={(e) => setEstacion(e.target.value)}>
              {estaciones.length === 0 && <option value="">Sin datos todavía</option>}
              {estaciones.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <label className="field"><span>Desde</span><input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="field"><span>Hasta</span><input type="date" value={hasta} min={desde} max={hoyIso()} onChange={(e) => setHasta(e.target.value)} /></label>
        </div>
        {cargandoSerie ? <p role="status">Cargando serie…</p> : <SerieClimaticaChart serie={serie || []} />}
      </div>

      {puedeEscribir && (
        <div className="historico-card">
          <h2>Cargar datos históricos</h2>
          <ImportadorClimatico onImportado={recargarEstaciones} setError={setError} setMensaje={setMensaje} />
          <CargaManualClimatica onCargado={() => { recargarEstaciones(); api.getSerieClimatica(estacion, desde, hasta).then((r) => setSerie(r.serie)).catch(() => {}); }} setError={setError} setMensaje={setMensaje} />
        </div>
      )}
    </div>
  );
}

function ImportadorClimatico({ onImportado, setError, setMensaje }) {
  const [archivo, setArchivo] = useState(null);
  const [columnas, setColumnas] = useState(null);
  const [mapeo, setMapeo] = useState({ fecha: "", estacion: "", tmin: "", tmax: "", precipitacion: "" });
  const [busy, setBusy] = useState(false);
  const [resumen, setResumen] = useState(null);
  const inputRef = useRef(null);

  async function elegirArchivo(e) {
    const f = e.target.files?.[0] || null;
    setArchivo(f); setColumnas(null); setResumen(null);
    if (!f) return;
    setBusy(true); setError("");
    try {
      const { columnas: cols } = await api.detectarColumnasCsv(f);
      setColumnas(cols);
      setMapeo({
        fecha: adivinarColumna(cols, ["fecha", "date"]),
        estacion: adivinarColumna(cols, ["estacion", "localidad", "station"]),
        tmin: adivinarColumna(cols, ["tmin", "temp_min", "temperatura_minima"]),
        tmax: adivinarColumna(cols, ["tmax", "temp_max", "temperatura_maxima"]),
        precipitacion: adivinarColumna(cols, ["precipitacion", "lluvia", "precip"]),
      });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function importar() {
    setBusy(true); setError(""); setMensaje(""); setResumen(null);
    try {
      const r = await api.importarCsvClimatico(archivo, mapeo);
      setResumen(r);
      setMensaje(`Se importaron ${r.importadas} de ${r.totalFilas} filas.`);
      onImportado();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const puedeImportar = archivo && mapeo.fecha && mapeo.estacion;

  return (
    <details className="historico-seccion">
      <summary>Importar datos históricos (CSV)</summary>
      <p className="admin-panel__hint">
        Subí una planilla exportada como CSV. Como cada fuente vieja trae sus propias columnas, elegís acá
        a mano qué columna del archivo corresponde a cada dato antes de importar.
      </p>
      <label className="field"><span>Archivo CSV</span><input ref={inputRef} type="file" accept=".csv,text/csv" disabled={busy} onChange={elegirArchivo} /></label>
      {columnas && (
        <>
          <div className="historico-filtros">
            <label className="field"><span>Columna con la fecha</span>
              <select value={mapeo.fecha} onChange={(e) => setMapeo((m) => ({ ...m, fecha: e.target.value }))}>
                <option value="">— elegir —</option>{columnas.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field"><span>Columna con la estación</span>
              <select value={mapeo.estacion} onChange={(e) => setMapeo((m) => ({ ...m, estacion: e.target.value }))}>
                <option value="">— elegir —</option>{columnas.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field"><span>Columna TMIN (opcional)</span>
              <select value={mapeo.tmin} onChange={(e) => setMapeo((m) => ({ ...m, tmin: e.target.value }))}>
                <option value="">— ninguna —</option>{columnas.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field"><span>Columna TMAX (opcional)</span>
              <select value={mapeo.tmax} onChange={(e) => setMapeo((m) => ({ ...m, tmax: e.target.value }))}>
                <option value="">— ninguna —</option>{columnas.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field"><span>Columna precipitación (opcional)</span>
              <select value={mapeo.precipitacion} onChange={(e) => setMapeo((m) => ({ ...m, precipitacion: e.target.value }))}>
                <option value="">— ninguna —</option>{columnas.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <button type="button" className="btn btn--primary" disabled={busy || !puedeImportar} onClick={importar}>
            {busy ? "Importando…" : "Importar"}
          </button>
        </>
      )}
      {resumen && (
        <p className="admin-panel__hint">
          {resumen.erroresTotales > 0 && `${resumen.erroresTotales} fila(s) con error (se muestran hasta 50): ${resumen.errores.map((e) => `#${e.fila} ${e.motivo}`).join("; ")}`}
        </p>
      )}
    </details>
  );
}

function CargaManualClimatica({ onCargado, setError, setMensaje }) {
  const [form, setForm] = useState({ estacion: "", fecha: hoyIso(), tmin: "", tmax: "", precipitacion: "" });
  const [busy, setBusy] = useState(false);

  async function guardar() {
    setBusy(true); setError(""); setMensaje("");
    try {
      await api.cargarRegistroClimaticoManual({
        estacion: form.estacion, fecha: form.fecha,
        tmin: form.tmin === "" ? null : Number(form.tmin),
        tmax: form.tmax === "" ? null : Number(form.tmax),
        precipitacion: form.precipitacion === "" ? null : Number(form.precipitacion),
      });
      setMensaje("Registro guardado.");
      onCargado();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const puedeGuardar = form.estacion.trim() && form.fecha;

  return (
    <details className="historico-seccion">
      <summary>Cargar un registro suelto a mano</summary>
      <p className="admin-panel__hint">Para completar un día/estación que no viene en ningún archivo (PDF, dato de memoria, etc.).</p>
      <div className="historico-filtros">
        <label className="field"><span>Estación</span><input value={form.estacion} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, estacion: e.target.value }))} /></label>
        <label className="field"><span>Fecha</span><input type="date" value={form.fecha} max={hoyIso()} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} /></label>
        <label className="field"><span>TMIN</span><input type="number" value={form.tmin} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, tmin: e.target.value }))} /></label>
        <label className="field"><span>TMAX</span><input type="number" value={form.tmax} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, tmax: e.target.value }))} /></label>
        <label className="field"><span>Precipitación (mm, opcional)</span><input type="number" value={form.precipitacion} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, precipitacion: e.target.value }))} /></label>
      </div>
      <button type="button" className="btn btn--primary" disabled={busy || !puedeGuardar} onClick={guardar}>{busy ? "Guardando…" : "Guardar registro"}</button>
    </details>
  );
}

// --- Pestaña "Eventos" ------------------------------------------------------

function Eventos({ puedeEscribir, catalogo, setError, setMensaje }) {
  const [eventosLista, setEventosLista] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroDepartamento, setFiltroDepartamento] = useState("");
  const [abierto, setAbierto] = useState(null);
  const [publicando, setPublicando] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);

  function cargar() {
    api.getEventosClimaticos({ tipo: filtroTipo, departamento: filtroDepartamento }).then((r) => setEventosLista(r.eventos)).catch((e) => setError(e.message));
  }
  useEffect(cargar, [filtroTipo, filtroDepartamento]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cambiarPublicacion(evento) {
    setPublicando(evento.id); setError(""); setMensaje("");
    try {
      const actualizado = evento.publicadoEn ? await api.despublicarEventoClimatico(evento.id) : await api.publicarEventoClimatico(evento.id);
      setEventosLista((lista) => lista.map((e) => (e.id === actualizado.id ? actualizado : e)));
      setMensaje(actualizado.publicadoEn ? "Evento publicado — ya se ve en /embed/historico." : "Evento despublicado.");
    } catch (e) { setError(e.message); }
    finally { setPublicando(null); }
  }

  const colorPorTipo = useMemo(() => Object.fromEntries((catalogo?.tipos || []).map((t) => [t.id, t.color])), [catalogo]);
  const etiquetaPorTipo = useMemo(() => Object.fromEntries((catalogo?.tipos || []).map((t) => [t.id, t.etiqueta])), [catalogo]);

  return (
    <div className="historico-stack">
      <div className="historico-card">
        <h2>Eventos meteorológicos puntuales</h2>
        <div className="historico-filtros">
          <label className="field"><span>Tipo</span>
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
              <option value="">Todos</option>
              {(catalogo?.tipos || []).map((t) => <option key={t.id} value={t.id}>{t.etiqueta}</option>)}
            </select>
          </label>
          <label className="field"><span>Departamento</span>
            <select value={filtroDepartamento} onChange={(e) => setFiltroDepartamento(e.target.value)}>
              <option value="">Todos</option>
              {(catalogo?.departamentos || []).map((d) => <option key={d.id} value={d.nombre}>{d.nombre}</option>)}
            </select>
          </label>
        </div>

        {puedeEscribir && (
          <button type="button" className="btn" onClick={() => setMostrarForm((v) => !v)}>
            {mostrarForm ? "Cerrar formulario" : "Cargar evento nuevo"}
          </button>
        )}
        {mostrarForm && puedeEscribir && (
          <FormularioEvento
            catalogo={catalogo}
            setError={setError} setMensaje={setMensaje}
            onCreado={(evento) => { setEventosLista((lista) => [evento, ...(lista || [])]); setMostrarForm(false); }}
          />
        )}
      </div>

      {eventosLista === null ? <p role="status">Cargando eventos…</p> : eventosLista.length === 0 ? (
        <p className="admin-panel__hint">No hay eventos cargados con estos filtros.</p>
      ) : (
        <ul className="eventos-lista historico-card">
          {eventosLista.map((ev) => (
            <li key={ev.id} className="evento-card">
              {ev.imagenes?.[0] && <img src={ev.imagenes[0].url} alt="" className="evento-card__miniatura" />}
              <div className="evento-card__cuerpo">
                <span className="evento-card__tipo" style={{ background: colorPorTipo[ev.tipo] }}>{ev.tipo === "otro" ? ev.tipoOtro : etiquetaPorTipo[ev.tipo]}</span>
                <button type="button" className="evento-card__titulo-btn" onClick={() => setAbierto(abierto === ev.id ? null : ev.id)}>
                  <strong>{ev.titulo}</strong>
                </button>
                <div className="evento-card__meta">
                  {ev.fechaInicio}{ev.fechaFin && ev.fechaFin !== ev.fechaInicio ? ` – ${ev.fechaFin}` : ""}
                  {ev.departamento && ` · ${ev.departamento}`}{ev.municipio && ` · ${ev.municipio}`}
                </div>
                {abierto === ev.id && (
                  <div className="evento-card__detalle">
                    <p>{ev.descripcion}</p>
                    {ev.fuente && <p className="admin-panel__hint">Fuente: {ev.fuente}</p>}
                    {ev.imagenes?.length > 0 && (
                      <div className="evento-card__galeria">
                        {ev.imagenes.map((img, i) => (
                          <figure key={i}><img src={img.url} alt={img.pieDeFoto || ""} />{img.pieDeFoto && <figcaption>{img.pieDeFoto}</figcaption>}</figure>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {puedeEscribir && (
                  <button type="button" className="btn" disabled={publicando === ev.id} onClick={() => cambiarPublicacion(ev)}>
                    {publicando === ev.id ? "Un momento…" : ev.publicadoEn ? "Despublicar" : "Publicar en /embed/historico"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormularioEvento({ catalogo, setError, setMensaje, onCreado }) {
  const [form, setForm] = useState(EVENTO_VACIO);
  const [punto, setPunto] = useState(null);
  const [municipios, setMunicipios] = useState(null);
  const [mostrarMapa, setMostrarMapa] = useState(false);
  const [imagenes, setImagenes] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (mostrarMapa && !municipios) api.getMunicipiosGeojson().then(setMunicipios).catch(() => {}); }, [mostrarMapa, municipios]);

  function campo(nombre) { return (e) => setForm((f) => ({ ...f, [nombre]: e.target.value })); }

  async function agregarImagenes(e) {
    const archivos = Array.from(e.target.files || []);
    e.target.value = "";
    if (imagenes.length + archivos.length > MAX_IMAGENES) { setError(`Como máximo ${MAX_IMAGENES} imágenes.`); return; }
    for (const archivo of archivos) {
      if (!/^image\/(png|jpeg|webp)$/.test(archivo.type) || archivo.size > MAX_IMAGEN_BYTES) {
        setError("Cada imagen debe ser PNG, JPG o WebP de hasta 5 MB."); continue;
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
        reader.readAsDataURL(archivo);
      }).catch((err) => { setError(err.message); return null; });
      if (dataUrl) setImagenes((imgs) => [...imgs, { dataUrl, pieDeFoto: "" }]);
    }
  }
  function quitarImagen(i) { setImagenes((imgs) => imgs.filter((_, idx) => idx !== i)); }
  function ponerPie(i, texto) { setImagenes((imgs) => imgs.map((img, idx) => (idx === i ? { ...img, pieDeFoto: texto } : img))); }

  async function guardar() {
    setBusy(true); setError(""); setMensaje("");
    try {
      const evento = await api.crearEventoClimatico({
        ...form,
        fechaFin: form.fechaFin || null,
        severidad: form.severidad || null,
        departamento: form.departamento || null,
        municipio: form.municipio || null,
        fuente: form.fuente || null,
        lat: punto ? punto[1] : null,
        lng: punto ? punto[0] : null,
        imagenes,
      });
      setMensaje("Evento guardado (como borrador — publicalo cuando quieras que se vea en /embed/historico).");
      setForm(EVENTO_VACIO); setPunto(null); setImagenes([]);
      onCreado(evento);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const puedeGuardar = form.tipo && (form.tipo !== "otro" || form.tipoOtro.trim()) && form.titulo.trim() && form.descripcion.trim() && form.fechaInicio;

  return (
    <div className="historico-form-evento">
      <label className="field"><span>Tipo de evento</span>
        <select value={form.tipo} onChange={campo("tipo")} disabled={busy}>
          <option value="">— elegir —</option>
          {(catalogo?.tipos || []).map((t) => <option key={t.id} value={t.id}>{t.etiqueta}</option>)}
        </select>
      </label>
      {form.tipo === "otro" && <label className="field"><span>¿Qué tipo de evento fue?</span><input value={form.tipoOtro} maxLength={80} disabled={busy} onChange={campo("tipoOtro")} /></label>}
      <label className="field"><span>Severidad (opcional)</span>
        <select value={form.severidad} onChange={campo("severidad")} disabled={busy}>
          <option value="">Sin especificar</option>
          {(catalogo?.severidades || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="field"><span>Fecha de inicio</span><input type="date" value={form.fechaInicio} max={hoyIso()} disabled={busy} onChange={campo("fechaInicio")} /></label>
      <label className="field"><span>Fecha de fin (opcional)</span><input type="date" value={form.fechaFin} min={form.fechaInicio} max={hoyIso()} disabled={busy} onChange={campo("fechaFin")} /></label>
      <label className="field"><span>Departamento (opcional)</span>
        <select value={form.departamento} onChange={campo("departamento")} disabled={busy}>
          <option value="">Sin especificar</option>
          {(catalogo?.departamentos || []).map((d) => <option key={d.id} value={d.nombre}>{d.nombre}</option>)}
        </select>
      </label>
      <label className="field"><span>Municipio/localidad (opcional)</span><input value={form.municipio} maxLength={120} disabled={busy} onChange={campo("municipio")} /></label>
      <label className="field historico-form-evento__full"><span>Título</span><input value={form.titulo} maxLength={140} disabled={busy} onChange={campo("titulo")} placeholder="Ej: Tornado en Oberá" /></label>
      <label className="field historico-form-evento__full"><span>Descripción</span><textarea value={form.descripcion} rows={6} maxLength={4000} disabled={busy} onChange={campo("descripcion")} /></label>
      <label className="field historico-form-evento__full"><span>Fuente (opcional)</span><input value={form.fuente} maxLength={200} disabled={busy} placeholder="Ej: reporte de Defensa Civil, enlace a nota…" onChange={campo("fuente")} /></label>

      <div className="historico-form-evento__full">
        <button type="button" className="btn" onClick={() => setMostrarMapa((v) => !v)}>{mostrarMapa ? "Ocultar mapa" : punto ? "Cambiar punto en el mapa" : "Marcar un punto en el mapa (opcional)"}</button>
        {mostrarMapa && (
          <div className="historico-form-evento__mapa">
            <PolygonDrawMap puntos={punto ? [punto] : []} onChange={(nuevos) => setPunto(nuevos[nuevos.length - 1] || null)} municipios={municipios} />
          </div>
        )}
      </div>

      <label className="field historico-form-evento__full"><span>Imágenes (opcional, hasta {MAX_IMAGENES})</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy || imagenes.length >= MAX_IMAGENES} onChange={agregarImagenes} />
        <small>PNG, JPG o WebP, hasta 5 MB cada una.</small>
      </label>
      {imagenes.length > 0 && (
        <div className="evento-form__imagenes historico-form-evento__full">
          {imagenes.map((img, i) => (
            <div key={i} className="evento-form__imagen">
              <img src={img.dataUrl} alt="" />
              <input placeholder="Pie de foto (opcional)" value={img.pieDeFoto} disabled={busy} onChange={(e) => ponerPie(i, e.target.value)} />
              <button type="button" className="btn" disabled={busy} onClick={() => quitarImagen(i)}>Quitar</button>
            </div>
          ))}
        </div>
      )}

      <button type="button" className="btn btn--block btn--primary historico-form-evento__full" disabled={busy || !puedeGuardar} onClick={guardar}>{busy ? "Guardando…" : "Guardar evento"}</button>
    </div>
  );
}

// --- Pestaña "Estadísticas" -------------------------------------------------

function Estadisticas() {
  const [datos, setDatos] = useState(null);
  useEffect(() => { api.getEstadisticasClimaticas().then(setDatos).catch(() => {}); }, []);

  if (!datos) return <p role="status">Cargando estadísticas…</p>;

  const totalTipo = datos.eventosPorTipo.reduce((s, d) => s + d.cantidad, 0) || 1;
  const totalDepto = datos.eventosPorDepartamento.reduce((s, d) => s + d.cantidad, 0) || 1;

  return (
    <div className="historico-stats">
      <div className="historico-card">
        <h2>Eventos por tipo</h2>
        {datos.eventosPorTipo.length === 0 ? <p className="admin-panel__hint">Todavía no hay eventos publicados.</p> : (
          <ul className="historico-barras">
            {datos.eventosPorTipo.map((d) => (
              <li key={d.tipo}><span>{d.tipo}</span><div className="historico-barra"><div style={{ width: `${(d.cantidad / totalTipo) * 100}%` }} /></div><span>{d.cantidad}</span></li>
            ))}
          </ul>
        )}
      </div>
      <div className="historico-card">
        <h2>Eventos por departamento</h2>
        {datos.eventosPorDepartamento.length === 0 ? <p className="admin-panel__hint">Sin datos todavía.</p> : (
          <ul className="historico-barras">
            {datos.eventosPorDepartamento.map((d) => (
              <li key={d.departamento}><span>{d.departamento}</span><div className="historico-barra"><div style={{ width: `${(d.cantidad / totalDepto) * 100}%` }} /></div><span>{d.cantidad}</span></li>
            ))}
          </ul>
        )}
      </div>
      <div className="historico-card">
        <h2>Eventos por año</h2>
        {datos.eventosPorAnio.length === 0 ? <p className="admin-panel__hint">Sin datos todavía.</p> : (
          <ul className="historico-barras">
            {datos.eventosPorAnio.map((d) => (
              <li key={d.anio}><span>{d.anio}</span><div className="historico-barra"><div style={{ width: `${(d.cantidad / Math.max(...datos.eventosPorAnio.map((x) => x.cantidad))) * 100}%` }} /></div><span>{d.cantidad}</span></li>
            ))}
          </ul>
        )}
      </div>
      <div className="historico-card">
        <h2>Cobertura del historial climático</h2>
        {datos.coberturaPorEstacion.length === 0 ? <p className="admin-panel__hint">Todavía no hay registros climáticos cargados.</p> : (
          <table className="historico-tabla">
            <thead><tr><th>Estación</th><th>Días cargados</th><th>Desde</th><th>Hasta</th></tr></thead>
            <tbody>
              {datos.coberturaPorEstacion.map((e) => <tr key={e.estacion}><td>{e.estacion}</td><td>{e.dias}</td><td>{e.desde}</td><td>{e.hasta}</td></tr>)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
