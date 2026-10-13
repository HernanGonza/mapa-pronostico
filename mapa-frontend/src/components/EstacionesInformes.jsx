import { useState } from "react";

/** Una estación sin lecturas hace más de esto se marca (sólo las de la RMET y la RHN traen la fecha de su última lectura). */
const DIAS_SIN_DATOS = 3;
const hace = (ms) => { const h = (Date.now() - ms) / 3600e3; return h < 48 ? `última lectura hace ${h < 1 ? "menos de 1" : Math.round(h)} h` : `sin datos hace ${Math.round(h / 24)} días`; };

/** Interruptor de tres estados: prendido, apagado y «algunas» (la red con sólo parte de sus estaciones prendidas). */
function Interruptor({ estado, alCambiar, etiqueta, chico = false }) {
  return <button type="button" role="switch" aria-checked={estado === "algunas" ? "mixed" : estado === "todas"} aria-label={etiqueta}
    className={`red-interruptor red-interruptor--${estado}${chico ? " red-interruptor--chico" : ""}`} onClick={(e) => { e.stopPropagation(); alCambiar(); }} />;
}

/**
 * Las redes de estaciones y cada estación, con su interruptor: sólo lo prendido se consulta y entra en los cálculos, el mapa, los gráficos
 * y los archivos. `apagadas` es el conjunto de claves apagadas (así una estación nueva nace prendida). La tarjeta de la red prende o apaga
 * todas las suyas; se abre para elegir de a una (por ejemplo, de SiNaRaMe sólo la que anda).
 */
export default function EstacionesInformes({ catalogo, apagadas, alCambiar, consultadas = null }) {
  const [abiertas, setAbiertas] = useState(() => new Set());
  if (!catalogo) return <p className="admin-panel__hint">Cargando las estaciones…</p>;
  const cambiar = (claves, prender) => { const n = new Set(apagadas); claves.forEach((c) => (prender ? n.delete(c) : n.add(c))); alCambiar(n); };
  const alternarAbierta = (id) => setAbiertas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return <div className="red-estaciones">
    {catalogo.avisos?.length > 0 && <p className="paso-aviso" role="status">{catalogo.avisos.join(" · ")} (esas estaciones no figuran por ahora)</p>}
    {catalogo.redes.map((r) => {
      const est = catalogo.estaciones.filter((e) => e.redId === r.id);
      if (!est.length) return null;
      const prendidas = est.filter((e) => !apagadas.has(e.clave)).length, estado = prendidas === est.length ? "todas" : prendidas === 0 ? "ninguna" : "algunas";
      const abierta = abiertas.has(r.id);
      return <article key={r.id} className={`red-tarjeta${estado === "ninguna" ? " red-tarjeta--apagada" : ""}`}>
        <div className="red-tarjeta__cab">
          <button type="button" className="red-tarjeta__titulo" aria-expanded={abierta} onClick={() => alternarAbierta(r.id)}>
            <span className="red-tarjeta__nombre"><span className="red-tarjeta__flecha" aria-hidden="true">{abierta ? "▾" : "▸"}</span><strong>{r.nombre}</strong><span className="red-tarjeta__cuenta">{prendidas} de {est.length}</span></span>
            <small>{r.detalle}</small>
          </button>
          <Interruptor estado={estado} etiqueta={`${r.nombre}: ${estado === "todas" ? "apagar todas las estaciones" : "prender todas las estaciones"}`} alCambiar={() => cambiar(est.map((e) => e.clave), estado !== "todas")} />
        </div>
        {abierta && <ul className="red-tarjeta__lista">{est.map((e) => {
          const prendida = !apagadas.has(e.clave), vieja = e.ultimaMs && Date.now() - e.ultimaMs > DIAS_SIN_DATOS * 86400e3;
          return <li key={e.clave} className={prendida ? "" : "is-apagada"}>
            <Interruptor chico estado={prendida ? "todas" : "ninguna"} etiqueta={`${e.nombre}: ${prendida ? "apagar" : "prender"}`} alCambiar={() => cambiar([e.clave], !prendida)} />
            <span className="red-estacion__nombre">{e.nombre}</span>
            {e.ultimaMs ? <small className={vieja ? "red-estacion__vieja" : ""}>{hace(e.ultimaMs)}</small> : null}
            {prendida && consultadas && !consultadas.has(e.clave) && <small className="red-estacion__nueva">sin consultar</small>}
          </li>;
        })}</ul>}
      </article>;
    })}
  </div>;
}
