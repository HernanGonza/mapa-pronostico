import PublicationStatus from "../components/PublicationStatus";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PlacaPreview from "../components/PlacaPreview";
import BaseMap from "../components/BaseMap";
import { colorPronostico, infoPronostico, LeyendaPronostico } from "../components/PronosticoMapContent";
import EmbedShare from "../components/EmbedShare";
import { cargarPronostico, crearPlacaPronostico, publicarPronosticoPorPasos, filaInvalida } from "../lib/asistentesPronostico";
import BrandHeader from "../components/BrandHeader";
import { enviarPronosticoPorCorreo, editarDestinatariosPorPasos } from "../lib/asistenteCorreo";
import { notificar } from "../lib/ui";
import {
  parseDocx,
  getCorreoEstado,
  getCorreoDestinatarios,
  guardarCorreoDestinatarios,
  enviarPronosticoPorCorreo as enviarCorreo,
  publicar,
  generarPronosticoPlaca,
  getUltimaPlacaPronostico,
  getActual,
  getMapaPreview,
  getMunicipiosGeojson,
} from "../api";
import {
  colorPorCondicion,
  condicionCanonica,
  esCondicionConocida,
  esTormenta,
} from "../lib/condiciones";
import { tiempoRelativo, fechaLarga } from "../lib/tiempoRelativo";

// Placa del pronóstico para redes: estuvo desactivada (pedido 02/10); vuelve el 04/10 con el estilo
// nuevo, sobre las fotos de las placas diarias.
const PLACA_REDES_ACTIVA = true;
// …pero todavía NO se publica en redes (06/10: las placas no están aprobadas). Se generan y se
// descargan para revisarlas. El backend también lo frena (routes/redes.js, PRONOSTICO_EN_REDES).
const PRONOSTICO_EN_REDES = false;

const CAMPOS = [
  ["TMIN", "Mín"],
  ["TMAX", "Máx"],
];

function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

function tempInvalida(v) {
  if (v == null || String(v).trim() === "") return true;
  const n = Number(v);
  return !Number.isInteger(n) || n < -15 || n > 55;
}

/** Diferencias entre lo editado y lo último publicado, por localidad. */
function calcularCambios(editadas, publicadas) {
  if (!publicadas) return null;
  const prev = new Map(publicadas.map((r) => [r.LOCALIDAD, r]));
  const cambios = [];
  for (const row of editadas) {
    const antes = prev.get(row.LOCALIDAD);
    if (!antes) {
      cambios.push({ localidad: row.LOCALIDAD, campo: "nueva", de: "—", a: "fila nueva" });
      continue;
    }
    for (const campo of ["TMIN", "TMAX", "CONDICION", "ZONA"]) {
      if (String(antes[campo] ?? "").trim() !== String(row[campo] ?? "").trim()) {
        cambios.push({
          localidad: row.LOCALIDAD,
          campo,
          de: String(antes[campo] ?? "—"),
          a: String(row[campo] ?? "—"),
        });
      }
    }
  }
  const actuales = new Set(editadas.map(row => row.LOCALIDAD));
  for (const row of publicadas) {
    if (!actuales.has(row.LOCALIDAD)) {
      cambios.push({ localidad: row.LOCALIDAD, campo: "localidad", de: "incluida", a: "quitada del pronóstico" });
    }
  }
  return cambios;
}

export default function AdminPage() {
  const [filas, setFilas] = useState(null);
  const [extendido, setExtendido] = useState(null);
  const [publicado, setPublicado] = useState(null); // { publicadoEn, filas }
  const [municipiosPreview, setMunicipiosPreview] = useState(null);
  const [municipiosGeojson, setMunicipiosGeojson] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);
  const [fechaPronostico, setFechaPronostico] = useState(new Date().toISOString().slice(0, 10));
  const [imagenes, setImagenes] = useState(null);
  const [vista, setVista] = useState("mapa");
  // «Placa para redes» muestra siempre la última placa generada (también al volver a la página).
  useEffect(() => {
    let vivo = true;
    getUltimaPlacaPronostico().then((placa) => { if (vivo && placa) setImagenes({ feed: placa.feedUrl, historias: placa.historiasUrl, feedNombre: placa.feedNombre, historiasNombre: placa.historiasNombre }); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  const mapaRef = useRef(null);
  // El .docx que se cargó en esta sesión: se adjunta tal cual al enviar el pronóstico por correo.
  const [docx, setDocx] = useState(null);

  useEffect(() => {
    getMunicipiosGeojson().then(setMunicipiosGeojson).catch(() => {});
  }, []);

  useEffect(() => {
    getActual()
      .then((actual) => {
        if (actual) {
          setPublicado(actual);
          setFilas(actual.filas);
          setExtendido(actual.extendido || null);
          if (actual.fechaPronostico) setFechaPronostico(actual.fechaPronostico);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!filas) return;
    const t = setTimeout(() => {
      getMapaPreview(filas, extendido)
        .then(setMunicipiosPreview)
        .catch((err) => setError(err.message));
    }, 400);
    return () => clearTimeout(t);
  }, [filas, extendido]);

  const hayInvalidos = useMemo(
    () =>
      !!filas &&
      filas.some(
        (r) =>
          tempInvalida(r.TMIN) ||
          tempInvalida(r.TMAX) ||
          Number(r.TMIN) > Number(r.TMAX) ||
          !esCondicionConocida(r.CONDICION)
      ),
    [filas]
  );

  const cambios = useMemo(
    () => calcularCambios(filas || [], publicado?.filas),
    [filas, publicado]
  );

  const fechaCambiada = !!filas && fechaPronostico !== (publicado?.fechaPronostico || "");
  const sucio = !!filas && (!publicado || !!cambios?.length || fechaCambiada);

  // --- Asistentes (todo dentro de un modal, paso a paso) ---
  const cargar = () => cargarPronostico({
    filas, fecha: fechaPronostico, parse: (archivo) => parseDocx(archivo).then((r) => { setDocx(archivo); return r; }),
    aplicar: ({ filas: f, fecha, extendido: e }) => { setFilas(f); setFechaPronostico(fecha); setExtendido(e || extendido || null); setError(null); },
  });
  const crearPlaca = () => crearPlacaPronostico({
    enRedes: PRONOSTICO_EN_REDES,
    epigrafe: `Previsión del tiempo · ${fechaPronostico.split("-").reverse().join("/")}`, filas,
    vistaPrevia: (valores) => generarPronosticoPlaca(filas, fechaPronostico, { ...valores, vistaPrevia: true }),
    guardar: async (token, valores) => {
      const placa = await generarPronosticoPlaca(filas, fechaPronostico, { ...valores, confirmarToken: token });
      setImagenes({ feed: placa.feedUrl, historias: placa.historiasUrl, feedNombre: placa.feedNombre, historiasNombre: placa.historiasNombre });
      setVista("placa");
      return placa;
    },
  });
  const revisarYPublicar = () => publicarPronosticoPorPasos({
    cantidad: filas.length, sinPublicar: !publicado, fecha: fechaPronostico, fechaCambiada, cambios, republicar: !sucio,
    publicar: async () => { setPublicado(await publicar(filas, fechaPronostico, extendido)); setMensajeOk("Publicado. El mapa público ya muestra esta versión."); },
  });

  // Correo: la lista y el estado se piden al abrir, así siempre están al día.
  async function enviarPorCorreo() {
    try {
      const [estado, destinatarios] = await Promise.all([getCorreoEstado(), getCorreoDestinatarios()]);
      if (!destinatarios.length) { notificar("error", "La lista de destinatarios está vacía: cargala en «Destinatarios del email»."); return; }
      await enviarPronosticoPorCorreo({ docx, fecha: fechaPronostico, estado, destinatarios, enviar: enviarCorreo });
    } catch (e) { notificar("error", e.message); }
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
      setError(
        "No se pudo capturar el mapa. Usá 'Generar placa para redes', que es la vía confiable. Detalle: " +
          err.message
      );
    } finally {
      setCargando(false);
    }
  }

  const relativo = tiempoRelativo(publicado?.publicadoEn);

  return (
    <div className="admin-layout">
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

      <div className="admin-panel" id="contenido-principal" tabIndex={-1}>
        <div className="editor-heading"><h1>Previsión del tiempo</h1><p>Cargá el pronóstico y revisá los datos. Los cambios se ven en el mapa antes de publicar.</p></div>
        <PublicationStatus changed={sucio} published={publicado} />
        {error && <div className="alert alert--error" role="alert">{error}</div>}
        {mensajeOk && <div className="alert alert--ok" role="status">{mensajeOk}</div>}
        <div className="admin-acciones">
          <button className="btn btn--primary btn--block" onClick={cargar}>{filas ? "Cargar o corregir el pronóstico" : "Cargar el pronóstico del día"}</button>
          {PLACA_REDES_ACTIVA && <button className="btn btn--block" disabled={!filas || hayInvalidos} onClick={crearPlaca}>Crear placa para redes</button>}
          <button className="btn btn--block" disabled={!filas || hayInvalidos || !fechaPronostico} onClick={revisarYPublicar}>{sucio ? "Revisar y publicar" : "Republicar"}</button>
          <button className="btn btn--block" onClick={enviarPorCorreo}>Enviar por email</button>
          <button className="btn btn--ghost btn--block" disabled={!filas} onClick={onCapturarDesdeElMapa}>Capturar mapa actual</button>
          <button className="btn btn--ghost btn--block" onClick={editarDestinatarios}>Destinatarios del email</button>
        </div>
        <p className="admin-panel__hint">{!filas ? "Subí el .docx que manda Alerta Temprana y corregí los datos si hace falta. El mapa se arma solo." : hayInvalidos ? "Hay datos por corregir: abrí «Cargar o corregir el pronóstico»." : sucio ? "Hay cambios sin publicar: el mapa de la derecha muestra el borrador." : "El mapa de la derecha coincide con lo publicado."}</p>
        {extendido && (
          <div className="alert alert--ok" role="status">
            Este .docx también trae pronóstico extendido (sábado y domingo, por zona). Lo corregís en la pantalla del{" "}
            <Link to="/panel/pronostico-3-dias">pronóstico de 3 días</Link>.
          </div>
        )}
        <EmbedShare path="/embed" title="Previsión del tiempo de Misiones" />
      </div>

      <PlacaPreview imagenes={imagenes} vista={vista} onVista={setVista} titulo="pronóstico"
        sinRedes={PRONOSTICO_EN_REDES ? null : "Todavía no aprobada para redes: se puede descargar para revisarla, pero no publicar."}>
        {municipiosPreview && municipiosGeojson ? (
          <BaseMap
            ref={mapaRef}
            poligonos={municipiosGeojson}
            datos={municipiosPreview}
            colorDe={colorPronostico}
            renderInfo={infoPronostico}
            leyenda={<LeyendaPronostico />}
            titulo="Previsión del tiempo"
            publicadoEn={sucio ? null : publicado?.publicadoEn}
            fechaPronostico={fechaPronostico}
            enableCapture
          />
        ) : (
          <div className="admin-map-area__vacio">
            Subí un .docx para ver el mapa.
          </div>
        )}
      </PlacaPreview>
    </div>
  );
}
