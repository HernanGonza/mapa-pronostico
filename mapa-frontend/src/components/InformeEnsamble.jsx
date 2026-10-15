import { useEffect, useState } from "react";
import { FileText, ChevronRight } from "lucide";
import { Link } from "react-router-dom";
import Icono from "./Icono";
import InformePronostico, { aMapa, borradorConAlgo, borradorVacio, conCampo, problemasParaMapa } from "./InformePronostico";
import { estadoDeInforme } from "./TarjetaInformePronostico";
import { origenDe, usePublicado } from "./PronosticoPublicado";
import { publicarPronosticoPorPasos } from "../lib/asistentesPronostico";
import { calcularCambios } from "../lib/cambiosPronostico";
import { useInformesPronostico } from "../lib/useInformesPronostico";
import { getActual, marcarInformePublicado, publicar } from "../api";
import { notificar } from "../lib/ui";

/**
 * El informe de pronóstico dentro del ensamble: es EXACTAMENTE el mismo de «Previsión del tiempo» (mismo cajón, mismos pasos,
 * mismo PDF, mismas tarjetas guardadas y misma publicación en los mapas); lo único propio es el paso «Completar con los modelos»,
 * que llena las temperaturas, la humedad y el viento con el promedio de los modelos prendidos.
 *
 * Un informe nuevo es sólo un borrador (se guarda en este navegador) hasta que se aprieta «Guardar informe» en el último paso:
 * ahí pasa a ser una tarjeta de la pila de «Previsión del tiempo», donde se envía por correo, se arma la placa, etc.
 */
const CLAVE = "ensamble-informe-nuevo-v2";

/** El estado del informe que se arma desde el ensamble. La pantalla lo mantiene siempre montado (ocultar el cajón no pierde nada). */
export function useInforme() {
  const inf = useInformesPronostico();
  const [nuevo, setNuevo] = useState(() => { try { return JSON.parse(localStorage.getItem(CLAVE))?.borrador || null; } catch { return null; } });
  const [abiertoId, setAbiertoId] = useState(() => (nuevo ? "nuevo" : null)); // id de un informe guardado, o "nuevo"
  const [paso, setPaso] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [publicado, setPublicado] = useState(null); // lo que muestran ahora los mapas públicos
  const metaPublicado = usePublicado(publicado?.publicadoEn);
  useEffect(() => { try { if (nuevo) localStorage.setItem(CLAVE, JSON.stringify({ borrador: nuevo })); else localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento: no se guarda el borrador */ } }, [nuevo]);
  useEffect(() => { getActual().then((a) => a && setPublicado(a)).catch(() => {}); }, []);

  const abierto = abiertoId === "nuevo" ? (nuevo ? { id: null, borrador: nuevo, meta: {} } : null) : inf.informes?.find((i) => i.id === abiertoId) || null;

  return {
    abierto, paso, setPaso, guardando, publicado, error: inf.error, guardado: abiertoId == null || abiertoId === "nuevo" ? undefined : inf.guardado[abiertoId],
    /** Hay algo a medio hacer (para el punto del botón). */
    escritos: nuevo && borradorConAlgo(nuevo) ? 1 : 0,
    /** Qué informe se muestra al abrir el cajón: el que se venía armando, o uno nuevo. */
    preparar: () => { if (abiertoId == null || (abiertoId === "nuevo" && !nuevo)) { setNuevo(borradorVacio()); setAbiertoId("nuevo"); setPaso(0); } },
    nuevoInforme: () => { if (!nuevo) setNuevo(borradorVacio()); setAbiertoId("nuevo"); setPaso(0); },
    setCampo: (camino, valor) => (abiertoId === "nuevo" ? setNuevo((b) => conCampo(b, camino, valor)) : abiertoId != null && inf.setCampo(abiertoId, camino, valor)),
    reemplazar: (b) => (abiertoId === "nuevo" ? setNuevo(b) : abiertoId != null && inf.reemplazar(abiertoId, b)),
    guardarNuevo: async () => {
      if (!nuevo || guardando) return;
      setGuardando(true);
      try { const n = await inf.crear(nuevo); setNuevo(null); setAbiertoId(n.id); notificar("success", `Informe #${n.id} guardado: ya está en la pila de «Previsión del tiempo».`); }
      catch (e) { notificar("error", e.message); } finally { setGuardando(false); }
    },
    /** Publica el informe abierto en los mapas (mismo proceso que en «Previsión del tiempo», marcado como hecho desde el ensamble). */
    publicarAbierto: async () => {
      const i = abierto;
      if (!i || i.id == null || problemasParaMapa(i.borrador).length) return;
      const m = aMapa(i.borrador);
      const cambios = calcularCambios(m.filas, publicado?.filas);
      const fechaCambiada = m.fecha !== (publicado?.fechaPronostico ? String(publicado.fechaPronostico).slice(0, 10) : "");
      await inf.guardarYa(i.id);
      return publicarPronosticoPorPasos({
        cantidad: m.filas.length, sinPublicar: !publicado, fecha: m.fecha, fechaCambiada, cambios,
        republicar: estadoDeInforme(i, publicado).enMapas && !cambios?.length && !fechaCambiada,
        publicadoDesde: metaPublicado ? `${origenDe(metaPublicado).toLowerCase()}${metaPublicado.publicadoPor ? `, por ${metaPublicado.publicadoPor}` : ""}` : null,
        publicar: async () => {
          const p = await publicar(m.filas, m.fecha, m.extendido, "ensamble");
          setPublicado(p);
          try { inf.mezclar(await marcarInformePublicado(i.id, p.publicadoEn)); } catch { await inf.refrescarMeta(i.id); }
        },
      });
    },
  };
}

/** El botón grande que abre y oculta el cajón (la pantalla lo pone a la derecha del cuadro del rango de fecha y hora). */
export function BotonInforme({ abierto, onClick, escritos }) {
  return <button type="button" className={`ens-boton-informe${abierto ? " ens-boton-informe--abierto" : ""}`} onClick={onClick} aria-expanded={abierto} aria-controls="ens-cajon">
    <Icono icono={abierto ? ChevronRight : FileText} size={34} strokeWidth={1.5} />
    <span className="ens-boton-informe-texto"><strong>{abierto ? "Ocultar el informe" : "Informe de pronóstico"}</strong>
      <small>{abierto ? "Lo escrito queda guardado" : escritos > 0 ? "Seguir con el informe sin guardar" : "Armarlo paso a paso con los modelos"}</small></span>
    {!abierto && escritos > 0 && <i className="ens-cajon-punto" title="Hay un informe sin guardar" />}
  </button>;
}

/** El cajón: se abre y se oculta con el botón; es el mismo componente que usa «Previsión del tiempo». */
export default function InformeEnsamble({ informe, abierto, onCerrar, prendidos, modelos }) {
  return <InformePronostico
    informe={informe.abierto} abierto={abierto} onCerrar={onCerrar} paso={informe.paso} setPaso={informe.setPaso}
    setCampo={informe.setCampo} reemplazar={informe.reemplazar} guardado={informe.guardado} publicado={informe.publicado}
    alPublicar={informe.publicarAbierto} alGuardar={informe.guardarNuevo} guardando={informe.guardando}
    modelos={{ prendidos, catalogo: modelos }} alNuevo={informe.nuevoInforme}
    verTodos={<Link to="/panel/pronostico" className="btn-link">Ver la pila</Link>} />;
}
