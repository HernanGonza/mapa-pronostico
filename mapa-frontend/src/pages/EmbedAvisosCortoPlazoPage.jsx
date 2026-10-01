import { useEffect, useState } from "react";
import PolygonDrawMap from "../components/PolygonDrawMap";
import { getAvisosCortoPlazoVigentes, getMunicipiosGeojson } from "../api";
import { alCambiarDemo } from "../lib/demo";
import SelloDemo from "../components/SelloDemo";

// Un color por aviso, para distinguirlos cuando hay varios. El primero es el
// violeta del SMN/ACP de siempre; el resto contrasta con él y con el verde de
// los municipios.
const COLORES = ["#8b3fc4", "#e0701b", "#1d7fa8", "#c9346c", "#b8940f", "#2f8f5b"];
const colorDe = (i) => COLORES[i % COLORES.length];

const hora = (iso) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// Página pensada para el <iframe> del sitio del ministerio — mismo patrón
// que EmbedRiesgoPage.jsx: solo lectura, muestra los avisos publicados
// desde /panel/avisos-corto-plazo que siguen vigentes (puede haber varios, o
// ninguno: entonces lo dice). Cada aviso con su color; el texto sale en un
// cartel al pasar el mouse (o tocar) su polígono, así varios avisos no tapan
// el mapa. Se refresca cada minuto: un aviso que vence desaparece solo.
export default function EmbedAvisosCortoPlazoPage() {
  const [avisos, setAvisos] = useState(null);
  const [municipios, setMunicipios] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelado = false;
    getMunicipiosGeojson().then((g) => { if (!cancelado) setMunicipios(g); }).catch(() => {});
    async function cargar() {
      try {
        const data = await getAvisosCortoPlazoVigentes();
        if (!cancelado) { setAvisos(data); setError(""); }
      } catch (e) { if (!cancelado) setError(e.message); }
    }
    cargar();
    const timer = setInterval(cargar, 60 * 1000);
    const dejar = alCambiarDemo(cargar); // modo demostración: al prender/apagar, se ve en el momento
    return () => { cancelado = true; clearInterval(timer); dejar(); };
  }, []);

  // Si un aviso vence entre dos consultas, se saca igual en el momento.
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 15 * 1000); return () => clearInterval(t); }, []);
  // ?id=<aviso>: sólo ese aviso (la pantalla de transmisión /tv muestra cada ACP por separado).
  const soloId = new URLSearchParams(window.location.search).get("id");
  const vigentes = (avisos || []).filter((a) => Date.parse(a.vigenteHasta) > ahora && (!soloId || String(a.id) === soloId));

  // Más viejo primero: así el primero publicado conserva su color aunque se sumen otros.
  const ordenados = [...vigentes].sort((x, y) => Date.parse(x.publicadoEn) - Date.parse(y.publicadoEn));
  const poligonos = ordenados.map((a, i) => ({
    puntos: a.poligono, color: colorDe(i),
    cartel: { titulo: a.titulo, texto: a.texto, pie: `Vigente hasta el ${hora(a.vigenteHasta)}` },
  }));

  return (
    <div className="aviso-embed">
      <SelloDemo />
      {error && avisos && <div className="embed-warning" role="status">No se pudo actualizar. Se muestra lo último recibido.</div>}
      <div className="aviso-embed__mapa">
        <PolygonDrawMap poligonos={poligonos} onChange={() => {}} municipios={municipios} readOnly colorPoligono={COLORES[0]} encuadrar={!!soloId} />
        {avisos === null ? (
          <div className="aviso-embed__estado" role="status">{error ? "No se pudieron cargar los avisos." : "Cargando…"}</div>
        ) : ordenados.length === 0 ? (
          <div className="aviso-embed__estado" role="status">
            <strong>Sin avisos a muy corto plazo</strong>
            <span>No hay avisos vigentes para Misiones en este momento.</span>
          </div>
        ) : (
          <div className="aviso-embed__leyenda">
            <strong>Avisos a muy corto plazo</strong>
            <ul>
              {ordenados.map((a, i) => (
                <li key={a.id}><i style={{ background: colorDe(i) }} aria-hidden="true" />Vigente hasta el {hora(a.vigenteHasta)}</li>
              ))}
            </ul>
            <small>Pasá el mouse o tocá un área para leer el aviso.</small>
          </div>
        )}
      </div>
    </div>
  );
}
