import { useCallback, useEffect, useState } from "react";
import BaseMap from "../components/BaseMap";
import {
  getMapaActual,
  getMunicipiosGeojson,
  getMundoGeojson,
  getGeo,
  getVientoGlobal,
} from "../api";

/**
 * Página pensada para ir en el <iframe> del sitio del ministerio.
 * Solo lectura. La geometría (poco cambiante) se pide una vez; el
 * pronóstico se refresca cada 5 minutos.
 */
export default function EmbedPage() {
  const [municipiosGeojson, setMunicipiosGeojson] = useState(null);
  const [mundo, setMundo] = useState(null);
  const [paisesLabels, setPaisesLabels] = useState(null);
  const [provincias, setProvincias] = useState(null);
  const [provinciasLabels, setProvinciasLabels] = useState(null);
  const [viento, setViento] = useState(null);
  const [municipios, setMunicipios] = useState(null);
  const [publicadoEn, setPublicadoEn] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getMunicipiosGeojson()
      .then(setMunicipiosGeojson)
      .catch((err) => setError(err.message));
    getMundoGeojson().then(setMundo).catch(() => {});
    getGeo("paises-labels").then(setPaisesLabels).catch(() => {});
    getGeo("provincias").then(setProvincias).catch(() => {});
    getGeo("provincias-labels").then(setProvinciasLabels).catch(() => {});
    getVientoGlobal().then(setViento).catch(() => {});
  }, []);

  const cargarPronostico = useCallback(async () => {
    try {
      const data = await getMapaActual();
      setMunicipios(data.municipios);
      setPublicadoEn(data.publicadoEn);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    cargarPronostico();
    const interval = setInterval(cargarPronostico, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [cargarPronostico]);

  if (error) {
    return (
      <div className="base-map base-map--fallback">
        <div>
          <strong>No se pudo cargar el pronóstico.</strong>
          <p>{error}</p>
        </div>
      </div>
    );
  }
  if (!municipiosGeojson || !municipios) {
    return (
      <div className="base-map base-map--fallback">
        <div>Cargando mapa…</div>
      </div>
    );
  }

  return (
    <BaseMap
      municipiosGeojson={municipiosGeojson}
      mundoGeojson={mundo}
      paisesLabels={paisesLabels}
      provincias={provincias}
      provinciasLabels={provinciasLabels}
      pronostico={municipios}
      viento={viento}
      titulo="Previsión del tiempo"
      publicadoEn={publicadoEn}
    />
  );
}
