import { useEffect, useRef, useState } from "react";
import WeatherIcon from "./WeatherIcon";
import { fechaLarga, tiempoRelativo } from "../lib/tiempoRelativo";

/** Reordena {zonas:[{zona,dias:[...]}], informes:[...]} a una lista por
 * día (Hoy/Sábado/Domingo), cada uno con las 3 zonas + el informe
 * narrativo de ese día — así arriba y abajo hablan del mismo día. */
function porDia(extendido) {
  const zonas = extendido?.zonas || [];
  const informes = extendido?.informes || [];
  const maxDias = Math.max(0, ...zonas.map((z) => z.dias.length));
  const dias = [];
  for (let i = 0; i < maxDias; i++) {
    const referencia = zonas.find((z) => z.dias[i])?.dias[i];
    if (!referencia) continue;
    dias.push({
      etiqueta: referencia.etiqueta,
      fecha: referencia.fecha,
      zonas: zonas.map((z) => ({ zona: z.zona, ...z.dias[i] })).filter((z) => z.tmin !== undefined),
      informe: informes[i]?.texto || null,
    });
  }
  return dias;
}

function parrafosDelInforme(informe) {
  return informe.trim().split(/\n\s*\n|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/).filter(Boolean);
}

function paginasDelInforme(informe, limite = 320) {
  const paginas = [];
  let pagina = "";
  for (const palabra of informe.trim().split(/\s+/)) {
    if (pagina && pagina.length + palabra.length + 1 > limite) {
      paginas.push(pagina);
      pagina = palabra;
    } else pagina += `${pagina ? " " : ""}${palabra}`;
  }
  if (pagina) paginas.push(pagina);
  return paginas;
}

function InformeDelDia({ informe, embebido }) {
  const parrafos = parrafosDelInforme(informe);
  const paginas = paginasDelInforme(informe);
  const primeraFrase = parrafos[0]?.trim() || "";
  const resumen = primeraFrase.length > 190 ? `${primeraFrase.slice(0, 190).replace(/\s+\S*$/, "")}…` : primeraFrase;
  const [abierto, setAbierto] = useState(false);
  const [pagina, setPagina] = useState(0);
  const cerrarRef = useRef(null);
  useEffect(() => { setAbierto(false); setPagina(0); }, [informe]);
  useEffect(() => {
    if (!abierto) return;
    cerrarRef.current?.focus();
    const alTeclado = e => { if (e.key === "Escape") setAbierto(false); };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [abierto]);
  return <section className="extendido__informe" aria-label="Panorama del día">
    <h3>Panorama del día</h3>
    {embebido ? <div className="extendido__informe-resumen">
      <p>{resumen}</p>
      {informe.trim().length > resumen.length && <button type="button" onClick={() => setAbierto(true)}>Leer el informe completo</button>}
    </div> : <div className="extendido__informe-completo">
      {parrafos.map((parrafo, i) => <p key={i}>{parrafo.trim()}</p>)}
    </div>}
    {abierto && <div className="extendido__popover-fondo" onMouseDown={e => { if (e.target === e.currentTarget) setAbierto(false); }}>
      <div className="extendido__popover" role="dialog" aria-modal="true" aria-label="Informe completo del día">
        <button ref={cerrarRef} type="button" className="extendido__popover-cerrar" onClick={() => setAbierto(false)} aria-label="Cerrar informe">✕</button>
        <h3>Panorama del día</h3>
        <p>{paginas[pagina]}</p>
        {paginas.length > 1 && <div className="extendido__popover-paginas">
          <button type="button" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button>
          <span>{pagina + 1} de {paginas.length}</span>
          <button type="button" disabled={pagina === paginas.length - 1} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
        </div>}
      </div>
    </div>}
  </section>;
}

export default function PronosticoExtendidoView({ extendido, publicadoEn, embebido = false }) {
  const [abierto, setAbierto] = useState(0);
  const dias = porDia(extendido);

  if (!dias.length) {
    return (
      <div className="base-map base-map--fallback">
        <div>
          <strong>Pronóstico de 3 días · Misiones</strong>
          <p>Todavía no hay un pronóstico extendido publicado.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="extendido">
      <div className="extendido__head">
        <h2>Pronóstico de 3 días</h2>
        {publicadoEn && <span className="extendido__actualizado">Actualizado {tiempoRelativo(publicadoEn)} · {fechaLarga(publicadoEn)}</span>}
      </div>

      <div className="extendido__dias" role="tablist" aria-label="Elegir día">
        {dias.map((d, i) => (
          <button key={d.etiqueta + i} type="button" role="tab" aria-selected={abierto === i} className={`extendido__dia-tab${abierto === i ? " is-active" : ""}`} onClick={() => setAbierto(i)}>
            <strong>{d.etiqueta}</strong>
            {d.fecha && <small>{d.fecha}</small>}
          </button>
        ))}
      </div>

      {dias[abierto] && (
        <div className="extendido__panel">
          <div className="extendido__zonas">
            {dias[abierto].zonas.map((z) => (
              <div className="extendido__zona" key={z.zona}>
                <span className="extendido__icono"><WeatherIcon condicion={z.condicion} size={64} /></span>
                <strong>{z.zona}</strong>
                <span className="extendido__temp">
                  <b>{z.tmax}°</b> / {z.tmin}°
                </span>
                <small>{z.condicion?.charAt(0)}{z.condicion?.slice(1).toLowerCase()}</small>
              </div>
            ))}
          </div>
          {dias[abierto].informe && <InformeDelDia informe={dias[abierto].informe} embebido={embebido} />}
        </div>
      )}
    </div>
  );
}
