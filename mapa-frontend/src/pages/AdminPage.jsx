import PublicationStatus from "../components/PublicationStatus";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PlacaPreview from "../components/PlacaPreview";
import BaseMap from "../components/BaseMap";
import { colorUniforme, infoPronostico } from "../components/PronosticoMapContent";
import EmbedShare from "../components/EmbedShare";
import { crearPlacaPronostico, publicarPronosticoPorPasos } from "../lib/asistentesPronostico";
import PronosticoPublicado, { usePublicado, origenDe } from "../components/PronosticoPublicado";
import BrandHeader from "../components/BrandHeader";
import InformePronostico, { aMapa, borradorConAlgo, borradorVacio, conCampo, problemasParaMapa } from "../components/InformePronostico";
import InformePlantilla from "../components/InformePlantilla";
import { borradorDesdeUltimo, nombreDeBoton } from "../lib/informePlantillas";
import TarjetaInformePronostico, { estadoDeInforme } from "../components/TarjetaInformePronostico";
import { useInformesPronostico } from "../lib/useInformesPronostico";
import { calcularCambios } from "../lib/cambiosPronostico";
import { enviarPronosticoPorCorreo, editarDestinatariosPorPasos } from "../lib/asistenteCorreo";
import { notificar, confirmar } from "../lib/ui";
import { useAuth } from "../context/AuthContext";
import { puedeUsar } from "../lib/modulos";
import {
  generarInformePdf,
  generarInformeDocxPronostico,
  generarInformeRtfPronostico,
  enviarInformePorCorreo,
  marcarInformePublicado,
  getCorreoEstado,
  getCorreoDestinatarios,
  guardarCorreoDestinatarios,
  publicar,
  generarPronosticoPlaca,
  getUltimaPlacaPronostico,
  getActual,
  getMapaPreview,
  getMunicipiosGeojson,
} from "../api";
import { tiempoRelativo, fechaLarga } from "../lib/tiempoRelativo";

// Placa del pronóstico para redes: estuvo desactivada (pedido 02/10); vuelve el 04/10 con el estilo
// nuevo, sobre las fotos de las placas diarias.
const PLACA_REDES_ACTIVA = true;
// …pero todavía NO se publica en redes (06/10: las placas no están aprobadas). Se generan y se
// descargan para revisarlas. El backend también lo frena (routes/redes.js, PRONOSTICO_EN_REDES).
const PRONOSTICO_EN_REDES = false;

function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

const CLAVE_NUEVO = "pronostico-informe-nuevo-v1";
const CLAVE_SESION = "pronostico-informe-sesion-v1";

export default function AdminPage() {
  const [publicado, setPublicado] = useState(null); // lo que muestran ahora los mapas públicos: { publicadoEn, filas, extendido, fechaPronostico }
  const metaPublicado = usePublicado(publicado?.publicadoEn); // desde dónde se hizo lo publicado (panel o ensamble) y quién
  const [municipiosPreview, setMunicipiosPreview] = useState(null);
  const [municipiosGeojson, setMunicipiosGeojson] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);
  const [imagenes, setImagenes] = useState(null);
  const [vista, setVista] = useState("mapa");
  // Los informes del día: varios por día, cada uno es una tarjeta (guardada en el servidor). El cajón edita el que se abre.
  const { usuario } = useAuth();
  const inf = useInformesPronostico();
  const { informes } = inf;
  const [abiertoId, setAbiertoId] = useState(() => { try { return JSON.parse(localStorage.getItem(CLAVE_SESION))?.abiertoId ?? null; } catch { return null; } }); // id de un informe guardado, o "nuevo" (el que se está armando y todavía no se guardó)
  // Un informe nuevo no es una tarjeta hasta que se guarda (último paso del cajón): mientras tanto es sólo un borrador que no se pierde al cerrar.
  const [nuevo, setNuevo] = useState(() => { try { return JSON.parse(localStorage.getItem(CLAVE_NUEVO))?.borrador || null; } catch { return null; } });
  const [guardandoNuevo, setGuardandoNuevo] = useState(false);
  const [eligiendo, setEligiendo] = useState(() => { try { return !!JSON.parse(localStorage.getItem(CLAVE_SESION))?.eligiendo; } catch { return false; } }); // la pantalla inicial del cajón: los 5 tipos de informe
  useEffect(() => { try { if (nuevo) localStorage.setItem(CLAVE_NUEVO, JSON.stringify({ borrador: nuevo })); else localStorage.removeItem(CLAVE_NUEVO); } catch { /* sin almacenamiento */ } }, [nuevo]);
  // Qué informe está abierto, en qué paso y si el cajón está desplegado se recuerda al irse de la pantalla (el borrador nuevo ya se guarda aparte).
  const [sesion] = useState(() => { try { return JSON.parse(localStorage.getItem(CLAVE_SESION)) || {}; } catch { return {}; } });
  const [cajon, setCajon] = useState(!!sesion.cajon);
  const [paso, setPaso] = useState(sesion.paso || 0);
  // La barra de tarjetas se puede plegar para ver el mapa o el ensamble a todo el ancho (se recuerda entre visitas).
  // El ensamble también se abre en un cajón, a la izquierda sobre las tarjetas (2/3 de la pantalla; el informe, 1/3 a la derecha). El iframe se arma la primera vez y queda, así no se pierde la consulta al ocultarlo.
  const [ensambleAbierto, setEnsambleAbierto] = useState(() => { try { return localStorage.getItem("pronostico-ensamble-cajon") === "abierto"; } catch { return false; } });
  const [ensamblePedido, setEnsamblePedido] = useState(ensambleAbierto);
  const alternarEnsamble = (abrir) => { setEnsambleAbierto(abrir); if (abrir) setEnsamblePedido(true); try { localStorage.setItem("pronostico-ensamble-cajon", abrir ? "abierto" : "cerrado"); } catch { /* sin almacenamiento */ } };
  const [lateralCerrado, setLateralCerrado] = useState(() => { try { return localStorage.getItem("pronostico-lateral") === "cerrado"; } catch { return false; } });
  const alternarLateral = () => setLateralCerrado((c) => { const n = !c; try { localStorage.setItem("pronostico-lateral", n ? "cerrado" : "abierto"); } catch { /* sin almacenamiento */ } return n; });
  const [vistaId, setVistaId] = useState(undefined); // el informe cuyo mapa se ve acá (undefined = todavía no se eligió; null = lo publicado)
  const mapaRef = useRef(null);
  const [correo, setCorreo] = useState(null); // { configurado, remitente, via } del servidor
  useEffect(() => { getCorreoEstado().then(setCorreo).catch(() => {}); }, []);

  // «Placa para redes» muestra la última placa generada (también al volver a la página).
  useEffect(() => {
    let vivo = true;
    getUltimaPlacaPronostico().then((placa) => { if (vivo && placa) setImagenes({ feed: placa.feedUrl, historias: placa.historiasUrl, feedNombre: placa.feedNombre, historiasNombre: placa.historiasNombre }); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  useEffect(() => { getMunicipiosGeojson().then(setMunicipiosGeojson).catch(() => {}); }, []);
  useEffect(() => { getActual().then((actual) => { if (actual) setPublicado(actual); }).catch(() => {}); }, []);

  // Al abrir la pantalla, el mapa muestra el informe que está en los mapas ahora (o, si no hay, el más reciente).
  useEffect(() => {
    if (vistaId !== undefined || !informes) return;
    const ahora = informes.find((i) => publicado && i.meta?.publicadoEn && new Date(i.meta.publicadoEn).getTime() === new Date(publicado.publicadoEn).getTime());
    setVistaId(ahora?.id ?? null);
  }, [informes, publicado, vistaId]);

  useEffect(() => { try { localStorage.setItem(CLAVE_SESION, JSON.stringify({ abiertoId, paso, cajon, eligiendo })); } catch { /* sin almacenamiento */ } }, [abiertoId, paso, cajon, eligiendo]);

  const informeAbierto = abiertoId === "nuevo" ? (nuevo ? { id: null, borrador: nuevo, meta: {} } : null) : informes?.find((i) => i.id === abiertoId) || null;
  const informeVista = informes?.find((i) => i.id === vistaId) || null;
  // El mapa de acá muestra el informe elegido si está completo; si no (o si no hay ninguno elegido), lo publicado.
  const datosVista = useMemo(() => (informeVista && !problemasParaMapa(informeVista.borrador).length ? aMapa(informeVista.borrador) : null), [informeVista]);
  const filas = datosVista?.filas ?? publicado?.filas ?? null;
  const extendido = datosVista ? datosVista.extendido : publicado?.extendido || null;
  const fechaPronostico = datosVista?.fecha ?? (publicado?.fechaPronostico ? String(publicado.fechaPronostico).slice(0, 10) : "");

  useEffect(() => {
    if (!filas) return;
    const t = setTimeout(() => { getMapaPreview(filas, extendido).then(setMunicipiosPreview).catch((err) => setError(err.message)); }, 400);
    return () => clearTimeout(t);
  }, [filas, extendido]);

  const cambios = useMemo(() => calcularCambios(filas || [], publicado?.filas), [filas, publicado]);
  const fechaCambiada = !!filas && fechaPronostico !== (publicado?.fechaPronostico ? String(publicado.fechaPronostico).slice(0, 10) : "");
  const sucio = !!filas && (!publicado || !!cambios?.length || fechaCambiada);

  const aviso = (msg) => { setMensajeOk(msg); setError(null); };
  const fallo = (e) => { setError(e.message); setMensajeOk(null); };

  // --- Acciones de las tarjetas ---
  /** Abre el cajón con un informe nuevo SIN guardar (si ya había uno a medias, sigue con ese). */
  function nuevoInforme(borrador) {
    // Sólo se vuelve al primer paso si es otro informe; si sigue con el que estaba a medias, queda en el paso donde estaba.
    if (borrador) { setNuevo(borrador); setEligiendo(false); setPaso(0); }
    else if (nuevo && borradorConAlgo(nuevo)) { setEligiendo(false); if (abiertoId !== "nuevo") setPaso(0); } // sigue con el que estaba a medias
    else { setNuevo(null); setEligiendo(true); setPaso(0); }
    setAbiertoId("nuevo"); setCajon(true);
  }
  /** Eligió uno de los 5 tipos en la pantalla inicial del cajón. */
  function elegirTipo(botonId) {
    const ultimo = [...(informes || [])].filter((i) => i.borrador?.version === 2)
      .sort((a, b) => Date.parse(b.creadoEn || 0) - Date.parse(a.creadoEn || 0) || b.id - a.id)[0];
    setNuevo(borradorDesdeUltimo(botonId, ultimo)); setEligiendo(false); setPaso(0);
  }
  async function cambiarTipo() {
    if (nuevo && borradorConAlgo(nuevo) && !(await confirmar({ titulo: "¿Cambiar el tipo de informe?", texto: "Se descarta lo que escribiste en este informe sin guardar.", confirmar: "Descartar y elegir", peligro: true }))) return;
    setNuevo(null); setEligiendo(true); setPaso(0);
  }
  async function guardarNuevo() {
    if (!nuevo || guardandoNuevo) return;
    setGuardandoNuevo(true);
    try {
      const n = await inf.crear(nuevo);
      setNuevo(null); setAbiertoId(null); setVistaId(n.id); setCajon(false);
      aviso(`Informe #${n.id} guardado: ya es una tarjeta de la pila.`);
    } catch (e) { fallo(e); } finally { setGuardandoNuevo(false); }
  }
  /** Cierra el informe abierto y no deja nada pegado: uno nuevo sin guardar se descarta (con aviso si ya tenía algo); uno guardado ya está en su tarjeta. */
  async function cancelarInforme() {
    if (abiertoId === "nuevo") {
      if (nuevo && borradorConAlgo(nuevo) && !(await confirmar({ titulo: "¿Cancelar este informe?", texto: "Se descarta lo que escribiste: todavía no está guardado.", confirmar: "Descartar", peligro: true }))) return;
      setNuevo(null);
    }
    setEligiendo(false); setAbiertoId(null); setCajon(false); setPaso(0);
  }
  function editar(i) {
    if (abiertoId !== i.id) setPaso(0);
    setAbiertoId(i.id); setVistaId(i.id); setCajon(true);
  }
  async function duplicar(i) {
    if (nuevo && borradorConAlgo(nuevo) && !(await confirmar({ titulo: "Hay un informe sin guardar", texto: "Si seguís, se descarta para empezar con la copia.", confirmar: "Descartar y seguir", peligro: true }))) return;
    nuevoInforme(structuredClone(i.borrador));
  }
  async function borrarInforme(i) {
    if (!(await confirmar({ titulo: `¿Borrar el informe #${i.id}?`, texto: i.meta?.publicadoEn ? "Ya se publicó en los mapas: borrarlo no cambia lo que se ve ahora, sólo saca la tarjeta." : "Se pierde lo escrito.", confirmar: "Borrar", peligro: true }))) return;
    try { await inf.borrar(i.id); if (abiertoId === i.id) { setCajon(false); setAbiertoId(null); } if (vistaId === i.id) setVistaId(null); } catch (e) { fallo(e); }
  }

  async function verPdf(i, bajar = false) {
    setError(null);
    try {
      const blob = await generarInformePdf(i.borrador), url = URL.createObjectURL(blob);
      if (bajar) { const a = Object.assign(document.createElement("a"), { href: url, download: `PREVISION DEL TIEMPO ${i.borrador.fecha}.pdf` }); document.body.append(a); a.click(); a.remove(); }
      else window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { fallo(e); }
  }

  async function bajarRtf(i, viejo = false) {
    setError(null);
    try {
      {
        const url = URL.createObjectURL(await generarInformeRtfPronostico(i.borrador, viejo));
        const a = Object.assign(document.createElement("a"), { href: url, download: `PREVISION DEL TIEMPO ${i.borrador.fecha} ${nombreDeBoton(i.borrador.boton)}${viejo ? " (formato viejo)" : ""}.rtf` }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (e) { fallo(e); }
  }
  async function bajarDocx(i, viejo = false) {
    setError(null);
    try {
      {
        const url = URL.createObjectURL(await generarInformeDocxPronostico(i.borrador, viejo));
        const a = Object.assign(document.createElement("a"), { href: url, download: `PREVISION DEL TIEMPO ${i.borrador.fecha} ${nombreDeBoton(i.borrador.boton)}${viejo ? " (formato viejo)" : ""}.docx` }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (e) { fallo(e); }
  }

  const publicarInforme = async (i) => {
    if (problemasParaMapa(i.borrador).length) return;
    const m = aMapa(i.borrador);
    const cambiosI = calcularCambios(m.filas, publicado?.filas);
    const fechaI = m.fecha !== (publicado?.fechaPronostico ? String(publicado.fechaPronostico).slice(0, 10) : "");
    const esActual = estadoDeInforme(i, publicado).enMapas;
    await inf.guardarYa(i.id);
    return publicarPronosticoPorPasos({
      cantidad: m.filas.length, sinPublicar: !publicado, fecha: m.fecha, fechaCambiada: fechaI, cambios: cambiosI, republicar: esActual && !cambiosI?.length && !fechaI,
      // Si lo publicado se hizo desde el ensamble, se avisa: esto lo reemplaza (así no se pisa sin querer lo que armó el otro).
      publicadoDesde: metaPublicado?.origen === "ensamble" ? `${origenDe(metaPublicado).toLowerCase()}, el ${new Date(metaPublicado.publicadoEn).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}${metaPublicado.publicadoPor ? ` por ${metaPublicado.publicadoPor}` : ""}` : null,
      publicar: async () => {
        const p = await publicar(m.filas, m.fecha, m.extendido);
        setPublicado(p); setVistaId(i.id);
        try { inf.mezclar(await marcarInformePublicado(i.id, p.publicadoEn)); } catch { await inf.refrescarMeta(i.id); }
        aviso(`Publicado el informe #${i.id}. Los mapas públicos ya muestran esta versión.`);
      },
    });
  };

  const crearPlaca = (i) => {
    if (problemasParaMapa(i.borrador).length) return;
    const m = aMapa(i.borrador);
    return crearPlacaPronostico({
      enRedes: PRONOSTICO_EN_REDES,
      epigrafe: `Previsión del tiempo · ${m.fecha.split("-").reverse().join("/")}`, filas: m.filas,
      vistaPrevia: (valores) => generarPronosticoPlaca(m.filas, m.fecha, { ...valores, vistaPrevia: true, informeId: i.id }),
      guardar: async (token, valores) => {
        const placa = await generarPronosticoPlaca(m.filas, m.fecha, { ...valores, confirmarToken: token, informeId: i.id });
        setImagenes({ feed: placa.feedUrl, historias: placa.historiasUrl, feedNombre: placa.feedNombre, historiasNombre: placa.historiasNombre });
        setVista("placa"); setVistaId(i.id); inf.refrescarMeta(i.id);
        return placa;
      },
    });
  };
  const verPlaca = (i) => {
    const pl = i.meta?.placa;
    if (!pl) return;
    setImagenes({ feed: pl.feedUrl, historias: pl.historiasUrl, feedNombre: pl.feedNombre, historiasNombre: pl.historiasNombre });
    setVista("placa"); setVistaId(i.id);
  };

  // Correo: la lista y el estado se piden al abrir, así siempre están al día. El PDF lo arma el servidor con este informe.
  async function enviarPorCorreo(i) {
    setOcupado(true);
    try {
      await inf.guardarYa(i.id);
      const [estado, destinatarios] = await Promise.all([getCorreoEstado(), getCorreoDestinatarios()]);
      if (!destinatarios.length) { notificar("error", "La lista de destinatarios está vacía: cargala en «Destinatarios del correo»."); return; }
      await enviarPronosticoPorCorreo({
        fecha: i.borrador.fecha, estado, destinatarios, word: i.borrador.version === 2,
        enviar: async (datos) => { const r = await enviarInformePorCorreo(i.id, datos); if (r.informe) inf.mezclar(r.informe); return r; },
      });
    } catch (e) { notificar("error", e.message); } finally { setOcupado(false); }
  }
  async function editarDestinatarios() {
    try { await editarDestinatariosPorPasos({ destinatarios: await getCorreoDestinatarios(), guardar: guardarCorreoDestinatarios }); }
    catch (e) { notificar("error", e.message); }
  }

  async function onCapturarDesdeElMapa() {
    if (!mapaRef.current) return;
    setCargando(true);
    setError(null);
    try {
      const dataUrl = await mapaRef.current.capturarConOverlay();
      if (!dataUrl) throw new Error("El mapa todavía no está listo");
      const blob = await (await fetch(dataUrl)).blob();
      descargarBlob(blob, `mapa_captura_${Date.now()}.png`);
    } catch (err) {
      setError("No se pudo capturar el mapa. Usá «Placa para redes» en la tarjeta, que es la vía confiable. Detalle: " + err.message);
    } finally {
      setCargando(false);
    }
  }

  const relativo = tiempoRelativo(publicado?.publicadoEn);
  // La pila, agrupada por día (lo más reciente arriba).
  const dias = useMemo(() => {
    const porDia = new Map();
    for (const i of informes || []) porDia.set(i.fecha, [...(porDia.get(i.fecha) || []), i]);
    return [...porDia.entries()];
  }, [informes]);

  return (
    <div className={`admin-layout ens-layout${lateralCerrado ? " ens-layout--sin-lateral" : ""}`}>
      <BrandHeader subtitulo="Previsión del tiempo">
        {publicado ? (
          <span>
            Publicado <b>{relativo}</b> · {fechaLarga(publicado.publicadoEn)}
          </span>
        ) : (
          <span>Todavía no se publicó ningún pronóstico</span>
        )}
        <Link to="/panel/mapas" className="btn-link">
          ← Panel
        </Link>
      </BrandHeader>

      <div className={`admin-panel ens-lateral${lateralCerrado ? " ens-lateral--cerrada" : ""}`} id="contenido-principal" tabIndex={-1}>
        <button type="button" className="ens-lateral-toggle" aria-expanded={!lateralCerrado} aria-controls="pron-lateral-contenido" onClick={alternarLateral}
          title={lateralCerrado ? "Mostrar las tarjetas de los pronósticos" : "Ocultar las tarjetas para ver el mapa y el ensamble más grandes"}>
          <span aria-hidden="true">{lateralCerrado ? "»" : "«"}</span>
          <span className="ens-lateral-rotulo">{lateralCerrado ? `Pronósticos (${informes?.length ?? 0})` : "Ocultar"}</span>
        </button>
        {puedeUsar(usuario, "ensamble") && <button type="button" className="ens-lateral-toggle" aria-expanded={ensambleAbierto} aria-controls="ens-cajon-izq" onClick={() => alternarEnsamble(!ensambleAbierto)}
          title={ensambleAbierto ? "Ocultar el ensamble" : "Abrir el ensamble a la izquierda, al lado del informe"}>
          <span aria-hidden="true">{ensambleAbierto ? "‹" : "›"}</span><span className="ens-lateral-rotulo">{ensambleAbierto ? "Ocultar ensamble" : "Abrir ensamble"}</span>
        </button>}
        <div id="pron-lateral-contenido" className="ens-lateral-contenido" hidden={lateralCerrado}>
        <div className="editor-heading"><h1>Previsión del tiempo</h1><p>Cada informe del día es una tarjeta: se arma, se publica en los mapas, se manda por correo y tiene su placa para redes.</p></div>
        <PublicationStatus changed={sucio} published={publicado} />
        <PronosticoPublicado meta={metaPublicado} />
        {(error || inf.error) && <div className="alert alert--error" role="alert">{error || inf.error}</div>}
        {mensajeOk && <div className="alert alert--ok" role="status">{mensajeOk}</div>}
        <div className="admin-acciones">
          <button className="btn btn--primary btn--block" onClick={() => nuevoInforme()}>{nuevo && borradorConAlgo(nuevo) ? "Seguir con el informe sin guardar" : "Nuevo informe"}</button>
          <button className="btn btn--ghost btn--block" onClick={editarDestinatarios}>Destinatarios del correo</button>
          <button className="btn btn--ghost btn--block" disabled={!filas || cargando} onClick={onCapturarDesdeElMapa}>Capturar el mapa de acá</button>
        </div>

        {correo && !correo.configurado && <div className="alert alert--error" role="status">El envío por correo todavía no está configurado en el servidor: faltan <code>GMAIL_USER</code> y <code>GMAIL_APP_PASSWORD</code> (la contraseña de aplicación de la cuenta de Gmail). Hasta entonces el botón «Enviar por correo» no puede mandar.</div>}
        {correo?.configurado && <p className="admin-panel__hint">Los correos salen desde {correo.remitente} ({correo.via === "gmail" ? "Gmail" : "Microsoft 365"}).</p>}
        {!informes ? <p className="admin-panel__hint">Cargando los informes…</p> : !informes.length ? <p className="admin-panel__hint">Todavía no hay informes de los últimos días. Armá uno con «Nuevo informe».</p> : (
          <div className="pron-pila">
            {dias.map(([fecha, lista]) => <section key={fecha} aria-label={`Informes del ${fecha}`}>
              <h2 className="pron-dia-titulo">{new Date(`${fecha}T12:00:00Z`).toLocaleDateString("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })} · {lista.length} informe{lista.length === 1 ? "" : "s"}</h2>
              <ul className="avisos-lista">
                {lista.map((i) => <TarjetaInformePronostico key={i.id} informe={i} actual={publicado} enElMapa={i.id === vistaId} guardado={inf.guardado[i.id]} ocupado={ocupado} acciones={{
                  editar: () => editar(i), verEnMapa: () => { setVista("mapa"); setVistaId(i.id); }, publicar: () => publicarInforme(i),
                  verPdf: () => verPdf(i), bajarPdf: () => verPdf(i, true), bajarDocx: () => bajarDocx(i), bajarRtf: () => bajarRtf(i), bajarDocxViejo: () => bajarDocx(i, true), bajarRtfViejo: () => bajarRtf(i, true), crearPlaca: () => crearPlaca(i), verPlaca: () => verPlaca(i),
                  enviar: () => enviarPorCorreo(i), destinatarios: editarDestinatarios, duplicar: () => duplicar(i), borrar: () => borrarInforme(i),
                }} />)}
              </ul>
            </section>)}
          </div>
        )}
        <p className="admin-panel__hint">{vistaId == null ? "El mapa de la derecha muestra lo publicado. Tocá una tarjeta para ver ese informe en el mapa." : !datosVista ? "Ese informe todavía está incompleto: el mapa muestra lo publicado." : sucio ? "El mapa de la derecha muestra el informe elegido, que todavía no está publicado." : "El mapa de la derecha coincide con lo publicado."}</p>
        <EmbedShare path="/embed" title="Previsión del tiempo de Misiones" />
        </div>
      </div>

      {puedeUsar(usuario, "ensamble") && ensamblePedido && <aside id="ens-cajon-izq" className={`ens-cajon-izq${ensambleAbierto ? " ens-cajon-izq--abierto" : ""}`} aria-label="Ensamble multimodelo" {...(ensambleAbierto ? {} : { inert: "" })}>
        <header className="ens-cajon-cab"><div><h2>Ensamble multimodelo</h2></div><div className="ens-cajon-acciones"><button type="button" className="btn btn--ghost" onClick={() => alternarEnsamble(false)}>Ocultar</button></div></header>
        <iframe className="ens-cajon-izq-visor" title="Ensamble multimodelo" src="/panel/ensamble?visor=1" />
      </aside>}

      {/* Con un informe en marcha y el cajón oculto, queda la pestaña para volver a abrirlo. */}
      {!cajon && (informeAbierto || (eligiendo && abiertoId === "nuevo")) && <button type="button" className="pron-pestana" aria-controls="ens-cajon" onClick={() => setCajon(true)}
        title="Volver al informe">
        <span aria-hidden="true">«</span><span className="pron-pestana-rotulo">{informeAbierto?.id != null ? `Informe #${informeAbierto.id}` : "Informe nuevo"}</span>
      </button>}

      {(eligiendo && abiertoId === "nuevo") || informeAbierto?.borrador?.version === 2
        ? <InformePlantilla informe={informeAbierto} elegir={eligiendo && abiertoId === "nuevo"} alElegir={elegirTipo} alCambiarTipo={cambiarTipo} alCancelar={cancelarInforme} abierto={cajon} onCerrar={() => setCajon(false)} paso={paso} setPaso={setPaso}
            setCampo={(camino, valor) => (abiertoId === "nuevo" ? setNuevo((b) => conCampo(b, camino, valor)) : abiertoId != null && inf.setCampo(abiertoId, camino, valor))}
            reemplazar={(b) => (abiertoId === "nuevo" ? setNuevo(b) : abiertoId != null && inf.reemplazar(abiertoId, b))}
            guardado={inf.guardado[abiertoId]} alGuardar={guardarNuevo} guardando={guardandoNuevo} />
        : <InformePronostico informe={informeAbierto} alCancelar={cancelarInforme} abierto={cajon && !!informeAbierto} onCerrar={() => setCajon(false)} paso={paso} setPaso={setPaso}
        setCampo={(camino, valor) => (abiertoId === "nuevo" ? setNuevo((b) => conCampo(b, camino, valor)) : abiertoId != null && inf.setCampo(abiertoId, camino, valor))}
        reemplazar={(b) => (abiertoId === "nuevo" ? setNuevo(b) : abiertoId != null && inf.reemplazar(abiertoId, b))}
        guardado={inf.guardado[abiertoId]} publicado={publicado} alPublicar={() => informeAbierto && publicarInforme(informeAbierto)} alGuardar={guardarNuevo} guardando={guardandoNuevo} />}

      <PlacaPreview imagenes={imagenes} vista={vista} onVista={setVista} titulo="pronóstico"
        visor={puedeUsar(usuario, "ensamble") ? { id: "ensamble", label: "Ensamble", src: "/panel/ensamble?visor=1" } : null}
        sinRedes={PRONOSTICO_EN_REDES ? null : "Todavía no aprobada para redes: se puede descargar para revisarla, pero no publicar."}>
        {municipiosPreview && municipiosGeojson ? (
          <BaseMap
            ref={mapaRef}
            poligonos={municipiosGeojson}
            datos={municipiosPreview}
            colorDe={colorUniforme}
            renderInfo={infoPronostico}
            titulo="Previsión del tiempo"
            publicadoEn={sucio ? null : publicado?.publicadoEn}
            fechaPronostico={fechaPronostico}
            enableCapture
          />
        ) : (
          <div className="admin-map-area__vacio">
            Armá un informe para ver el mapa.
          </div>
        )}
      </PlacaPreview>
    </div>
  );
}
