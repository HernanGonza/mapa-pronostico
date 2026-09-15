import PublicationStatus from "../components/PublicationStatus";
import PublicationReview from "../components/PublicationReview";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PlacaPreview from "../components/PlacaPreview";
import BaseMap from "../components/BaseMap";
import { colorPronostico, infoPronostico, LeyendaPronostico } from "../components/PronosticoMapContent";
import EmbedShare from "../components/EmbedShare";
import BrandHeader from "../components/BrandHeader";
import {
  parseDocx,
  publicar,
  generarPronosticoPlaca,
  getActual,
  getMapaPreview,
  getMunicipiosGeojson,
} from "../api";
import {
  CONDICIONES_CANONICAS,
  colorPorCondicion,
  condicionCanonica,
  esCondicionConocida,
  esTormenta,
} from "../lib/condiciones";
import { tiempoRelativo, fechaLarga } from "../lib/tiempoRelativo";

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
    for (const campo of ["TMIN", "TMAX", "CONDICION"]) {
      if (String(antes[campo]).trim() !== String(row[campo]).trim()) {
        cambios.push({
          localidad: row.LOCALIDAD,
          campo,
          de: String(antes[campo]),
          a: String(row[campo]),
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
  const [confirmando, setConfirmando] = useState(false);
  const [fechaPronostico, setFechaPronostico] = useState(new Date().toISOString().slice(0, 10));
  const [imagenes, setImagenes] = useState(null);
  const [vista, setVista] = useState("mapa");
  useEffect(() => { setImagenes(null); }, [filas, fechaPronostico]);
  const mapaRef = useRef(null);

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
      getMapaPreview(filas)
        .then(setMunicipiosPreview)
        .catch((err) => setError(err.message));
    }, 400);
    return () => clearTimeout(t);
  }, [filas]);

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

  async function onSubirDocx(e) {
    const file = e.target.files[0];
    if (!file) return;
    setCargando(true);
    setError(null);
    setMensajeOk(null);
    setConfirmando(false);
    try {
      const { filas: nuevasFilas, extendido: nuevoExtendido } = await parseDocx(file);
      setFilas(nuevasFilas);
      setExtendido(nuevoExtendido || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
      e.target.value = "";
    }
  }

  function actualizarCelda(index, campo, valor) {
    setConfirmando(false);
    setMensajeOk(null);
    setFilas((prev) => {
      const copia = [...prev];
      copia[index] = { ...copia[index], [campo]: valor };
      return copia;
    });
  }

  async function onPublicar() {
    setCargando(true);
    setError(null);
    setMensajeOk(null);
    try {
      const payload = await publicar(filas, fechaPronostico, extendido);
      setPublicado(payload);
      setConfirmando(false);
      setMensajeOk("Publicado. El mapa público ya muestra esta versión.");
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function onGenerarPlaca() {
    setCargando(true);
    setError(null);
    try {
      const placa = await generarPronosticoPlaca(filas, fechaPronostico);
      setImagenes({ feed: placa.feedUrl, historias: placa.historiasUrl, feedNombre: placa.feedNombre, historiasNombre: placa.historiasNombre });
      setVista("placa");
      setMensajeOk("Placa generada. Revisala en la vista previa y descargala desde ahí.");
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
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
        <h2>1 · Subir el .docx del día</h2>
        <label className="field"><span>Fecha del pronóstico</span><input type="date" disabled={cargando} value={fechaPronostico} onChange={e => { setFechaPronostico(e.target.value); setConfirmando(false); setMensajeOk(null); }} /></label>
        <p className="admin-panel__hint">
          Así lo genera Alerta Temprana. El mapa se arma solo con esos datos —
          no hace falta cargar nada a mano.
        </p>

        {error && <div className="alert alert--error" role="alert">{error}</div>}
        {mensajeOk && <div className="alert alert--ok" role="status">{mensajeOk}</div>}

        <label className="field">
          <span>Archivo .docx del pronóstico</span>
          <input
            type="file"
            accept=".docx"
            onChange={onSubirDocx}
            disabled={cargando}
          />
        </label>

        {extendido && (
          <div className="alert alert--ok" role="status">
            Este .docx también trae pronóstico extendido (sábado y domingo, por zona). Ahora podés ir a la pantalla del{" "}
            <Link to="/panel/pronostico-3-dias">pronóstico de 3 días</Link>.
          </div>
        )}

        {filas && (
          <>
            <h2>2 · Revisar y corregir</h2>
            <p className="admin-panel__hint">
              Estos son los 13 puntos que reporta el .docx. El resto de los
              municipios toma el dato del más cercano de estos 13. Corregí acá
              si hace falta antes de publicar.
            </p>

            {hayInvalidos && (
              <div className="alert alert--warn">
                Hay temperaturas fuera de rango, mínimas mayores que máximas
                o condiciones sin reconocer. Corregilas para poder publicar.
              </div>
            )}

            <table className="tabla-localidades">
              <thead>
                <tr>
                  <th>Localidad</th>
                  <th>Mín</th>
                  <th>Máx</th>
                  <th>Condición</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((row, i) => (
                  <tr
                    key={row.LOCALIDAD + i}
                    className={esTormenta(row.CONDICION) ? "row--tormenta" : ""}
                  >
                    <td className="col-loc">{row.LOCALIDAD}</td>
                    {CAMPOS.map(([campo]) => (
                      <td key={campo}>
                        <input
                          disabled={cargando}
                          type="number"
                          aria-label={`${campo === "TMIN" ? "Mínima" : "Máxima"} de ${row.LOCALIDAD}`}
                          value={row[campo]}
                          className={tempInvalida(row[campo]) ? "is-invalid" : ""}
                          onChange={(e) =>
                            actualizarCelda(i, campo, e.target.value)
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <div className="cond-cell">
                        <span
                          className="cond-swatch"
                          style={{ background: colorPorCondicion(row.CONDICION) }}
                        />
                        <select
                          aria-label={`Condición de ${row.LOCALIDAD}`}
                          disabled={cargando}
                          value={condicionCanonica(row.CONDICION) || ""}
                          className={
                            esCondicionConocida(row.CONDICION) ? "" : "is-invalid"
                          }
                          onChange={(e) =>
                            actualizarCelda(i, "CONDICION", e.target.value)
                          }
                        >
                          {!esCondicionConocida(row.CONDICION) && (
                            <option value="">
                              {row.CONDICION || "(elegir)"} — sin reconocer
                            </option>
                          )}
                          {CONDICIONES_CANONICAS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2 style={{ marginTop: 22 }}>3 · Publicar</h2>

            {confirmando && <PublicationReview busy={cargando} onConfirm={onPublicar} onCancel={() => setConfirmando(false)}>
              {!publicado && <p>Se publicará el primer pronóstico con {filas.length} localidades.</p>}
              {fechaCambiada && <p>Fecha del pronóstico: {fechaPronostico}.</p>}
              {!!cambios?.length && <ul className="diff-list">
                {cambios.map((c, k) => <li key={k}><b>{c.localidad}</b> · {c.campo}: {c.de} → {c.a}</li>)}
              </ul>}
            </PublicationReview>}
            <div className="admin-actions">
              {!confirmando && <button className="btn btn--primary btn--block" onClick={() => setConfirmando(true)} disabled={cargando || hayInvalidos || !fechaPronostico || !sucio}>Revisar y publicar</button>}

              <button
                className="btn btn--block"
                onClick={onGenerarPlaca}
                disabled={cargando || hayInvalidos}
              >
                {cargando ? "Procesando…" : "Generar placa para redes"}
              </button>
              <button
                className="btn btn--block"
                onClick={onCapturarDesdeElMapa}
                disabled={cargando}
              >
                Capturar mapa actual
              </button>
            </div>
          </>
        )}
        <EmbedShare path="/embed" title="Previsión del tiempo de Misiones" />
      </div>

      <PlacaPreview imagenes={imagenes} vista={vista} onVista={setVista} titulo="pronóstico">
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
