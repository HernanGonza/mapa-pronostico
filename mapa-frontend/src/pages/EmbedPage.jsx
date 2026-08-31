import { useCallback, useEffect, useState } from "react";
import BaseMap from "../components/BaseMap";
import { getMapaActual, getVientoGlobal } from "../api";

/**
 * Página pensada para ir en el <iframe> del sitio del ministerio.
 * Solo lectura. La geometría (municipios, países, provincias, rótulos) la
 * carga MapLibre directo por URL; acá solo pedimos el pronóstico y el
 * viento. El pronóstico se refresca cada 5 minutos.
 */
export default function EmbedPage() {
  const [viento, setViento] = useState(null);
  const [municipios, setMunicipios] = useState(null);
  const [publicadoEn, setPublicadoEn] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getVientoGlobal()
      .then(setViento)
      .catch(() => {
        // el viento es un "nice to have"; el mapa funciona sin partículas
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
  if (!municipios) {
    return (
      <div className="base-map base-map--fallback">
        <div>Cargando mapa…</div>
      </div>
    );
  }

  return (
    <BaseMap
      pronostico={municipios}
      viento={viento}
      titulo="Previsión del tiempo"
      publicadoEn={publicadoEn}
    />
  );
}
