import { useCallback, useEffect, useState } from "react";
import BaseMap from "../components/BaseMap";
import { colorPronostico, infoPronostico, LeyendaPronostico } from "../components/PronosticoMapContent";
import {
  getMapaActual,
  getMunicipiosGeojson,
} from "../api";

/**
 * Página pensada para ir en el <iframe> del sitio del ministerio.
 * Solo lectura. La geometría (poco cambiante) se pide una vez; el
 * pronóstico se refresca cada 5 minutos.
 */
export default function EmbedPage() {
  const [municipiosGeojson, setMunicipiosGeojson] = useState(null);
  const [municipios, setMunicipios] = useState(null);
  const [publicadoEn, setPublicadoEn] = useState(null);
  const [fechaPronostico, setFechaPronostico] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getMunicipiosGeojson()
      .then(setMunicipiosGeojson)
      .catch((err) => setError(err.message));
  }, []);

  const cargarPronostico = useCallback(async () => {
    try {
      const data = await getMapaActual();
      setMunicipios(data.municipios);
      setPublicadoEn(data.publicadoEn);
      setFechaPronostico(data.fechaPronostico);
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
      poligonos={municipiosGeojson}
      datos={municipios}
      colorDe={colorPronostico}
            renderInfo={infoPronostico}
            leyenda={<LeyendaPronostico />}
            titulo="Previsión del tiempo"
      publicadoEn={publicadoEn}
      fechaPronostico={fechaPronostico}
    />
  );
}
