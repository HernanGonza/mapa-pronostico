import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import BrandHeader from "../components/BrandHeader";
import VistaEscalada from "../components/VistaEscalada";
import { leerDemo, guardarDemo, alCambiarDemo, conDemo, VACIO } from "../lib/demo";

/**
 * Demostración (reuniones, capacitaciones): prende y apaga avisos y alertas DE PRUEBA para
 * mostrar cómo reaccionan la pantalla de transmisión (/tv) y los mapas embebidos.
 * Sólo afecta a las páginas abiertas con ?demo=1 en este navegador (ver lib/demo.js):
 * el sitio público no se entera. No guarda nada en el servidor.
 */
const INTERRUPTORES = [
  { clave: "acp", titulo: "2 avisos a muy corto plazo", detalle: "Uno en el norte (Iguazú) y otro en el centro (Oberá). En el mapa de ACP se ven juntos, cada uno con su polígono; en la transmisión toman la pantalla de a uno." },
  { clave: "alerta", titulo: "Alerta por departamentos", detalle: "Naranja en Oberá, Cainguás y Guaraní; amarillo alrededor; con fenómenos (tormentas, granizo)." },
  { clave: "smn", titulo: "Alerta del SMN", detalle: "Tormentas, nivel amarillo, en el sur de la provincia. Junto con la anterior se ven los carteles para elegir entre alertas." },
];

const VISTAS = [
  { id: "tv", titulo: "Pantalla de transmisión", ruta: "/tv", ancho: 1920, alto: 1080 },
  { id: "acp", titulo: "Mapa de ACP", ruta: "/embed/avisos-corto-plazo" },
  { id: "alertas", titulo: "Mapa de alertas", ruta: "/embed/alertas-meteorologicas" },
];

export default function DemostracionPage() {
  const { usuario } = useAuth();
  const [config, setConfig] = useState(leerDemo);
  const [vista, setVista] = useState("tv");
  useEffect(() => alCambiarDemo(setConfig), []);

  const cambiar = (clave) => { const nuevo = { ...config, [clave]: !config[clave] }; setConfig(nuevo); guardarDemo(nuevo); };
  const apagarTodo = () => { setConfig({ ...VACIO }); guardarDemo({ ...VACIO }); };
  const hayAlgo = Object.values(config).some(Boolean);
  const actual = VISTAS.find((v) => v.id === vista);
  // Como Usuarios: sólo superadmin (está dentro de Configuración).
  if (usuario && usuario.rol !== "superadmin") return <Navigate to="/panel" replace />;

  return <div className="admin-layout">
    <BrandHeader subtitulo="Demostración"><Link to="/panel/configuracion" className="btn-link">← Configuración</Link></BrandHeader>
    <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading">
        <h1>Demostración</h1>
        <p>Prendé avisos y alertas de prueba para mostrar cómo reaccionan la pantalla de transmisión y los mapas. Sólo se ven en las páginas abiertas desde acá (llevan <code>?demo=1</code> y un sello «DEMOSTRACIÓN»); el sitio público no cambia.</p>
      </div>
      <div className="demo-interruptores">
        {INTERRUPTORES.map((i) => <label key={i.clave} className={`demo-interruptor${config[i.clave] ? " demo-interruptor--on" : ""}`}>
          <input type="checkbox" role="switch" checked={config[i.clave]} onChange={() => cambiar(i.clave)} />
          <span className="demo-interruptor__llave" aria-hidden="true" />
          <span><strong>{i.titulo}</strong><small>{i.detalle}</small></span>
        </label>)}
      </div>
      <button type="button" className="btn btn--block" disabled={!hayAlgo} onClick={apagarTodo}>Apagar todo</button>
      <h2>Abrir en una ventana aparte</h2>
      <p className="admin-panel__hint">Para mostrarlo en otra pantalla o en OBS. Los interruptores cambian también esas ventanas, al instante (en este mismo navegador).</p>
      <div className="admin-acciones">
        {VISTAS.map((v) => <a key={v.id} className="btn btn--block" href={conDemo(v.ruta)} target="_blank" rel="noreferrer">{v.titulo} ↗</a>)}
      </div>
    </section>
    <div className="admin-map-area placa-workspace">
      <div className="placa-toolbar" role="group" aria-label="Vista">
        {VISTAS.map((v) => <button key={v.id} type="button" className="btn" aria-pressed={vista === v.id} onClick={() => setVista(v.id)}>{v.titulo}</button>)}
      </div>
      <div className="placa-content demo-vista">
        {actual.ancho
          ? <VistaEscalada key={actual.id} src={conDemo(actual.ruta)} ancho={actual.ancho} alto={actual.alto} titulo={actual.titulo} />
          : <iframe key={actual.id} className="demo-vista__iframe" src={conDemo(actual.ruta)} title={actual.titulo} />}
      </div>
    </div>
  </div>;
}
