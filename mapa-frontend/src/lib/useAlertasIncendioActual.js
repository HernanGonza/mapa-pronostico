import { useEffect, useState } from "react";
import { escucharAlertasIncendio, getAlertasIncendioActual } from "../api";

export function useAlertasIncendioActual() {
  const [actual, setActual] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let activo = true;
    let solicitud = 0;
    async function cargar() {
      const estaSolicitud = ++solicitud;
      try {
        const data = await getAlertasIncendioActual();
        if (activo && estaSolicitud === solicitud) {
          setActual(previo => previo?.recuperadoEn === data?.recuperadoEn ? previo : data);
          setError("");
        }
      } catch (err) {
        if (activo && estaSolicitud === solicitud) setError(err.message);
      } finally {
        if (activo && estaSolicitud === solicitud) setCargando(false);
      }
    }
    const detener = escucharAlertasIncendio(cargar);
    void cargar();
    const timer = setInterval(cargar, 30000);
    return () => { activo = false; detener(); clearInterval(timer); };
  }, []);

  return { actual, error, cargando };
}
