/**
 * Cabecera institucional del panel de operador. La flor del Lapacho +
 * logotipo "Ecología Misiones" en Oak Sans (la tipografía oficial del
 * manual). A la derecha, un slot para estado/acciones.
 */
export default function BrandHeader({ subtitulo, children }) {
  return (
    <header className="brand-header">
      <div className="brand-header__mark">
        <img
          src="/brand/ecologia-flor.png"
          alt=""
          className="brand-header__flor"
          width={34}
          height={34}
        />
        <div className="brand-header__wordmark">
          <strong>Ecología</strong>
          <span>Misiones</span>
        </div>
      </div>

      {subtitulo && <div className="brand-header__sep" aria-hidden />}
      {subtitulo && <p className="brand-header__subtitulo">{subtitulo}</p>}

      <div className="brand-header__slot">{children}</div>
    </header>
  );
}
