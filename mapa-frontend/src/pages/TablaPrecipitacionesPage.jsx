import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import VolverConfiguracion from "../components/VolverConfiguracion";
import EmbedShare from "../components/EmbedShare";
import PlanillaPrecipitaciones from "../components/PlanillaPrecipitaciones";
import EstacionesPrecipitaciones from "../components/EstacionesPrecipitaciones";
import ImportarPrecipitaciones from "../components/ImportarPrecipitaciones";
import InformePrecipitaciones from "../components/InformePrecipitaciones";
import Modal from "../components/Modal";
import * as api from "../api";
import { confirmar, notificar } from "../lib/ui";
import { AR, MESES, REDES, ddmmaaaa, hoy, indexar, leerNumero, mesAnterior, mesDe, mesSiguiente, normal, primerDia, ultimoDia } from "../lib/precipitacionesCalculo";
import "./precipitaciones.css";

/**
 * Monitoreo de lluvias (módulo «Monitoreo de lluvias»): reemplaza al Excel. Una hoja por mes con las estaciones en columnas y los días en filas
 * (se escribe o se pega desde Excel), con los totales, la media y la anomalía calculados. Además: las estaciones (con su ubicación y sus medias
 * mensuales) y la importación del Excel de antes. De acá sale la página pública (tabla y mapa) y el informe.
 */
const aTexto = (v) => (v == null ? "" : String(v).replace(".", ","));

export default function TablaPrecipitacionesPage() {
  const [pestana, setPestana] = useState("planilla");
  const [periodo, setPeriodo] = useState(() => mesDe(hoy()));
  const [datos, setDatos] = useState(null), [error, setError] = useState("");
  const [texto, setTexto] = useState(() => new Map()); // celdas escritas y todavía sin guardar: «id|fecha» → texto
  const [q, setQ] = useState(""), [red, setRed] = useState(""), [inactivas, setInactivas] = useState(false);
  const [guardando, setGuardando] = useState(false), [bajando, setBajando] = useState(false);
  const [params, setParams] = useSearchParams();
  const [informe, setInforme] = useState(() => params.get("informe") === "1"), [compartir, setCompartir] = useState(false);
  const [estado, setEstado] = useState(null), [publicando, setPublicando] = useState(false); // última publicación y cambios sin publicar

  const cargarEstado = useCallback(() => api.getEstadoPublicacionPrecipitaciones().then(setEstado).catch(() => {}), []);
  // Planilla (borrador) del mes; cada vez que cambia algo se vuelve a contar lo que falta publicar.
  const cargar = useCallback(() => Promise.all([api.getPrecipitacionesBorrador({ desde: primerDia(periodo.anio, periodo.mes), hasta: ultimoDia(periodo.anio, periodo.mes) })
    .then((d) => { setDatos(d); setError(""); }).catch((e) => setError(e.message)), cargarEstado()]), [periodo, cargarEstado]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (!texto.size) return undefined;
    const aviso = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [texto.size]);

  const base = useMemo(() => indexar(datos?.diarias || []), [datos]);
  // Lo guardado + lo que se está escribiendo: de ahí salen los totales, la media y la anomalía en vivo.
  const mapa = useMemo(() => {
    const m = new Map(base);
    for (const [k, t] of texto) { const n = leerNumero(t); if (n === null) m.delete(k); else if (Number.isFinite(n) && n >= 0 && n <= 1500) m.set(k, n); }
    return m;
  }, [base, texto]);
  const invalidas = useMemo(() => [...texto.values()].filter((t) => { const n = leerNumero(t); return n !== null && !(Number.isFinite(n) && n >= 0 && n <= 1500); }).length, [texto]);

  const alEditar = useCallback((id, fecha, valor) => setTexto((prev) => {
    const k = `${id}|${fecha}`, guardado = base.has(k) ? aTexto(base.get(k)) : "", n = new Map(prev);
    if (valor === guardado || (leerNumero(valor) !== null && leerNumero(valor) === base.get(k))) n.delete(k); else n.set(k, valor);
    return n;
  }), [base]);

  const visibles = useMemo(() => (datos?.estaciones || []).filter((e) => (inactivas || e.activa) && (!red || e.red === Number(red)) && (!q.trim() || normal(e.nombre).includes(normal(q.trim())))), [datos, inactivas, red, q]);

  async function guardar() {
    if (invalidas) { setError("Hay celdas con un valor que no es válido (marcadas en rojo): corregilas antes de guardar."); return; }
    setGuardando(true); setError("");
    try {
      const cambios = [...texto].map(([k, t]) => { const [id, fecha] = k.split("|"); return { estacionId: Number(id), fecha, mm: leerNumero(t) }; });
      await api.guardarPrecipitacionesDiarias(cambios);
      setTexto(new Map()); await cargar(); notificar("success", `${cambios.length} ${cambios.length === 1 ? "celda guardada" : "celdas guardadas"}.`);
    } catch (e) { setError(e.message); }
    finally { setGuardando(false); }
  }
  useEffect(() => {
    const tecla = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s" && texto.size) { e.preventDefault(); guardar(); } };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });
  const cambiarMes = (p) => { setPeriodo(p); };
  const abrirInforme = (v) => { setInforme(v); if (params.has("informe")) setParams({}, { replace: true }); };
  async function publicar() {
    if (texto.size) { setError("Tenés cambios sin guardar en la planilla: guardalos antes de publicar."); return; }
    setError("");
    const p = estado?.pendientes;
    const lineas = p ? [p.diasNuevos && `${p.diasNuevos} ${p.diasNuevos === 1 ? "día nuevo" : "días nuevos"}`, p.diasCambiados && `${p.diasCambiados} ${p.diasCambiados === 1 ? "día corregido" : "días corregidos"}`, p.diasQuitados && `${p.diasQuitados} ${p.diasQuitados === 1 ? "día quitado" : "días quitados"}`,
      p.estaciones && `${p.estaciones} ${p.estaciones === 1 ? "cambio" : "cambios"} en estaciones`, p.medias && `${p.medias} ${p.medias === 1 ? "cambio" : "cambios"} en medias`].filter(Boolean) : [];
    const ok = await confirmar({ titulo: "¿Publicar en la página?", confirmar: "Publicar ahora",
      html: `<p>Se van a actualizar <strong>la tabla pública y el mapa</strong> del sitio con lo que hay cargado en la planilla${p?.ultimaFecha ? ` (hasta el ${ddmmaaaa(p.ultimaFecha)})` : ""}.</p>${lineas.length ? `<ul style="text-align:left">${lineas.map((l) => `<li>${l}</li>`).join("")}</ul>` : ""}<p>Cualquiera que abra la página va a ver estos datos.</p>` });
    if (!ok) return;
    setPublicando(true);
    try { await api.publicarPrecipitaciones(); await cargarEstado(); notificar("success", "Publicado: la tabla y el mapa ya muestran los datos nuevos."); }
    catch (e) { setError(e.message); }
    finally { setPublicando(false); }
  }
  async function excel() {
    setBajando(true); setError("");
    try { await api.descargarExcelPrecipitaciones({ desde: primerDia(periodo.anio, periodo.mes), hasta: ultimoDia(periodo.anio, periodo.mes), estaciones: visibles.map((e) => e.id), borrador: true }); }
    catch (e) { setError(e.message); } finally { setBajando(false); }
  }
  const anios = useMemo(() => { const a = mesDe(hoy()).anio; return Array.from({ length: 8 }, (_, i) => a + 1 - i); }, []);

  return <div className="admin-layout admin-layout--sin-mapa prec-admin">
    <BrandHeader subtitulo="Monitoreo de lluvias"><VolverConfiguracion /></BrandHeader>
    <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="prec-cab">
        <div><h1>Monitoreo de lluvias</h1>
          <p>Reemplaza al Excel: cargá la lluvia de cada día por estación (o pegá desde Excel) y los totales, la media y la anomalía se calculan solos. Lo cargado es un borrador: la tabla y el mapa de la página cambian recién cuando tocás «Publicar».</p></div>
        <div className="prec-cab__acciones">
          <button type="button" className="prec-btn" onClick={() => setCompartir(true)}>Compartir en el sitio web</button>
          <button type="button" className="prec-btn" aria-expanded={informe} aria-controls="prec-cajon-informe" onClick={() => abrirInforme(!informe)}>Armar informe</button>
          <button type="button" className="prec-btn prec-btn--primario" disabled={publicando || !estado || estado.total === 0} onClick={publicar}
            title={estado?.total === 0 ? "No hay cambios sin publicar" : "Actualiza la tabla y el mapa públicos"}>{publicando ? "Publicando…" : "Publicar en la tabla y el mapa"}</button>
        </div>
      </div>
      {estado && <div className="prec-publicacion" role="status">
        {estado.ultima ? <span>Última publicación: <strong>{new Date(estado.ultima.publicadoEn).toLocaleString("es-AR", { timeZone: AR, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} h</strong>{estado.ultima.por && ` · ${estado.ultima.por}`}</span> : <span><strong>Todavía no se publicó nada</strong>: la tabla y el mapa de la página están vacíos.</span>}
        {estado.total > 0 ? <span className="prec-pendientes">{estado.total} {estado.total === 1 ? "cambio" : "cambios"} sin publicar</span> : estado.ultima && <span>Todo publicado ✓</span>}
      </div>}
      <div className="prec-pestanas" role="tablist" aria-label="Secciones">
        {[["planilla", "Planilla"], ["estaciones", "Estaciones y medias"], ["importar", "Importar Excel"]].map(([id, t]) => <button key={id} type="button" role="tab" aria-selected={pestana === id} className={pestana === id ? "prec-pestana prec-pestana--on" : "prec-pestana"} onClick={() => setPestana(id)}>{t}</button>)}
      </div>
      {error && <div className="risk-message risk-message--error" role="alert">{error}</div>}

      {pestana === "planilla" && <>
        <div className="prec-barra">
          <div className="prec-mes" role="group" aria-label="Mes">
            <button type="button" className="prec-btn" aria-label="Mes anterior" onClick={() => cambiarMes(mesAnterior(periodo))}>‹</button>
            <select aria-label="Mes" value={periodo.mes} onChange={(e) => cambiarMes({ ...periodo, mes: Number(e.target.value) })}>{MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            <select aria-label="Año" value={periodo.anio} onChange={(e) => cambiarMes({ ...periodo, anio: Number(e.target.value) })}>{[...new Set([...anios, periodo.anio])].sort((a, b) => b - a).map((a) => <option key={a}>{a}</option>)}</select>
            <button type="button" className="prec-btn" aria-label="Mes siguiente" onClick={() => cambiarMes(mesSiguiente(periodo))}>›</button>
            <button type="button" className="prec-btn" onClick={() => cambiarMes(mesDe(hoy()))}>Este mes</button>
          </div>
          <input type="search" className="prec-buscar" aria-label="Buscar estación" placeholder="Buscar estación…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Red" value={red} onChange={(e) => setRed(e.target.value)}><option value="">Todas las redes</option>{Object.entries(REDES).map(([v, t]) => <option key={v} value={v}>{v} · {t}</option>)}</select>
          <label className="prec-check"><input type="checkbox" checked={inactivas} onChange={(e) => setInactivas(e.target.checked)} /> Mostrar inactivas</label>
          <span className="prec-espacio" />
          <button type="button" className="prec-btn" disabled={bajando || !visibles.length} onClick={excel}>{bajando ? "Armando…" : "Descargar Excel"}</button>
          {texto.size > 0 && <><button type="button" className="prec-btn" disabled={guardando} onClick={() => setTexto(new Map())}>Descartar</button>
            <button type="button" className="prec-btn prec-btn--primario" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : `Guardar cambios (${texto.size})`}</button></>}
        </div>
        {datos === null ? <p role="status">{error ? "" : "Cargando…"}</p>
          : !datos.estaciones.length ? <div className="prec-vacio">Todavía no hay estaciones. Importá el Excel de antes (pestaña «Importar Excel») o agregalas en «Estaciones y medias».</div>
          : !visibles.length ? <div className="prec-vacio">Ninguna estación coincide con el filtro.</div>
          : <PlanillaPrecipitaciones estaciones={visibles} todas={datos.estaciones} mapa={mapa} texto={texto} anio={periodo.anio} mes={periodo.mes} alEditar={alEditar} hoy={hoy()} />}
        <p className="prec-ayuda">Enter o ↓ baja a la celda de abajo; podés pegar un bloque copiado de Excel en cualquier celda. Ctrl+S guarda. Vacío = sin dato.</p>
      </>}

      {pestana === "estaciones" && datos && <EstacionesPrecipitaciones estaciones={datos.estaciones} alCambiar={cargar} alError={setError} />}
      {pestana === "importar" && datos && <ImportarPrecipitaciones existentes={datos.estaciones} alImportar={cargar} alError={setError} />}

    </section>

    <Modal abierto={compartir} alCerrar={() => setCompartir(false)} titulo="Compartir en el sitio web" ancho={680}>
      <p className="prec-ayuda">Copiá el enlace o el código para embeber (iframe) y pegalo en la página. Los dos muestran lo <strong>publicado</strong>: se actualizan solos cuando tocás «Publicar».</p>
      <EmbedShare path="/embed/precipitaciones" title="Precipitaciones · Misiones" kind="historico" height={720} heading="Tabla" hint="La planilla por mes y el resumen de un período, con búsqueda y filtros." linkLabel="Enlace a la tabla pública" openLabel="Abrir la tabla ↗" />
      <EmbedShare path="/embed/precipitaciones-mapa" title="Mapa de precipitaciones · Misiones" kind="mapa" height={640} heading="Mapa" hint="Las estaciones con ubicación; al tocar una se ven sus últimos 10 días." linkLabel="Enlace al mapa" openLabel="Abrir el mapa ↗" />
    </Modal>
    <InformePrecipitaciones abierto={informe} alCerrar={() => abrirInforme(false)} />
  </div>;
}
