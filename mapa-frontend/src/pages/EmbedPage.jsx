import { useCallback, useEffect, useState } from "react";
import BaseMap from "../components/BaseMap";
import {
  getMapaActual,
  getMunicipiosGeojson,
  getMundoGeojson,
  getVientoGlobal,
} from "../api";

/**
 * Página pensada para ir en el <iframe> del sitio del ministerio.
 * Solo lectura. Geometría (poco cambiante) y viento se piden una vez;
 * el pronóstico se refresca cada 5 minutos por si se publicó de nuevo.
 */
export default function EmbedPage() {
  const [geojson, setGeojson] = useState(null);
  const [mundo, setMundo] = useState(null);
  const [viento, setViento] = useState(null);
  const [municipios, setMunicipios] = useState(null);
  const [publicadoEn, setPublicadoEn] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getMunicipiosGeojson().then(setGeojson).catch((err) => setError(err.message));
    getMundoGeojson().then(setMundo).catch(() => {});
    getVientoGlobal()
      .then(setViento)
      .catch(() => {
        // el viento es un "nice to have": si Open-Meteo falla el mapa
        // sigue funcionando sin partículas
      });
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
  if (!geojson || !municipios) {
    return (
      <div className="base-map base-map--fallback">
        <div>Cargando mapa…</div>
      </div>
    );
  }

  return (
    <BaseMap
      municipiosGeojson={geojson}
      mundoGeojson={mundo}
      pronostico={municipios}
      viento={viento}
      titulo="Previsión del tiempo"
      publicadoEn={publicadoEn}
    />
  );
}
