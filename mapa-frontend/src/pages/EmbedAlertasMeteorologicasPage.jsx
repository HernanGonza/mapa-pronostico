import { useEffect, useState } from "react";
import RiesgoMap from "../components/RiesgoMap";
import { getAlertasMeteorologicasCatalogo, getAlertasMeteorologicasGeojson, getAlertasMeteorologicasVigentes } from "../api";
import { alCambiarDemo } from "../lib/demo";
import SelloDemo from "../components/SelloDemo";

const AR = "America/Argentina/Buenos_Aires";
const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: AR, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// Página pensada para ir en el <iframe> del sitio del ministerio: solo lectura.
// Una tarjeta por cada alerta publicada y vigente (pasada su vigencia desaparece
// sola) de /panel/alertas-meteorologicas (puede haber varias: hoy, mañana…). Al elegir una
// tarjeta (o pasar de página), el mapa muestra esa alerta y abajo va su descripción. Si en el
// panel se fijó una a mano, se ve sólo ésa; si no, todas las vigentes según su vigencia.
export default function EmbedAlertasMeteorologicasPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [elegida, setElegida] = useState(null);
  const [ahora, setAhora] = useState(Date.now());

  useEffect(() => {
    let cancelado = false, base;
    async function cargar() {
      try {
        if (!base) base = await Promise.all([getAlertasMeteorologicasCatalogo(), getAlertasMeteorologicasGeojson()]);
        const manuales = await getAlertasMeteorologicasVigentes();
        if (!cancelado) { setData({ catalogo: base[0], geo: base[1], manuales }); setError(""); }
      } catch (e) { if (!cancelado) setError(e.message); }
    }
    cargar();
    const timer = setInterval(cargar, 60000), reloj = setInterval(() => setAhora(Date.now()), 15000);
    const dejar = alCambiarDemo(cargar); // modo demostración: al prender/apagar, se ve en el momento
    return () => { cancelado = true; clearInterval(timer); clearInterval(reloj); dejar(); };
  }, []);

  if (!data) return <div className="base-map base-map--fallback"><div><strong>Alertas meteorológicas · Misiones</strong><p>{error || "Cargando mapa…"}</p></div></div>;

  // Si una alerta vence entre dos consultas, se saca igual en el momento.
  const manualesVigentes = data.manuales.filter((m) => Date.parse(m.vigenteHasta) > ahora);
  // ?id=manual-<id>: sólo esa alerta (la pantalla de transmisión /tv muestra cada una por separado).
  const soloId = new URLSearchParams(window.location.search).get("id");
  // Fijada a mano desde el panel: se ve sólo ésa.
  const fijada = manualesVigentes.find((m) => m.fijada);
  const tarjetas = [
    // Todo verde no es una alerta: no lleva tarjeta (se ve el mapa verde, sin cartel).
    ...(fijada ? [fijada] : manualesVigentes).filter(esAlerta).map((m) => ({ clave: `manual-${m.id}`, tipo: "manual", manual: m })),
  ].filter((t) => !soloId || t.clave === soloId);
  // Sin alertas: el mapa con los departamentos en verde, igual que los otros mapas del sitio.
  if (!tarjetas.length) {
    const verde = fijada || manualesVigentes.at(-1);
    const zonas = verde?.zonas || data.catalogo.departamentos.map((d) => ({ id: String(d.id), categoria: "Verde" }));
    return <div className="embed-risk"><SelloDemo />{error && <div className="embed-warning" role="status">No se pudo actualizar. Se muestra lo último recibido.</div>}
      <RiesgoMap embed geo={data.geo} zonas={zonas} iconos={[]} catalogo={data.catalogo} publicadoEn={verde?.publicadoEn} titulo="Alertas meteorológicas" metaTitulo="Sin alertas publicadas" />
    </div>;
  }
  const actual = tarjetas.find((t) => t.clave === elegida) || tarjetas[0];
  const indice = tarjetas.indexOf(actual);
  const ir = (paso) => setElegida(tarjetas[(indice + paso + tarjetas.length) % tarjetas.length].clave);
  const colorDe = (t) => colorNivel(t.manual, data.catalogo);

  return <div className="alertas-embed">
    <SelloDemo />
    {error && <div className="embed-warning" role="status">No se pudo actualizar. Se muestra lo último recibido.</div>}
    {/* Sólo si hay para elegir: con una sola alerta el período ya va en el título del mapa,
        y el cartel le quitaba lugar al mapa en el iframe chico del sitio (371×464). */}
    {tarjetas.length > 1 && <div className="alertas-embed__tarjetas" role="tablist" aria-label="Alertas vigentes">
      {tarjetas.map((t) => <button key={t.clave} type="button" role="tab" aria-selected={t === actual} className="alertas-embed__tarjeta"
        style={{ "--alerta-color": colorDe(t) }} onClick={() => setElegida(t.clave)}>
        <strong>{t.manual.periodo}</strong>
        <span className="alertas-embed__nivel">Alerta {FEMENINO[nivelManual(t.manual)] || ""} por departamentos</span>
        <small>Publicada el {fechaHora(t.manual.publicadoEn)}</small>
      </button>)}
    </div>}
    {/* Se superponen varias: páginas para pasar de una a otra (además de las tarjetas). */}
    {tarjetas.length > 1 && <div className="alertas-embed__paginas" aria-label="Páginas">
      <button type="button" onClick={() => ir(-1)} aria-label="Alerta anterior">‹</button>
      <span>{indice + 1} de {tarjetas.length}</span>
      <button type="button" onClick={() => ir(1)} aria-label="Alerta siguiente">›</button>
    </div>}
    <div className="alertas-embed__mapa">
      <RiesgoMap key={actual.clave} embed geo={data.geo} zonas={actual.manual.zonas} iconos={actual.manual.iconos || []} leyendas={actual.manual.leyendas} catalogo={data.catalogo} publicadoEn={actual.manual.publicadoEn} titulo={`Alertas meteorológicas · ${actual.manual.periodo}`} />
    </div>
  </div>;
}

const ORDEN = { Amarillo: 1, Naranja: 2, Rojo: 3 };
const FEMENINO = { Amarillo: "amarilla", Naranja: "naranja", Rojo: "roja" };
/** Nivel de una publicación manual: el más alto de sus departamentos. */
const nivelManual = (m) => (m.zonas || []).map((z) => z.categoria).reduce((a, b) => ((ORDEN[b] || 0) > (ORDEN[a] || 0) ? b : a), "Verde");
const colorNivel = (m, catalogo) => catalogo.categorias.find((c) => c.nombre === nivelManual(m))?.color || "#2f8f5b";

/** Una publicación manual es una alerta si algún departamento no está en verde (ni gris, sin dato). */
const esAlerta = (m) => (m.zonas || []).some((z) => z.categoria && !["Verde", "Gris"].includes(z.categoria));
