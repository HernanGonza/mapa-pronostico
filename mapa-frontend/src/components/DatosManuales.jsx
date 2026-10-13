import { useState } from "react";
import { claveManual, manualConDatos, manualVacia } from "../lib/informesManuales";

/**
 * Estaciones que no llegan solas: nos mandan los datos por otro medio y se cargan acá. Hay una estación base y un «+» para sumar más.
 * Cada una tiene los mismos datos que traen las automáticas (lluvia, ráfaga, viento, temperaturas, caída brusca) y su interruptor;
 * se ubica por municipio para que aparezca en el mapa. Nada se envía al servidor hasta «Juntar datos».
 */
function Campo({ etiqueta, children, ancho }) { return <label className={`manual-campo${ancho ? ` manual-campo--${ancho}` : ""}`}><span>{etiqueta}</span>{children}</label>; }
const Num = ({ valor, alCambiar, unidad }) => <span className="manual-num"><input inputMode="decimal" placeholder="—" value={valor} onChange={(e) => alCambiar(e.target.value.replace(/[^0-9.,]/g, ""))} />{unidad && <i>{unidad}</i>}</span>;
const Hora = ({ valor, alCambiar, etiqueta }) => <input type="time" className="manual-hora" aria-label={etiqueta} value={valor} onChange={(e) => alCambiar(e.target.value)} />;

export default function DatosManuales({ manuales, alCambiar, apagadas, alCambiarApagadas, municipios }) {
  const [abierta, setAbierta] = useState(() => manuales[0]?.id || null);
  const poner = (id, cambios) => alCambiar(manuales.map((m) => (m.id === id ? { ...m, ...cambios } : m)));
  const sumar = () => { const m = manualVacia(manuales.length + 1); alCambiar([...manuales, m]); setAbierta(m.id); };
  const quitar = (m) => { if (!window.confirm(`¿Quitar «${m.nombre}»? Se pierden los datos que escribiste.`)) return; alCambiar(manuales.filter((x) => x.id !== m.id)); };
  const prender = (m) => { const n = new Set(apagadas); const c = claveManual(m); if (n.has(c)) n.delete(c); else n.add(c); alCambiarApagadas(n); };
  const ubicar = (m, id) => { const mu = municipios.find((x) => x.id === id); poner(m.id, { municipioId: id, lat: mu?.lat ?? null, lng: mu?.lng ?? null }); };

  return <div className="manuales">
    {manuales.map((m, i) => {
      const prendida = !apagadas.has(claveManual(m)), abierto = abierta === m.id, con = manualConDatos(m);
      return <article key={m.id} className={`red-tarjeta manual-tarjeta${prendida ? "" : " red-tarjeta--apagada"}`}>
        <div className="red-tarjeta__cab">
          <button type="button" className="red-tarjeta__titulo" aria-expanded={abierto} onClick={() => setAbierta(abierto ? null : m.id)}>
            <span className="red-tarjeta__nombre"><span className="red-tarjeta__flecha" aria-hidden="true">{abierto ? "▾" : "▸"}</span><strong>{m.nombre || "Sin nombre"}</strong>
              <span className="red-tarjeta__cuenta">{i === 0 ? "base" : "manual"}</span></span>
            <small>{con ? `Lluvia ${m.lluviaTotal || "—"} mm${m.municipioId ? "" : " · sin ubicación (no sale en el mapa)"}` : "Sin datos cargados"}</small>
          </button>
          <button type="button" role="switch" aria-checked={prendida} aria-label={`${m.nombre}: ${prendida ? "apagar" : "prender"}`} className={`red-interruptor red-interruptor--${prendida ? "todas" : "ninguna"}`} onClick={() => prender(m)} />
        </div>
        {abierto && <div className="manual-form">
          <Campo etiqueta="Nombre de la estación" ancho="2"><input value={m.nombre} maxLength={80} onChange={(e) => poner(m.id, { nombre: e.target.value })} /></Campo>
          <Campo etiqueta="Quién la envió / por qué medio" ancho="2"><input value={m.fuente} maxLength={120} placeholder="Ej.: Bomberos, WhatsApp" onChange={(e) => poner(m.id, { fuente: e.target.value })} /></Campo>
          <Campo etiqueta="Municipio (para ubicarla en el mapa)" ancho="2">
            <select value={m.municipioId} onChange={(e) => ubicar(m, e.target.value)}><option value="">Sin ubicar</option>{municipios.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></Campo>

          <fieldset><legend>Lluvia</legend>
            <Campo etiqueta="Total del período"><Num valor={m.lluviaTotal} unidad="mm" alCambiar={(v) => poner(m.id, { lluviaTotal: v })} /></Campo>
            <Campo etiqueta="Máxima en una ventana"><Num valor={m.lluviaMax} unidad="mm" alCambiar={(v) => poner(m.id, { lluviaMax: v })} /></Campo>
            <Campo etiqueta="Ventana"><select value={m.ventana} onChange={(e) => poner(m.id, { ventana: Number(e.target.value) })}><option value={30}>30 min</option><option value={60}>1 h</option></select></Campo>
            <Campo etiqueta="Hora de esa máxima"><Hora valor={m.lluviaMaxHora} etiqueta="Hora de la lluvia máxima" alCambiar={(v) => poner(m.id, { lluviaMaxHora: v })} /></Campo>
            <Campo etiqueta="Empezó a llover"><Hora valor={m.inicioLluvia} etiqueta="Hora en que empezó a llover" alCambiar={(v) => poner(m.id, { inicioLluvia: v })} /></Campo>
          </fieldset>
          <fieldset><legend>Viento</legend>
            <Campo etiqueta="Ráfaga máxima"><Num valor={m.rafaga} unidad="km/h" alCambiar={(v) => poner(m.id, { rafaga: v })} /></Campo>
            <Campo etiqueta="Hora de la ráfaga"><Hora valor={m.rafagaHora} etiqueta="Hora de la ráfaga" alCambiar={(v) => poner(m.id, { rafagaHora: v })} /></Campo>
            <Campo etiqueta="Viento medio máximo"><Num valor={m.viento} unidad="km/h" alCambiar={(v) => poner(m.id, { viento: v })} /></Campo>
            <Campo etiqueta="Hora del viento medio"><Hora valor={m.vientoHora} etiqueta="Hora del viento medio" alCambiar={(v) => poner(m.id, { vientoHora: v })} /></Campo>
          </fieldset>
          <fieldset><legend>Temperatura</legend>
            <Campo etiqueta="Máxima"><Num valor={m.tMax} unidad="°C" alCambiar={(v) => poner(m.id, { tMax: v })} /></Campo>
            <Campo etiqueta="Hora de la máxima"><Hora valor={m.tMaxHora} etiqueta="Hora de la temperatura máxima" alCambiar={(v) => poner(m.id, { tMaxHora: v })} /></Campo>
            <Campo etiqueta="Mínima"><Num valor={m.tMin} unidad="°C" alCambiar={(v) => poner(m.id, { tMin: v })} /></Campo>
            <Campo etiqueta="Hora de la mínima"><Hora valor={m.tMinHora} etiqueta="Hora de la temperatura mínima" alCambiar={(v) => poner(m.id, { tMinHora: v })} /></Campo>
            <Campo etiqueta="Caída brusca (llegada de la tormenta)"><Num valor={m.caida} unidad="°C" alCambiar={(v) => poner(m.id, { caida: v })} /></Campo>
            <Campo etiqueta="En cuánto tiempo"><select value={m.caidaMinutos} onChange={(e) => poner(m.id, { caidaMinutos: Number(e.target.value) })}><option value={30}>30 min</option><option value={60}>1 h</option></select></Campo>
            <Campo etiqueta="Hora de la caída"><Hora valor={m.caidaHora} etiqueta="Hora de la caída de temperatura" alCambiar={(v) => poner(m.id, { caidaHora: v })} /></Campo>
          </fieldset>
          {i > 0 && <button type="button" className="btn btn--danger manual-quitar" onClick={() => quitar(m)}>Quitar esta estación</button>}
        </div>}
      </article>;
    })}
    <button type="button" className="manual-mas" onClick={sumar}><span aria-hidden="true">+</span> Agregar otra estación manual</button>
  </div>;
}
