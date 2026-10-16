import { Fragment, useState } from "react";
import * as api from "../api";
import { REDES, MESES, leerNumero } from "../lib/precipitacionesCalculo";

/** Las estaciones de la planilla: nombre, red, ubicación (para el mapa), si están activas, el orden de las columnas y las 12 medias mensuales. */
const aTexto = (v) => (v == null ? "" : String(v).replace(".", ","));
const vacia = { nombre: "", red: 3, lat: "", lng: "" };

function Medias({ est, todas, alGuardar, alError }) {
  const inicial = () => Object.fromEntries(MESES.map((_, i) => [i + 1, aTexto(est.medias[i + 1]?.mediaMm)]));
  const [valores, setValores] = useState(inicial);
  const [ref, setRef] = useState(() => { const m = Object.values(est.medias).find((x) => x.usaMediaDe != null); return m ? String(m.usaMediaDe) : ""; });
  const [guardando, setGuardando] = useState(false);
  async function guardar() {
    const medias = MESES.map((_, i) => ({ mes: i + 1, mediaMm: ref ? null : leerNumero(valores[i + 1]), usaMediaDe: ref ? Number(ref) : null }));
    if (medias.some((m) => m.mediaMm != null && !(Number.isFinite(m.mediaMm) && m.mediaMm >= 0))) { alError("Hay una media que no es un número."); return; }
    setGuardando(true);
    try { await api.guardarMediasPrecipitaciones(est.id, medias); await alGuardar(); } catch (e) { alError(e.message); } finally { setGuardando(false); }
  }
  return <div className="prec-medias">
    <label className="prec-campo">Tomar la media de otra estación<select value={ref} onChange={(e) => setRef(e.target.value)}>
      <option value="">No: usa sus propias medias</option>{todas.filter((x) => x.id !== est.id).map((x) => <option key={x.id} value={x.id}>{x.nombre} ({REDES[x.red]})</option>)}</select></label>
    <div className="prec-medias__grid">{MESES.map((m, i) => <label key={m} className="prec-campo">{m.slice(0, 3)}
      <input inputMode="decimal" disabled={!!ref} value={valores[i + 1]} onChange={(e) => setValores((v) => ({ ...v, [i + 1]: e.target.value.replace(/[^0-9.,]/g, "") }))} placeholder="mm" /></label>)}</div>
    <button type="button" className="prec-btn prec-btn--primario" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar medias"}</button>
  </div>;
}

export default function EstacionesPrecipitaciones({ estaciones, alCambiar, alError }) {
  const [nueva, setNueva] = useState(vacia), [editando, setEditando] = useState({}), [abierta, setAbierta] = useState(null), [ocupado, setOcupado] = useState(false);
  const cuerpo = (f) => ({ nombre: f.nombre.trim(), red: Number(f.red), lat: leerNumero(f.lat), lng: leerNumero(f.lng) });
  const errorDe = (f) => { const b = cuerpo(f); return !b.nombre ? "Escribí el nombre." : (b.lat == null) !== (b.lng == null) ? "Cargá la latitud y la longitud juntas, o ninguna." : [b.lat, b.lng].some((x) => x != null && !Number.isFinite(x)) ? "La latitud o la longitud no es un número." : null; };
  const correr = async (fn, ok) => { setOcupado(true); alError(""); try { await fn(); await alCambiar(); ok?.(); } catch (e) { alError(e.message); } finally { setOcupado(false); } };

  const agregar = () => { const e = errorDe(nueva); if (e) { alError(e); return; } correr(() => api.crearEstacionPrecipitaciones(cuerpo(nueva)), () => setNueva(vacia)); };
  const campos = (e) => editando[e.id] ?? { nombre: e.nombre, red: e.red, lat: aTexto(e.lat), lng: aTexto(e.lng) };
  const poner = (e, c) => setEditando((x) => ({ ...x, [e.id]: { ...campos(e), ...c } }));
  const guardar = (e) => { const f = campos(e), er = errorDe(f); if (er) { alError(er); return; } correr(() => api.corregirEstacionPrecipitaciones(e.id, cuerpo(f)), () => setEditando((x) => { const n = { ...x }; delete n[e.id]; return n; })); };
  const mover = (i, d) => { const ids = estaciones.map((e) => e.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; correr(() => api.ordenarEstacionesPrecipitaciones(ids)); };
  const quitar = (e) => { if (!window.confirm(`¿Quitar «${e.nombre}» (${REDES[e.red]})? Se borran también todos sus datos diarios y sus medias. Si sólo querés ocultarla, destildá «Activa».`)) return; correr(() => api.quitarEstacionPrecipitaciones(e.id)); };

  return <div className="prec-estaciones">
    <p className="prec-ayuda">Cada estación es una columna de la planilla. «Posadas» puede estar dos veces si es de dos redes distintas. La ubicación (latitud y longitud) hace que aparezca en el mapa. Las inactivas no se muestran en la planilla ni en la página, pero conservan sus datos.</p>
    <div className="prec-tabla-scroll"><table>
      <thead><tr><th>Orden</th><th>Estación</th><th>Red</th><th>Latitud</th><th>Longitud</th><th>Activa</th><th>Acciones</th></tr></thead>
      <tbody>
        <tr className="prec-nueva"><td>nueva</td>
          <td><input aria-label="Nombre de la estación nueva" maxLength={80} value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} placeholder="Ej.: Montecarlo" /></td>
          <td><select aria-label="Red" value={nueva.red} onChange={(e) => setNueva({ ...nueva, red: e.target.value })}>{Object.entries(REDES).map(([v, t]) => <option key={v} value={v}>{v} · {t}</option>)}</select></td>
          <td><input inputMode="decimal" aria-label="Latitud" value={nueva.lat} onChange={(e) => setNueva({ ...nueva, lat: e.target.value.replace(/[^0-9.,-]/g, "") })} placeholder="-27,36" /></td>
          <td><input inputMode="decimal" aria-label="Longitud" value={nueva.lng} onChange={(e) => setNueva({ ...nueva, lng: e.target.value.replace(/[^0-9.,-]/g, "") })} placeholder="-55,90" /></td>
          <td /><td><button type="button" className="prec-btn prec-btn--primario" disabled={ocupado} onClick={agregar}>+ Agregar</button></td></tr>
        {estaciones.map((e, i) => {
          const f = campos(e), cambio = !!editando[e.id];
          return <Fragment key={e.id}>
            <tr className={e.activa ? "" : "prec-inactiva"}>
              <td className="prec-orden"><button type="button" className="prec-btn" disabled={ocupado || i === 0} aria-label={`Subir ${e.nombre}`} onClick={() => mover(i, -1)}>▲</button><button type="button" className="prec-btn" disabled={ocupado || i === estaciones.length - 1} aria-label={`Bajar ${e.nombre}`} onClick={() => mover(i, 1)}>▼</button></td>
              <td><input aria-label={`Nombre de ${e.nombre}`} maxLength={80} value={f.nombre} onChange={(ev) => poner(e, { nombre: ev.target.value })} /></td>
              <td><select aria-label={`Red de ${e.nombre}`} value={f.red} onChange={(ev) => poner(e, { red: ev.target.value })}>{Object.entries(REDES).map(([v, t]) => <option key={v} value={v}>{v} · {t}</option>)}</select></td>
              <td><input inputMode="decimal" aria-label={`Latitud de ${e.nombre}`} value={f.lat} onChange={(ev) => poner(e, { lat: ev.target.value.replace(/[^0-9.,-]/g, "") })} /></td>
              <td><input inputMode="decimal" aria-label={`Longitud de ${e.nombre}`} value={f.lng} onChange={(ev) => poner(e, { lng: ev.target.value.replace(/[^0-9.,-]/g, "") })} /></td>
              <td><input type="checkbox" aria-label={`${e.nombre} activa`} checked={e.activa} disabled={ocupado} onChange={(ev) => correr(() => api.corregirEstacionPrecipitaciones(e.id, { activa: ev.target.checked }))} /></td>
              <td className="prec-acciones">
                {cambio && <button type="button" className="prec-btn prec-btn--primario" disabled={ocupado} onClick={() => guardar(e)}>Guardar</button>}
                <button type="button" className="prec-btn" aria-expanded={abierta === e.id} onClick={() => setAbierta(abierta === e.id ? null : e.id)}>Medias</button>
                <button type="button" className="prec-btn" disabled={ocupado} onClick={() => quitar(e)}>Quitar</button></td>
            </tr>
            {abierta === e.id && <tr className="prec-medias-fila"><td colSpan={7}><Medias est={e} todas={estaciones} alGuardar={alCambiar} alError={alError} /></td></tr>}
          </Fragment>;
        })}
      </tbody></table></div>
  </div>;
}
