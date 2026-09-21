import { useEffect } from "react";
import { notificar } from "./ui";

/** Muestra `mensaje` como toast cada vez que cambia (las pantallas lo limpian antes de cada acción). */
export function useNotificacion(mensaje, tipo = "success") {
  useEffect(() => { if (mensaje) notificar(tipo, mensaje); }, [mensaje, tipo]);
}
