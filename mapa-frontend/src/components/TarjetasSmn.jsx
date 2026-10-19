/**
 * Lo que mandó el SMN y todavía se puede usar, a la vista y en grande, como tarjetas chicas para elegir sobre cuál se trabaja
 * (avisos a muy corto plazo y alertas meteorológicas). `items`: [{ id, color, titulo, detalle, lineas?, etiqueta?, textoBoton }].
 */
export default function TarjetasSmn({ titulo, vacio, items, onElegir, ocupado = false }) {
  if (!items.length) return vacio ? <p className="admin-panel__hint smn-tarjetas__vacio">{vacio}</p> : null;
  return <section className="smn-tarjetas" aria-label={titulo(items.length)}>
    <h2 className="smn-tarjetas__titulo"><span className="smn-tarjetas__punto" aria-hidden="true" />{titulo(items.length)}</h2>
    <ul>
      {items.map((it) => <li key={it.id} className="smn-tarjeta" style={{ "--nivel": it.color || "#8b3fc4" }}>
        <div className="smn-tarjeta__cuerpo">
          <strong>{it.titulo}</strong>
          <span>{it.detalle}</span>
          {it.lineas?.length > 0 && <ul className="smn-tarjeta__lineas">{it.lineas.map((l) => <li key={l.texto}><i style={{ background: l.color }} />{l.texto}</li>)}</ul>}
          {it.aviso && <small className="smn-tarjeta__aviso" role="note">⚠ {it.aviso}</small>}
          {it.etiqueta && <small className="smn-tarjeta__etiqueta">{it.etiqueta}</small>}
        </div>
        <button type="button" className="btn btn--primary" disabled={ocupado} onClick={() => onElegir(it.id)}>{it.textoBoton || "Usar"}</button>
      </li>)}
    </ul>
  </section>;
}
