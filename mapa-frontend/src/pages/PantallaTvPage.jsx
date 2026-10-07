import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowUp, ArrowDown, Trash2, Video, Image, Globe, Map as Mapa } from "lucide";
import BrandHeader from "../components/BrandHeader";
import Icono from "../components/Icono";
import VistaEscalada from "../components/VistaEscalada";
import { useAuth } from "../context/AuthContext";
import { confirmar, notificar } from "../lib/ui";
import { tiempoRelativo } from "../lib/tiempoRelativo";
import { getRotacionTv, guardarRotacionTv, guardarUrgentesTv, subirArchivoTv } from "../api";
import { armarRotacion, paraGuardar, nuevoId, DURACION_PREDETERMINADA } from "../lib/tvPantallas";
import { configDe } from "../lib/tvUrgentes";

/**
 * Configuración → Pantalla TV: qué se ve en la pantalla de transmisión (/tv), en qué orden y
 * cuánto dura cada pantalla. Se suman videos e imágenes (se suben al servidor) y páginas de
 * otros sitios. Al guardar, /tv (y la transmisión en vivo) lo toma sola en menos de 20 s.
 * Sólo superadmin, como Transmisión.
 */
const TIPOS = {
  embebido: { nombre: "Mapa", icono: Mapa },
  video: { nombre: "Video", icono: Video },
  imagen: { nombre: "Imagen", icono: Image },
  pagina: { nombre: "Página web", icono: Globe },
};
const CORTES = [
  { clave: "acp", titulo: "Avisos a muy corto plazo", cada: "cada ACP publicado" },
  { clave: "alertas", titulo: "Alertas meteorológicas", cada: "cada alerta vigente (la nuestra o una del SMN publicada)" },
];
const MODOS = [
  { valor: "ciclo", titulo: "Fijo un rato, después en la rotación", detalle: "Se repite: fijo unos minutos, después pasa a la rotación, y vuelve a quedar fijo cada tanto." },
  { valor: "fijo", titulo: "Siempre fijo", detalle: "Corta la rotación todo el tiempo que esté vigente." },
  { valor: "rotacion", titulo: "Sólo en la rotación", detalle: "Nunca corta: sale como una pantalla más, con su mapa y su cartel." },
];

/** Cómo se muestra un tipo (ACP o alertas) en /tv. Cada cambio se guarda en el momento. */
function CorteTipo({ c, cfg, ocupado, onCambio }) {
  const [tiempos, setTiempos] = useState({ fijoMin: cfg.fijoMin, cadaMin: cfg.cadaMin });
  useEffect(() => { setTiempos({ fijoMin: cfg.fijoMin, cadaMin: cfg.cadaMin }); }, [cfg.fijoMin, cfg.cadaMin]);
  const tiemposCambiados = tiempos.fijoMin !== cfg.fijoMin || tiempos.cadaMin !== cfg.cadaMin;
  const ultimoBoton = cfg.ancla && cfg.accion ? `${cfg.accion === "fijar" ? "Fijado" : "Pasado a la rotación"} a mano ${tiempoRelativo(cfg.ancla)}.` : null;
  return <li className="tvcfg-corte">
    <strong>{c.titulo}</strong>
    <div className="tvcfg-corte__modos" role="radiogroup" aria-label={`${c.titulo}: cómo se muestra en /tv`}>
      {MODOS.map((m) => <label key={m.valor} className={`tvcfg-corte__modo${cfg.modo === m.valor ? " tvcfg-corte__modo--elegido" : ""}`}>
        <input type="radio" name={`modo-${c.clave}`} checked={cfg.modo === m.valor} disabled={ocupado} onChange={() => onCambio({ modo: m.valor }, `${c.titulo}: ${m.titulo.toLowerCase()}.`)} />
        <span><b>{m.titulo}</b><small>{m.detalle}</small></span>
      </label>)}
    </div>
    {cfg.modo === "ciclo" && <>
      <form className="tvcfg-corte__tiempos" onSubmit={(e) => { e.preventDefault(); onCambio(tiempos, `${c.titulo}: fijo ${tiempos.fijoMin} min cada ${tiempos.cadaMin} min.`); }}>
        <label>Fijo <input type="number" min={1} max={240} value={tiempos.fijoMin} onChange={(e) => setTiempos({ ...tiempos, fijoMin: Number(e.target.value) })} /> minutos</label>
        <label>cada <input type="number" min={2} max={1440} value={tiempos.cadaMin} onChange={(e) => setTiempos({ ...tiempos, cadaMin: Number(e.target.value) })} /> minutos</label>
        <button type="submit" className="btn" disabled={!tiemposCambiados || ocupado}>Guardar tiempos</button>
      </form>
      <small className="admin-panel__hint">Se cuenta desde que aparece {c.cada}. Para probar rápido: fijo 1 minuto cada 3.</small>
    </>}
    <div className="tvcfg-corte__botones">
      <button type="button" className="btn" disabled={ocupado} onClick={() => onCambio({ accion: "fijar" }, `${c.titulo}: fijos desde ahora (${cfg.fijoMin} min).`)}>Fijar ahora</button>
      <button type="button" className="btn" disabled={ocupado} onClick={() => onCambio({ accion: "soltar" }, `${c.titulo}: pasan a la rotación desde ahora.`)}>Pasar a la rotación ahora</button>
    </div>
    {ultimoBoton && cfg.modo === "ciclo" && <small className="admin-panel__hint">{ultimoBoton}</small>}
  </li>;
}
const sinExtension = (nombre) => nombre.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 80);

function Fila({ p, indice, total, onCambiar, onMover, onQuitar }) {
  const tipo = TIPOS[p.tipo];
  return <li className={`tvcfg-fila${p.activo ? "" : " tvcfg-fila--apagada"}`}>
    <div className="tvcfg-fila__orden">
      <button type="button" className="btn btn--ghost" aria-label={`Subir «${p.titulo}»`} disabled={indice === 0} onClick={() => onMover(-1)}><Icono icono={ArrowUp} size={16} /></button>
      <span aria-hidden="true">{indice + 1}</span>
      <button type="button" className="btn btn--ghost" aria-label={`Bajar «${p.titulo}»`} disabled={indice === total - 1} onClick={() => onMover(1)}><Icono icono={ArrowDown} size={16} /></button>
    </div>
    <label className={`demo-interruptor tvcfg-fila__llave${p.activo ? " demo-interruptor--on" : ""}`} title={p.activo ? "Se ve en /tv" : "No se ve en /tv"}>
      <input type="checkbox" role="switch" checked={p.activo} aria-label={`Mostrar «${p.titulo}» en /tv`} onChange={() => onCambiar({ activo: !p.activo })} />
      <span className="demo-interruptor__llave" aria-hidden="true" />
    </label>
    <div className="tvcfg-fila__datos">
      <span className="tvcfg-fila__tipo"><Icono icono={tipo.icono} size={14} /> {tipo.nombre}{p.propia ? "" : " · del sistema"}</span>
      <input className="tvcfg-fila__titulo" value={p.titulo} maxLength={80} aria-label="Título (se ve arriba en /tv)" onChange={(e) => onCambiar({ titulo: e.target.value })} />
      <small>{p.descripcion || (p.tipo === "pagina" ? p.src : p.tipo === "video" ? "Video subido." : "Imagen subida.")}</small>
      <span className="tvcfg-fila__duracion">
        {p.tipo === "video"
          ? "Dura lo que dura el video, sin sonido."
          : <label><input type="number" min={5} max={600} step={1} value={p.duracion || DURACION_PREDETERMINADA} aria-label={`Segundos en pantalla de «${p.titulo}»`}
              onChange={(e) => onCambiar({ duracion: Number(e.target.value) || DURACION_PREDETERMINADA })} /> segundos en pantalla</label>}
      </span>
    </div>
    {p.propia
      ? <button type="button" className="btn btn--ghost tvcfg-fila__quitar" aria-label={`Quitar «${p.titulo}»`} onClick={onQuitar}><Icono icono={Trash2} size={16} /></button>
      : <span className="tvcfg-fila__quitar" />}
  </li>;
}

export default function PantallaTvPage() {
  const { usuario } = useAuth();
  const [lista, setLista] = useState(null);
  const [guardado, setGuardado] = useState({ texto: "", actualizadoEn: null });
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [subida, setSubida] = useState(null); // { nombre, avance }
  const [pagina, setPagina] = useState({ titulo: "", src: "", duracion: DURACION_PREDETERMINADA });
  const [vistaClave, setVistaClave] = useState(0);
  const [cortes, setCortes] = useState(null); // { acp, alertas }: cómo se muestran (ver CorteTipo)
  const [cambiandoCorte, setCambiandoCorte] = useState(null);
  const archivo = useRef(null);

  const cargar = () => getRotacionTv().then((r) => {
    const l = armarRotacion(r.pantallas);
    setLista(l);
    setGuardado({ texto: JSON.stringify(paraGuardar(l)), actualizadoEn: r.actualizadoEn });
    setCortes(r.urgentes ? { acp: configDe(r.urgentes.acp), alertas: configDe(r.urgentes.alertas) } : { acp: configDe(), alertas: configDe() });
  }).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, []);

  // Se guarda en el momento (no espera a «Guardar cambios»): es para cuando hay que cambiarlo ya.
  async function cambiarCorte(clave, cambio, mensaje) {
    setCambiandoCorte(clave); setError("");
    try {
      const { urgentes } = await guardarUrgentesTv({ [clave]: cambio });
      setCortes({ acp: configDe(urgentes.acp), alertas: configDe(urgentes.alertas) });
      notificar("success", `${mensaje} /tv lo toma en menos de 20 s.`);
    } catch (err) { setError(err.message); }
    finally { setCambiandoCorte(null); }
  }

  const cambios = lista && JSON.stringify(paraGuardar(lista)) !== guardado.texto;
  // El navegador avisa si se cierra o recarga con cambios sin guardar.
  useEffect(() => {
    if (!cambios) return undefined;
    const avisar = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [cambios]);

  if (usuario && usuario.rol !== "superadmin") return <Navigate to="/panel" replace />;

  const cambiar = (i, cambio) => setLista((l) => l.map((p, j) => (j === i ? { ...p, ...cambio } : p)));
  const mover = (i, paso) => setLista((l) => {
    const copia = [...l];
    [copia[i], copia[i + paso]] = [copia[i + paso], copia[i]];
    return copia;
  });
  const quitar = async (i) => {
    const p = lista[i];
    if (!(await confirmar({ titulo: `¿Quitar «${p.titulo}»?`, texto: p.tipo === "pagina" ? "Deja de estar en la lista." : "Al guardar, el archivo se borra del servidor.", confirmar: "Quitar", peligro: true }))) return;
    setLista((l) => l.filter((_, j) => j !== i));
  };
  const agregar = (p) => setLista((l) => [...l, { id: nuevoId(), propia: true, activo: true, ...p }]);

  async function alElegirArchivo(e) {
    const elegido = e.target.files?.[0];
    e.target.value = "";
    if (!elegido) return;
    setError(""); setSubida({ nombre: elegido.name, avance: 0 });
    try {
      const { tipo, src } = await subirArchivoTv(elegido, (avance) => setSubida({ nombre: elegido.name, avance }));
      agregar({ tipo, src, titulo: sinExtension(elegido.name) || (tipo === "video" ? "Video" : "Imagen"), ...(tipo === "imagen" ? { duracion: DURACION_PREDETERMINADA } : {}) });
      notificar("info", `«${elegido.name}» subido. Revisá el título y guardá los cambios.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubida(null);
    }
  }

  function agregarPagina(e) {
    e.preventDefault();
    let url;
    try { url = new URL(pagina.src.trim()); } catch { setError("La dirección de la página no es válida (tiene que empezar con https://)."); return; }
    if (!/^https?:$/.test(url.protocol)) { setError("La dirección tiene que empezar con https://"); return; }
    if (!pagina.titulo.trim()) { setError("Poné un título para la página: es lo que se ve arriba en /tv."); return; }
    setError("");
    agregar({ tipo: "pagina", src: url.href, titulo: pagina.titulo.trim(), duracion: pagina.duracion || DURACION_PREDETERMINADA });
    setPagina({ titulo: "", src: "", duracion: DURACION_PREDETERMINADA });
  }

  async function guardar() {
    const vacio = lista.find((p) => !p.titulo.trim());
    if (vacio) { setError("Todas las pantallas necesitan un título."); return; }
    setOcupado(true); setError("");
    try {
      const r = await guardarRotacionTv(paraGuardar(lista));
      const l = armarRotacion(r.pantallas);
      setLista(l);
      setGuardado({ texto: JSON.stringify(paraGuardar(l)), actualizadoEn: r.actualizadoEn });
      setVistaClave((k) => k + 1);
      notificar("success", "Guardado. La pantalla /tv lo toma sola en menos de 20 segundos.");
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  }

  const activas = lista?.filter((p) => p.activo).length || 0;

  return <div className="admin-layout">
    <BrandHeader subtitulo="Pantalla TV"><Link to="/panel/configuracion" className="btn-link">← Configuración</Link></BrandHeader>
    <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading">
        <h1>Pantalla TV</h1>
        <p>Qué se ve en la pantalla de transmisión (<a href="/tv" target="_blank" rel="noreferrer">/tv</a>), en qué orden y cuántos segundos cada cosa. Al guardar, /tv y la transmisión en vivo cambian solas en menos de 20 s, sin recargar. Cómo se muestran los avisos a muy corto plazo y las alertas se elige abajo.</p>
      </div>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      {!lista && !error && <p>Cargando…</p>}
      {lista && <>
        {cortes && <div className="tvcfg-cortes">
          <h2>Avisos y alertas en /tv</h2>
          <ul className="tvcfg-cortes__lista">
            {CORTES.map((c) => <CorteTipo key={c.clave} c={c} cfg={cortes[c.clave]} ocupado={cambiandoCorte === c.clave} onCambio={(cambio, mensaje) => cambiarCorte(c.clave, cambio, mensaje)} />)}
          </ul>
          <p className="admin-panel__hint">Cuando está fijo, corta la rotación y se ve a pantalla completa; si no, sale como una pantalla más de la rotación (el video que esté pasando no se corta). Todo se guarda en el momento, sin tocar «Guardar cambios».</p>
          <h2>Rotación</h2>
        </div>}
        {activas === 0 && <div className="alert alert--warn" role="status">No hay ninguna pantalla prendida: /tv muestra el pronóstico.</div>}
        <ol className="tvcfg-lista">
          {lista.map((p, i) => <Fila key={p.id} p={p} indice={i} total={lista.length}
            onCambiar={(c) => cambiar(i, c)} onMover={(paso) => mover(i, paso)} onQuitar={() => quitar(i)} />)}
        </ol>

        <div className="admin-acciones tvcfg-guardar">
          <button type="button" className="btn btn--primary btn--block" disabled={!cambios || ocupado || !!subida} onClick={guardar}>{ocupado ? "Guardando…" : "Guardar cambios"}</button>
          <button type="button" className="btn btn--block" disabled={!cambios || ocupado} onClick={cargar}>Descartar cambios</button>
        </div>
        <p className="admin-panel__hint">{cambios ? "Hay cambios sin guardar." : guardado.actualizadoEn ? `Guardado ${tiempoRelativo(guardado.actualizadoEn)}.` : "Todavía no se guardó nada: /tv usa la rotación de siempre."}</p>

        <h2>Agregar</h2>
        <div className="field">
          <span>Video o imagen</span>
          <input ref={archivo} type="file" accept="video/mp4,video/webm,image/png,image/jpeg,image/webp" hidden onChange={alElegirArchivo} />
          <button type="button" className="btn btn--block" disabled={!!subida} onClick={() => archivo.current?.click()}>
            <Icono icono={Video} size={16} /> Subir un video o una imagen
          </button>
          {subida && <div className="tvcfg-subida" role="status">
            <span>Subiendo «{subida.nombre}»… {Math.round(subida.avance * 100)} %</span>
            <progress max={1} value={subida.avance} />
          </div>}
          <small>Videos MP4 o WebM (hasta 500 MB; a pantalla completa, sin sonido, duran lo que dure el video). Imágenes JPG, PNG o WebP (hasta 20 MB; conviene 16:9, por ejemplo 1920×1080).</small>
        </div>
        <form className="tvcfg-pagina" onSubmit={agregarPagina}>
          <span className="tvcfg-pagina__titulo">Página de otro sitio</span>
          <label className="field"><span>Título</span><input value={pagina.titulo} maxLength={80} placeholder="Ej.: Radar del SMN" onChange={(e) => setPagina({ ...pagina, titulo: e.target.value })} /></label>
          <label className="field"><span>Dirección</span><input type="url" value={pagina.src} placeholder="https://…" onChange={(e) => setPagina({ ...pagina, src: e.target.value })} /></label>
          <label className="field"><span>Segundos en pantalla</span><input type="number" min={5} max={600} value={pagina.duracion} onChange={(e) => setPagina({ ...pagina, duracion: Number(e.target.value) || DURACION_PREDETERMINADA })} /></label>
          <button type="submit" className="btn btn--block"><Icono icono={Globe} size={16} /> Agregar la página</button>
          <small className="admin-panel__hint">Muchos sitios no se dejan mostrar dentro de otra página: si en la vista previa queda en blanco o con un error, ese sitio no se puede usar.</small>
        </form>
      </>}
    </section>
    <div className="admin-map-area placa-workspace">
      <div className="placa-toolbar"><span>Vista de /tv con lo guardado</span></div>
      <div className="placa-content demo-vista">
        <VistaEscalada key={vistaClave} src="/tv" ancho={1920} alto={1080} titulo="Pantalla de transmisión" />
      </div>
    </div>
  </div>;
}
