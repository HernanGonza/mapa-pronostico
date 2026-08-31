import { useEffect, useMemo, useRef, useState } from "react";
import BaseMap from "../components/BaseMap";
import BrandHeader from "../components/BrandHeader";
import {
  parseDocx,
  publicar,
  renderPngEnBack,
  getActual,
  getMapaPreview,
  getMunicipiosGeojson,
  getMundoGeojson,
  getGeo,
  getVientoGlobal,
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
  const [mundo, setMundo] = useState(null);
  const [paisesLabels, setPaisesLabels] = useState(null);
  const [provincias, setProvincias] = useState(null);
  const [provinciasLabels, setProvinciasLabels] = useState(null);
  const [viento, setViento] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const mapaRef = useRef(null);

  useEffect(() => {
    getMunicipiosGeojson().then(setMunicipiosGeojson).catch(() => {});
    getMundoGeojson().then(setMundo).catch(() => {});
    getGeo("paises-labels").then(setPaisesLabels).catch(() => {});
    getGeo("provincias").then(setProvincias).catch(() => {});
    getGeo("provincias-labels").then(setProvinciasLabels).catch(() => {});
    getVientoGlobal().then(setViento).catch(() => {});
  }, []);

  useEffect(() => {
    getActual()
      .then((actual) => {
        if (actual) {
          setPublicado(actual);
          setFilas(actual.filas);
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
      const payload = await publicar(filas);
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
      const dataUrl = mapaRef.current.capturePng();
      if (!dataUrl) throw new Error("El mapa todavía no está listo");
      const blob = await (await fetch(dataUrl)).blob();
      descargarBlob(blob, `mapa_captura_${Date.now()}.png`);
    } catch (err) {
      setError(
        "No se pudo capturar el mapa. Usá 'Imagen para redes (servidor)', que es la vía confiable. Detalle: " +
          err.message
      );
    } finally {
      setCargando(false);
    }
  }

  const relativo = tiempoRelativo(publicado?.publicadoEn);

  return (
    <div className="admin-layout">
      <BrandHeader subtitulo="Panel de operador · Previsión del tiempo">
        {publicado ? (
          <span>
            Publicado <b>{relativo}</b> · {fechaLarga(publicado.publicadoEn)}
          </span>
        ) : (
          <span>Todavía no se publicó ningún pronóstico</span>
        )}
      </BrandHeader>

      <div className="admin-panel">
        <h2>1 · Subir el .docx del día</h2>
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
                Hay temperaturas fuera de rango o condiciones sin reconocer.
                Corregilas para poder publicar.
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
                  Publicar (actualiza el mapa público)
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
                    Cancelar
                  </button>
                </>
              )}

              <button
                className="btn btn--block"
                onClick={onDescargarImagenServer}
                disabled={cargando || hayInvalidos}
              >
                Imagen para redes (servidor)
              </button>
              <button
                className="btn btn--block"
                onClick={onCapturarDesdeElMapa}
                disabled={cargando}
              >
                Capturar el mapa como se ve acá
              </button>
            </div>
          </>
        )}
      </div>

      <div className="admin-map-area">
        {municipiosPreview && municipiosGeojson ? (
          <BaseMap
            ref={mapaRef}
            intro={false}
            municipiosGeojson={municipiosGeojson}
            mundoGeojson={mundo}
            paisesLabels={paisesLabels}
            provincias={provincias}
            provinciasLabels={provinciasLabels}
            pronostico={municipiosPreview}
            viento={viento}
            titulo="Previsión del tiempo"
            publicadoEn={publicado?.publicadoEn}
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
