import { useEffect, useState } from "react";
import BaseMap from "../components/BaseMap";
import RiesgoMap from "../components/RiesgoMap";
import { getAlertasMeteorologicasCatalogo, getAlertasMeteorologicasGeojson, getAlertasMeteorologicasVigentes, getAlertasSmnPublicadas } from "../api";

const AR = "America/Argentina/Buenos_Aires";
const dia = (iso) => new Date(iso).toLocaleDateString("es-AR", { timeZone: AR, weekday: "long", day: "2-digit", month: "2-digit" });
const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: AR, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const mismoDia = (a, b) => new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(new Date(a)) === new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(new Date(b));
/** "Miércoles 30/09, de 00:00 a 05:59" (o con los dos días si cruza la medianoche). */
function periodo(inicio, fin) {
  const d = dia(inicio);
  return mismoDia(inicio, fin) ? `${d.charAt(0).toUpperCase()}${d.slice(1)}, de ${hora(inicio)} a ${hora(fin)}` : `Desde el ${d} ${hora(inicio)} hasta el ${dia(fin)} ${hora(fin)}`;
}
const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: AR, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// Página pensada para ir en el <iframe> del sitio del ministerio: solo lectura.
// Una tarjeta por cada alerta publicada y vigente (pasada su vigencia desaparece
// sola): las por departamentos armadas a mano en /panel/alertas-meteorologicas
// (puede haber varias: hoy, mañana…) y las del SMN publicadas desde
// /panel/alertas-automaticas. Al elegir una
// tarjeta, el mapa muestra esa alerta y abajo va su descripción.
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
        const [manuales, smn] = await Promise.all([getAlertasMeteorologicasVigentes(), getAlertasSmnPublicadas().catch(() => [])]);
        if (!cancelado) { setData({ catalogo: base[0], geo: base[1], manuales, smn }); setError(""); }
      } catch (e) { if (!cancelado) setError(e.message); }
    }
    cargar();
    const timer = setInterval(cargar, 60000), reloj = setInterval(() => setAhora(Date.now()), 15000);
    return () => { cancelado = true; clearInterval(timer); clearInterval(reloj); };
  }, []);

  if (!data) return <div className="base-map base-map--fallback"><div><strong>Alertas meteorológicas · Misiones</strong><p>{error || "Cargando mapa…"}</p></div></div>;

  // Si una alerta vence entre dos consultas, se saca igual en el momento.
  const tarjetas = [
    ...data.manuales.filter((m) => Date.parse(m.vigenteHasta) > ahora).map((m) => ({ clave: `manual-${m.id}`, tipo: "manual", manual: m })),
    ...data.smn.filter((a) => Date.parse(a.vigenteHasta) > ahora).map((a) => ({ clave: `smn-${a.id}`, tipo: "smn", alerta: a })),
  ];
  if (!tarjetas.length) return <div className="base-map base-map--fallback"><div><strong>Alertas meteorológicas · Misiones</strong><p>No hay alertas meteorológicas vigentes para Misiones en este momento.</p></div></div>;
  const actual = tarjetas.find((t) => t.clave === elegida) || tarjetas[0];

  return <div className="alertas-embed">
    {error && <div className="embed-warning" role="status">No se pudo actualizar. Se muestra lo último recibido.</div>}
    <div className="alertas-embed__tarjetas" role="tablist" aria-label="Alertas vigentes">
      {tarjetas.map((t) => <button key={t.clave} type="button" role="tab" aria-selected={t === actual} className="alertas-embed__tarjeta"
        style={{ "--alerta-color": t.tipo === "smn" ? t.alerta.color || "#888" : "#2f8f5b" }} onClick={() => setElegida(t.clave)}>
        {t.tipo === "smn" ? <>
          <strong>{t.alerta.titulo}</strong>
          <span className="alertas-embed__nivel">Nivel {t.alerta.categoria}</span>
          <small>{periodo(t.alerta.inicio, t.alerta.fin)}</small>
        </> : <>
          <strong>{t.manual.periodo}</strong>
          <span className="alertas-embed__nivel">Alerta por departamentos</span>
          <small>Publicada el {fechaHora(t.manual.publicadoEn)}</small>
        </>}
      </button>)}
    </div>
    <div className="alertas-embed__mapa">
      {actual.tipo === "smn"
        ? <MapaAlertaSmn alerta={actual.alerta} geo={data.geo} />
        : <RiesgoMap key={actual.clave} embed geo={data.geo} zonas={actual.manual.zonas} iconos={actual.manual.iconos || []} catalogo={data.catalogo} publicadoEn={actual.manual.publicadoEn} titulo={`Alertas meteorológicas · ${actual.manual.periodo}`} />}
    </div>
    {actual.tipo === "smn" && <div className="alertas-embed__detalle" style={{ "--alerta-color": actual.alerta.color || "#888" }}>
      <h2>{actual.alerta.titulo} · Nivel {actual.alerta.categoria}</h2>
      <p className="alertas-embed__periodo">{periodo(actual.alerta.inicio, actual.alerta.fin)}</p>
      <p className="alertas-embed__zona">{actual.alerta.zonas.map((z) => z.departamentos?.length ? z.departamentos.join(", ") : z.nombre).join(" · ")}</p>
      {actual.alerta.descripcion && <p>{actual.alerta.descripcion}</p>}
      {actual.alerta.instrucciones && <p style={{ whiteSpace: "pre-line" }}>{actual.alerta.instrucciones}</p>}
      <small>Fuente: Servicio Meteorológico Nacional{actual.alerta.url && <> · <a href={actual.alerta.url} target="_blank" rel="noreferrer">documento oficial</a></>}</small>
    </div>}
  </div>;
}

/** Departamentos en gris y encima el área de la alerta del SMN, con el color de su nivel. */
function MapaAlertaSmn({ alerta, geo }) {
  const features = geo.features.map((f) => ({ ...f, properties: { ...f.properties, id: `base-${f.properties.id}` } }));
  const datos = [];
  alerta.zonas.forEach((z, i) => {
    if (!z.geometry) return;
    const id = `alerta-${i}`;
    features.push({ type: "Feature", geometry: z.geometry, properties: { id } });
    datos.push({ id, nombre: z.nombre, color: alerta.color });
  });
  return <BaseMap key={alerta.id} embed poligonos={{ type: "FeatureCollection", features }} datos={datos} colorDe={(d) => d?.color}
    titulo={`${alerta.titulo} · ${alerta.categoria}`} publicadoEn={alerta.emitidoEn}
    leyenda={<div className="risk-legend"><strong>Alerta {alerta.categoria}</strong>
      <div className="risk-legend__scale"><div><i style={{ background: alerta.color }} /><span>Área de la alerta</span></div></div>
      <small>Fuente: Servicio Meteorológico Nacional</small></div>}
    renderInfo={(d, { onCerrar }) => <div className="municipio-popover" role="dialog" aria-label={d.nombre}>
      <button className="municipio-popover__close" onClick={onCerrar} aria-label="Cerrar">✕</button>
      <h3>{d.nombre}</h3><p>{alerta.titulo} · {alerta.categoria}</p><p>{periodo(alerta.inicio, alerta.fin)}</p>
    </div>} />;
}
