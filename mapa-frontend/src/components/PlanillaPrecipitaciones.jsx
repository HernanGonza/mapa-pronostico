import { useRef } from "react";
import { MESES, REDES, REDES_LARGO, SUPER, coma, diasDelMes, fechaDe, leerNumero, notasDeMedia, totalesDelMes } from "../lib/precipitacionesCalculo";

/**
 * La hoja de un mes, como en el Excel: una fila por día y una columna por estación, y abajo TOTAL (suma), MEDIA y ANOMALÍA (total − media).
 * Con `alEditar` las celdas se escriben (se mueve con Enter/flechas y se pegan bloques copiados de Excel); sin él es de sólo lectura.
 *   mapa        Map «id|fecha» → mm con las ediciones ya aplicadas (de ahí salen los totales)
 *   texto       Map «id|fecha» → lo que se está escribiendo (celdas editadas, sin guardar)
 */
const valido = (t) => { const n = leerNumero(t); return n === null || (Number.isFinite(n) && n >= 0 && n <= 1500); };

export default function PlanillaPrecipitaciones({ estaciones, todas, mapa, anio, mes, texto, alEditar, hoy }) {
  const cuerpo = useRef(null);
  const porId = new Map(todas.map((e) => [e.id, e]));
  const dias = Array.from({ length: diasDelMes(anio, mes) }, (_, i) => i + 1);
  const totales = estaciones.map((e) => ({ e, ...totalesDelMes(e, anio, mes, mapa, porId) }));
  const { leyendas, marcaDe } = notasDeMedia(totales);
  const redes = [...new Set(estaciones.map((e) => e.red))].sort();
  const editable = !!alEditar;
  const mostrar = (k) => (texto?.has(k) ? texto.get(k) : mapa.has(k) ? String(mapa.get(k)).replace(".", ",") : "");

  const foco = (r, c) => { cuerpo.current?.querySelector(`input[data-r="${r}"][data-c="${c}"]`)?.focus(); };
  const alTeclear = (e, r, c) => {
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); foco(r + 1, c); }
    else if (e.key === "ArrowUp") { e.preventDefault(); foco(r - 1, c); }
    else if (e.key === "ArrowRight" && e.target.selectionStart === e.target.value.length) { e.preventDefault(); foco(r, c + 1); }
    else if (e.key === "ArrowLeft" && e.target.selectionEnd === 0) { e.preventDefault(); foco(r, c - 1); }
  };
  // Pegar un bloque copiado de Excel: filas = días, columnas = estaciones, desde la celda elegida.
  const alPegar = (e, r, c) => {
    const t = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(t.replace(/\r?\n$/, ""))) return; // un solo valor: pega normal
    e.preventDefault();
    t.replace(/\r?\n$/, "").split(/\r?\n/).forEach((linea, i) => linea.split("\t").forEach((v, j) => {
      const est = estaciones[c + j], dia = dias[r + i];
      if (est && dia) alEditar(est.id, fechaDe(anio, mes, dia), v.trim());
    }));
  };

  return <div className="prec-hoja" ref={cuerpo} role="region" aria-label={`Precipitaciones de ${MESES[mes - 1]} ${anio}`} tabIndex={0}>
    <table>
      <thead><tr><th className="prec-hoja__dia">DIA</th>
        {estaciones.map((e) => <th key={e.id} className="prec-hoja__est" title={e.lat != null ? `${e.nombre} · ${REDES[e.red]} · ${e.lat}, ${e.lng}` : `${e.nombre} · ${REDES[e.red]}`}>{e.nombre}<sup>{e.red}</sup></th>)}</tr></thead>
      <tbody>
        {dias.map((d, r) => {
          const f = fechaDe(anio, mes, d);
          return <tr key={d} className={f === hoy ? "prec-hoja__hoy" : ""}><th scope="row" className="prec-hoja__dia">{d}</th>
            {estaciones.map((e, c) => {
              const k = `${e.id}|${f}`, v = mostrar(k), mal = texto?.has(k) && !valido(texto.get(k));
              return <td key={e.id} className={`${texto?.has(k) ? "prec-hoja__cambio" : ""}${mal ? " prec-hoja__mal" : ""}`}>
                {editable ? <input data-r={r} data-c={c} inputMode="decimal" value={v} aria-label={`${e.nombre}, día ${d}`} aria-invalid={mal || undefined}
                  onChange={(ev) => alEditar(e.id, f, ev.target.value.replace(/[^0-9.,]/g, ""))} onKeyDown={(ev) => alTeclear(ev, r, c)} onPaste={(ev) => alPegar(ev, r, c)} onFocus={(ev) => ev.target.select()} />
                  : <span>{v}</span>}
              </td>;
            })}</tr>;
        })}
        <tr className="prec-hoja__total"><th scope="row" className="prec-hoja__dia">TOTAL</th>{totales.map(({ e, total }) => <td key={e.id}>{coma(total)}</td>)}</tr>
        <tr className="prec-hoja__media"><th scope="row" className="prec-hoja__dia">MEDIA</th>{totales.map(({ e, media }) => <td key={e.id}>{coma(media)}</td>)}</tr>
        {leyendas.length > 0 && <tr className="prec-hoja__ast"><th className="prec-hoja__dia" aria-hidden="true" />{totales.map((t) => <td key={t.e.id}>{marcaDe(t)}</td>)}</tr>}
        <tr className="prec-hoja__anom"><th scope="row" className="prec-hoja__dia">ANOMALÍA</th>{totales.map(({ e, anomalia }) => <td key={e.id} className={anomalia == null ? "" : anomalia > 0 ? "pos" : anomalia < 0 ? "neg" : ""}>{anomalia == null ? "—" : `${anomalia > 0 ? "+" : ""}${coma(anomalia)}`}</td>)}</tr>
      </tbody>
    </table>
    <div className="prec-hoja__leyenda">
      {redes.map((r) => <span key={r}><sup>{r}</sup> {REDES_LARGO[r]}</span>)}
      {leyendas.map((l) => <span key={l.marca}>{l.marca} se toma la media de {l.nombre}</span>)}
      <span>Anomalía = total del mes − media. Las celdas vacías son «sin dato» (no es lo mismo que 0).</span>
    </div>
  </div>;
}
