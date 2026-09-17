/**
 * Cabecera institucional del panel de operador. La flor del Lapacho +
 * logotipo "Ecología Misiones" en Oak Sans (la tipografía oficial del
 * manual), seguido del logo de la Dirección General de Alerta Temprana.
 * A la derecha, un slot para estado/acciones.
 */
import ThemeToggle from "./ThemeToggle";

export default function BrandHeader({ subtitulo, children }) {
  return (
    <header className="brand-header">
      <a className="skip-link" href="#contenido-principal">Ir al contenido</a>
      <div className="brand-header__mark">
        <img
          src="/brand/ecologia-flor.png"
          alt=""
          className="brand-header__flor"
          width={44}
          height={44}
        />
        <div className="brand-header__wordmark">
          <strong>Ecología</strong>
          <span>Misiones</span>
        </div>
      </div>

      <div className="brand-header__sep" aria-hidden />
      <div className="brand-header__mark">
        <img
          src="/brand/alerta-temprana.png"
          alt=""
          className="brand-header__at-icon"
          width={100}
          height={50}
        />
        <div className="brand-header__wordmark brand-header__wordmark--small">
          <strong>Dirección General de</strong>
          <span>Alerta Temprana</span>
        </div>
      </div>

      {subtitulo && <div className="brand-header__sep" aria-hidden />}
      {subtitulo && <p className="brand-header__subtitulo">{subtitulo}</p>}

      <div className="brand-header__slot">{children}<ThemeToggle /></div>
    </header>
  );
}
