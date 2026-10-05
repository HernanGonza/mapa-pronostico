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
  { clave: "acp", titulo: "Avisos a muy corto plazo", detalle: "Cuando hay un ACP publicado, corta la rotación y lo muestra a pantalla completa." },
  { clave: "alertas", titulo: "Alertas meteorológicas", detalle: "Cuando hay una alerta vigente (la nuestra o una del SMN publicada), corta la rotación y la muestra a pantalla completa." },
];
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
  const [cortes, setCortes] = useState(null); // { acp, alertas }: si cortan la rotación
  const [cambiandoCorte, setCambiandoCorte] = useState(null);
  const archivo = useRef(null);

  const cargar = () => getRotacionTv().then((r) => {
    const l = armarRotacion(r.pantallas);
    setLista(l);
    setGuardado({ texto: JSON.stringify(paraGuardar(l)), actualizadoEn: r.actualizadoEn });
    setCortes(r.urgentes || { acp: true, alertas: true });
  }).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, []);

  // Se guarda en el momento (no espera a «Guardar cambios»): es para cuando hay que apagarlo ya.
  async function cambiarCorte(clave) {
    setCambiandoCorte(clave); setError("");
    try {
      const { urgentes } = await guardarUrgentesTv({ [clave]: !cortes[clave] });
      setCortes(urgentes);
      notificar("success", urgentes[clave] ? "Prendido: vuelve a cortar la rotación (en menos de 20 s)." : "Apagado: la rotación sigue sin cortarse (en menos de 20 s).");
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

  if (usuario && usuario.rol !== "superadmin") return <Navigate to="/panel/configuracion" replace />;

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
        <p>Qué se ve en la pantalla de transmisión (<a href="/tv" target="_blank" rel="noreferrer">/tv</a>), en qué orden y cuántos segundos cada cosa. Al guardar, /tv y la transmisión en vivo cambian solas en menos de 20 s, sin recargar. Los avisos a muy corto plazo y las alertas cortan la rotación para verse a pantalla completa, salvo que lo apagues abajo.</p>
      </div>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      {!lista && !error && <p>Cargando…</p>}
      {lista && <>
        {cortes && <div className="tvcfg-cortes">
          <h2>Cortar la rotación</h2>
          <ul className="tvcfg-lista">
            {CORTES.map((c) => <li key={c.clave} className={`tvcfg-fila tvcfg-fila--corte${cortes[c.clave] ? "" : " tvcfg-fila--apagada"}`}>
              <label className={`demo-interruptor tvcfg-fila__llave${cortes[c.clave] ? " demo-interruptor--on" : ""}`}>
                <input type="checkbox" role="switch" checked={cortes[c.clave]} disabled={cambiandoCorte === c.clave} aria-label={`${c.titulo}: cortar la rotación`} onChange={() => cambiarCorte(c.clave)} />
                <span className="demo-interruptor__llave" aria-hidden="true" />
              </label>
              <div className="tvcfg-fila__datos">
                <strong>{c.titulo}</strong>
                <small>{cortes[c.clave] ? c.detalle : "Apagado: no corta la rotación; el video o el mapa que esté pasando sigue. (El mapa de alertas igual sale en la rotación si está prendido abajo.)"}</small>
              </div>
            </li>)}
          </ul>
          <p className="admin-panel__hint">Se guarda en el momento, sin tocar «Guardar cambios».</p>
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
