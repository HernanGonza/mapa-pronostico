/**
 * Lo que mandó el SMN y todavía se puede usar, a la vista y en grande, como tarjetas chicas para elegir sobre cuál se trabaja
 * (avisos a muy corto plazo y alertas meteorológicas). `items`: [{ id, color, titulo, detalle, lineas?, etiqueta?, textoBoton, insignia? }].
 * `accion2`: { texto, alHacer, publicado }: segundo botón (ej.: «Publicar en mapa público»), aparte del principal.
 * `insignia`: cartel grande (ej.: «Ya publicada · #4»): la tarjeta queda como constancia y el botón lleva a lo publicado en vez de armar otra.
 */
export default function TarjetasSmn({ titulo, vacio, items, onElegir, ocupado = false }) {
  const activos = items.filter((i) => !i.apagada).length, cabecera = activos ? titulo(activos) : "Alertas del SMN ya reemplazadas";
  if (!items.length) return vacio ? <p className="admin-panel__hint smn-tarjetas__vacio">{vacio}</p> : null;
  return <section className="smn-tarjetas" aria-label={cabecera}>
    <h2 className="smn-tarjetas__titulo"><span className="smn-tarjetas__punto" aria-hidden="true" />{cabecera}</h2>
    <ul>
      {items.map((it) => <li key={it.id} className={`smn-tarjeta${it.apagada ? " smn-tarjeta--reemplazada" : it.insignia ? " smn-tarjeta--publicada" : ""}`} style={{ "--nivel": it.color || "#8b3fc4" }}>
        <div className="smn-tarjeta__cuerpo">
          {it.insignia && <span className="smn-tarjeta__insignia">{it.apagada ? "↻" : "✔"} {it.insignia}</span>}
          <strong>{it.titulo}</strong>
          <span>{it.detalle}</span>
          {it.lineas?.length > 0 && <ul className="smn-tarjeta__lineas">{it.lineas.map((l) => <li key={l.texto}><i style={{ background: l.color }} />{l.texto}</li>)}</ul>}
          {it.aviso && <small className="smn-tarjeta__aviso" role="note">⚠ {it.aviso}</small>}
          {it.etiqueta && <small className="smn-tarjeta__etiqueta">{it.etiqueta}</small>}
        </div>
        {!it.apagada && <div className="smn-tarjeta__botones">
          <button type="button" className={`btn ${it.insignia || it.accion2 ? "" : "btn--primary"}`} disabled={ocupado} onClick={() => onElegir(it.id)}>{it.textoBoton || "Usar"}</button>
          {it.accion2 && <button type="button" className={`btn ${it.accion2.publicado ? "" : "btn--primary"}`} disabled={ocupado} onClick={it.accion2.alHacer}>{it.accion2.texto}</button>}
        </div>}
      </li>)}
    </ul>
  </section>;
}
