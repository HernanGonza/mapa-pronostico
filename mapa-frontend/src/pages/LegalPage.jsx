import { Link } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";

/**
 * Política de privacidad y eliminación de datos: públicas (sin login), linkeadas desde la
 * portada. Meta las exige para pasar la app de publicación en redes a modo «Activo»
 * (ver docs/redes-sociales.md). Si cambia qué datos guarda el sistema, actualizar acá.
 */
const CONTACTO = "alertatemprana@ecologia.misiones.gob.ar";
const RESPONSABLE = "Dirección General de Alerta Temprana del Ministerio de Ecología y Recursos Naturales Renovables de la Provincia de Misiones";
const ACTUALIZADO = "28 de septiembre de 2026";

const Correo = () => <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>;

function Privacidad() {
  return <>
    <h1>Política de privacidad</h1>
    <p className="legal__fecha">Última actualización: {ACTUALIZADO}</p>
    <p>El Sistema Integrado Alerta Temprana (en adelante, «el sistema») es operado por la {RESPONSABLE}, responsable del tratamiento de los datos descriptos acá, conforme a la Ley N.º 25.326 de Protección de Datos Personales.</p>

    <h2>Quién usa el sistema</h2>
    <p>Los mapas y pronósticos publicados son públicos y se pueden consultar sin registrarse. El panel de carga lo usa solo personal autorizado del Ministerio, con usuario y contraseña.</p>

    <h2>Qué datos se guardan</h2>
    <ul>
      <li><strong>Personas que consultan los mapas públicos:</strong> no se les piden datos, no se usan cookies de seguimiento ni herramientas de analítica. Como en cualquier sitio web, el servidor procesa la dirección IP para responder cada pedido.</li>
      <li><strong>Personal que usa el panel:</strong> correo electrónico, nombre, apellido, teléfono, DNI, puesto y dependencia; la contraseña se guarda cifrada de forma irreversible. Al ingresar se usa una cookie de sesión, necesaria para mantener la sesión abierta (dura hasta 30 días o hasta cerrar sesión).</li>
      <li><strong>Registro de actividad:</strong> qué persona generó o publicó cada mapa, placa o aviso y cuándo, incluidas las publicaciones hechas en redes sociales.</li>
      <li><strong>Recuperación de contraseña:</strong> se genera un código de un solo uso que vence; el teléfono registrado se usa solo para enviarlo.</li>
    </ul>

    <h2>Redes sociales (Facebook, Instagram y Telegram)</h2>
    <p>El sistema se conecta con Facebook e Instagram (Meta) y con Telegram únicamente para publicar las placas del Ministerio en las cuentas oficiales del propio Ministerio. <strong>No obtiene, lee ni guarda datos de las personas usuarias de esas redes</strong> (ni seguidores, ni comentarios, ni mensajes). Las credenciales de acceso a esas cuentas se guardan solo en el servidor.</p>

    <h2>Para qué se usan</h2>
    <p>Solo para operar el sistema: permitir el ingreso al panel, saber quién publicó cada información oficial y recuperar el acceso. No se venden, ceden ni comparten con terceros, salvo obligación legal.</p>

    <h2>Dónde se guardan</h2>
    <p>En servidores administrados por el Ministerio. Las imágenes publicadas (placas y mapas) son públicas por naturaleza.</p>

    <h2>Tus derechos</h2>
    <p>Podés pedir acceder, rectificar, actualizar o suprimir tus datos escribiendo a <Correo />. Ver también <Link to="/eliminacion-de-datos">cómo pedir la eliminación de tus datos</Link>.</p>
    <p className="legal__nota">La Agencia de Acceso a la Información Pública, en su carácter de Órgano de Control de la Ley N.º 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.</p>
  </>;
}

function EliminacionDatos() {
  return <>
    <h1>Eliminación de datos</h1>
    <p className="legal__fecha">Última actualización: {ACTUALIZADO}</p>
    <p>Podés pedir que se eliminen los datos personales que el sistema guarda sobre vos (ver la <Link to="/privacidad">política de privacidad</Link>).</p>

    <h2>Cómo pedirlo</h2>
    <ol>
      <li>Escribí a <Correo /> con el asunto «Eliminación de datos».</li>
      <li>Indicá el correo electrónico con el que estás registrado en el sistema y, si querés, tu nombre y apellido.</li>
      <li>Te vamos a responder para confirmar tu identidad antes de borrar nada.</li>
    </ol>

    <h2>Qué se elimina</h2>
    <p>Tu cuenta del panel y sus datos personales (correo, nombre, apellido, teléfono, DNI, puesto y dependencia), tus sesiones abiertas y tus códigos de recuperación de contraseña. El pedido se resuelve dentro de los 5 días hábiles, conforme a la Ley N.º 25.326.</p>
    <p>La información oficial publicada (pronósticos, alertas, mapas y placas) forma parte del registro público del Ministerio y no se elimina; se quita la vinculación con tu nombre.</p>

    <h2>Facebook e Instagram</h2>
    <p>El sistema no guarda datos de personas usuarias de Facebook ni de Instagram: solo publica en las cuentas oficiales del Ministerio. Si igual querés quitarle permisos, podés hacerlo desde la configuración de tu cuenta de Facebook, en «Integraciones comerciales» o «Apps y sitios web».</p>
  </>;
}

export default function LegalPage({ tipo }) {
  return <div className="legal">
    <BrandHeader subtitulo="Sistema Integrado Alerta Temprana"><Link to="/" className="btn-link">← Inicio</Link></BrandHeader>
    <main className="legal__contenido" id="contenido-principal" tabIndex={-1}>
      {tipo === "eliminacion" ? <EliminacionDatos /> : <Privacidad />}
    </main>
  </div>;
}
