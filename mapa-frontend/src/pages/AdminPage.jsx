import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import BaseMap from "../components/BaseMap";
import { colorPronostico, infoPronostico, LeyendaPronostico } from "../components/PronosticoMapContent";
import EmbedShare from "../components/EmbedShare";
import BrandHeader from "../components/BrandHeader";
import {
  parseDocx,
  publicar,
  renderPngEnBack,
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
  return cambios;
}

export default function AdminPage() {
  const [filas, setFilas] = useState(null);
  const [publicado, setPublicado] = useState(null); // { publicadoEn, filas }
  const [municipiosPreview, setMunicipiosPreview] = useState(null);
  const [municipiosGeojson, setMunicipiosGeojson] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [fechaPronostico, setFechaPronostico] = useState(new Date().toISOString().slice(0, 10));
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

  async function onSubirDocx(e) {
    const file = e.target.files[0];
    if (!file) return;
    setCargando(true);
    setError(null);
    setMensajeOk(null);
    setConfirmando(false);
    try {
      const nuevasFilas = await parseDocx(file);
      setFilas(nuevasFilas);
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
      const payload = await publicar(filas, fechaPronostico);
      setPublicado(payload);
      setConfirmando(false);
      setMensajeOk("Publicado. El mapa público (/embed) ya muestra esta versión.");
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function onDescargarImagenServer() {
    setCargando(true);
    setError(null);
    try {
      const blob = await renderPngEnBack(filas);
      descargarBlob(blob, `mapa_prono_${Date.now()}.png`);
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
        "No se pudo capturar el mapa. Usá 'Descargar imagen institucional', que es la vía confiable. Detalle: " +
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
        <Link to="/panel" className="btn-link">
          ← Panel
        </Link>
      </BrandHeader>

      <div className="admin-panel">
        <div className="editor-heading"><span className="editor-eyebrow">REPORTE POR MUNICIPIO</span><h1>Previsión del tiempo</h1><p>Cargá el pronóstico y revisá los datos. Los cambios se ven en el mapa antes de publicar.</p></div>
        <h2>1 · Subir el .docx del día</h2>
        <label className="field"><span>Fecha del pronóstico</span><input type="date" value={fechaPronostico} onChange={e => setFechaPronostico(e.target.value)} /></label>
        <p className="admin-panel__hint">
          Así lo genera Alerta Temprana. El mapa se arma solo con esos datos —
          no hace falta cargar nada a mano.
        </p>

        {error && <div className="alert alert--error">{error}</div>}
        {mensajeOk && <div className="alert alert--ok">{mensajeOk}</div>}

        <label className="field">
          <span>Archivo .docx del pronóstico</span>
          <input
            type="file"
            accept=".docx"
            onChange={onSubirDocx}
            disabled={cargando}
          />
        </label>

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
                          type="number"
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

            {confirmando && cambios && cambios.length > 0 && (
              <div className="diff-panel">
                <h3>{cambios.length} cambio(s) respecto de lo publicado</h3>
                <ul className="diff-list">
                  {cambios.map((c, k) => (
                    <li key={k}>
                      <b>{c.localidad}</b> · {c.campo}:{" "}
                      <span className="diff-de">{c.de}</span>{" "}
                      <span className="diff-a">→ {c.a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {confirmando && cambios && cambios.length === 0 && (
              <div className="alert alert--warn">
                No hay cambios respecto de lo ya publicado.
              </div>
            )}

            <div className="admin-actions">
              {!confirmando ? (
                <button
                  className="btn btn--primary btn--block"
                  onClick={() => setConfirmando(true)}
                  disabled={cargando || hayInvalidos}
                >
                  Revisar y publicar
                </button>
              ) : (
                <>
                  <button
                    className="btn btn--primary btn--block"
                    onClick={onPublicar}
                    disabled={cargando}
                  >
                    Confirmar y publicar
                  </button>
                  <button
                    className="btn btn--ghost btn--block"
                    onClick={() => setConfirmando(false)}
                    disabled={cargando}
                  >
                    Seguir editando
                  </button>
                </>
              )}

              <button
                className="btn btn--block"
                onClick={onDescargarImagenServer}
                disabled={cargando || hayInvalidos}
              >
                Descargar imagen institucional
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

      <div className="admin-map-area">
        {municipiosPreview && municipiosGeojson ? (
          <BaseMap
            ref={mapaRef}
            poligonos={municipiosGeojson}
            datos={municipiosPreview}
            colorDe={colorPronostico}
            renderInfo={infoPronostico}
            leyenda={<LeyendaPronostico />}
            titulo="Previsión del tiempo"
            publicadoEn={cambios?.length ? null : publicado?.publicadoEn}
            fechaPronostico={fechaPronostico}
            enableCapture
          />
        ) : (
          <div className="admin-map-area__vacio">
            Subí un .docx para ver el mapa.
          </div>
        )}
      </div>
    </div>
  );
}
