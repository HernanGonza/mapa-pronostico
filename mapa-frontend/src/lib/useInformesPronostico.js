import { useCallback, useEffect, useRef, useState } from "react";
import { getInformesPronostico, crearInformePronostico, guardarInformePronostico, borrarInformePronostico } from "../api";
import { borradorVacio, conCampo } from "../components/InformePronostico";

const ESPERA_MS = 900;
const hora = () => new Date().toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Los informes de pronóstico del día (varios por día, cada uno es una tarjeta). La lista vive en el servidor; lo que se escribe en el
 * cajón se aplica al instante en pantalla y se guarda solo, de a poco (cada ${ESPERA_MS} ms sin escribir), informe por informe.
 * `guardado[id]`: { estado: "guardando" | "guardado" | "error", hora?, error? }.
 */
export function useInformesPronostico() {
  const [informes, setInformes] = useState(null);
  const [error, setError] = useState(null);
  const [guardado, setGuardado] = useState({});
  const pendientes = useRef(new Map()); // id → { timer, borrador }
  const lista = useRef(null); lista.current = informes;

  const cargar = useCallback(async () => {
    try { setInformes(await getInformesPronostico()); setError(null); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  /** Mezcla lo que devuelve el servidor (meta, fechas) sin pisar el borrador, que puede estar siendo escrito. */
  const mezclar = useCallback((nuevo, { conBorrador = false } = {}) => setInformes((l) => (l || []).map((i) => (i.id === nuevo.id ? { ...nuevo, borrador: conBorrador ? nuevo.borrador : i.borrador } : i))), []);

  const guardarYa = useCallback(async (id) => {
    const p = pendientes.current.get(id);
    if (!p) return;
    clearTimeout(p.timer); pendientes.current.delete(id);
    setGuardado((g) => ({ ...g, [id]: { estado: "guardando" } }));
    try {
      const r = await guardarInformePronostico(id, p.borrador);
      mezclar(r);
      setGuardado((g) => ({ ...g, [id]: pendientes.current.has(id) ? { estado: "guardando" } : { estado: "guardado", hora: hora() } }));
    } catch (e) {
      setGuardado((g) => ({ ...g, [id]: { estado: "error", error: e.message } }));
      // vuelve a intentar con lo último, sin pisar lo que se haya escrito mientras tanto
      if (!pendientes.current.has(id)) pendientes.current.set(id, { borrador: p.borrador, timer: setTimeout(() => guardarYa(id), 5000) });
    }
  }, [mezclar]);

  const programar = useCallback((id, borrador) => {
    const previo = pendientes.current.get(id);
    if (previo) clearTimeout(previo.timer);
    pendientes.current.set(id, { borrador, timer: setTimeout(() => guardarYa(id), ESPERA_MS) });
    setGuardado((g) => ({ ...g, [id]: { estado: "guardando" } }));
  }, [guardarYa]);

  // al salir de la pantalla, lo que esté pendiente se manda ya
  useEffect(() => () => { for (const id of [...pendientes.current.keys()]) guardarYa(id); }, [guardarYa]);

  /** Escribe un campo del informe `id`. */
  const setCampo = useCallback((id, camino, valor) => {
    const actual = lista.current?.find((i) => i.id === id);
    if (!actual) return;
    const borrador = conCampo(actual.borrador, camino, valor);
    setInformes((l) => l.map((i) => (i.id === id ? { ...i, borrador } : i)));
    programar(id, borrador);
  }, [programar]);
  /** Reemplaza todo el borrador del informe `id`. */
  const reemplazar = useCallback((id, borrador) => {
    setInformes((l) => l.map((i) => (i.id === id ? { ...i, borrador } : i)));
    programar(id, borrador);
  }, [programar]);

  const crear = useCallback(async (borrador = borradorVacio()) => {
    const nuevo = await crearInformePronostico(borrador);
    setInformes((l) => [nuevo, ...(l || [])].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id));
    return nuevo;
  }, []);
  const borrar = useCallback(async (id) => {
    const p = pendientes.current.get(id); if (p) { clearTimeout(p.timer); pendientes.current.delete(id); }
    await borrarInformePronostico(id);
    setInformes((l) => (l || []).filter((i) => i.id !== id));
  }, []);

  /** Vuelve a pedir un informe sólo para traer su `meta` (publicado, correos, placa), sin tocar lo que se esté escribiendo. */
  const refrescarMeta = useCallback(async (id) => {
    try { const nuevo = (await getInformesPronostico()).find((i) => i.id === id); if (nuevo) mezclar(nuevo); } catch { /* la tarjeta se actualiza en la próxima carga */ }
  }, [mezclar]);

  return { informes, error, guardado, cargar, setCampo, reemplazar, crear, borrar, mezclar, guardarYa, refrescarMeta };
}
