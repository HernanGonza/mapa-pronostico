import PlacaPreview from "../components/PlacaPreview";
import { useNotificacion } from "../lib/useNotificacion";
import PublicationStatus from "../components/PublicationStatus";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandHeader from '../components/BrandHeader';
import EmbedShare from '../components/EmbedShare';
import RiesgoMap from '../components/RiesgoMap';
import { editarMapaAlertas, crearPlacaMapaAlertas, crearPlacaRecomendaciones, publicarAlertasPorPasos } from "../lib/asistentesAlertas";
import * as api from '../api';

const comoImagenes = (p) => ({ feed: p.feedUrl, historias: p.historiasUrl, feedNombre: p.feedNombre, historiasNombre: p.historiasNombre });

export default function AlertasMeteorologicasPage() {
  const [catalogo, setCatalogo] = useState(null), [geo, setGeo] = useState(null), [zonas, setZonas] = useState([]), [publicado, setPublicado] = useState(null);
  const [error, setError] = useState(''), [mensaje, setMensaje] = useState('');
  useNotificacion(mensaje);
  // Valores con los que arrancan los asistentes (se actualizan con lo último que se generó).
  const [periodo, setPeriodo] = useState('Próximas 24 horas'), [fondo, setFondo] = useState('tormenta'), [titulo, setTitulo] = useState('Alerta meteorológica'), [tamanoPeriodo, setTamanoPeriodo] = useState(64);
  const [recomendaciones, setRecomendaciones] = useState('');
  const [iconos, setIconos] = useState([]), [imagenes, setImagenes] = useState(null), [imagenesRecomendaciones, setImagenesRecomendaciones] = useState(null), [vista, setVista] = useState('mapa');

  useEffect(() => {
    let vivo = true;
    Promise.all([api.getAlertasMeteorologicasCatalogo(), api.getAlertasMeteorologicasGeojson(), api.getAlertasMeteorologicasActual()]).then(([c, g, p]) => {
      if (!vivo) return;
      setCatalogo(c); setGeo(g); setPublicado(p);
      setZonas(c.departamentos.map(d => { const z = p?.zonas?.find(x => String(x.id) === String(d.id)); return { id: String(d.id), categoria: z?.categoria === 'Gris' ? 'Verde' : z?.categoria || 'Verde' }; }));
      setIconos(p?.iconos || []);
      if (c.tamanoPeriodo?.predeterminado) setTamanoPeriodo(c.tamanoPeriodo.predeterminado);
    }).catch(e => { if (vivo) setError(e.message); });
    return () => { vivo = false; };
  }, []);

  const antes = (id) => publicado?.zonas?.find(p => String(p.id) === String(id))?.categoria || 'Verde';
  const zonasCambiadas = zonas.filter(z => z.categoria !== antes(z.id));
  const iconosCambiaron = JSON.stringify(iconos) !== JSON.stringify(publicado?.iconos || []);
  const cambios = zonasCambiadas.length > 0 || iconosCambiaron;
  const puedePublicar = !!catalogo && (!publicado || cambios);
  const detalle = zonasCambiadas.map(z => ({ nombre: catalogo?.departamentos.find(d => String(d.id) === String(z.id))?.nombre || String(z.id), antes: antes(z.id), despues: z.categoria }));

  const editarMapa = () => editarMapaAlertas({ catalogo, zonas, iconos, aplicar: (z, i) => { setZonas(z); setIconos(i); } });
  const crearPlacaMapa = () => crearPlacaMapaAlertas({
    catalogo, inicial: { zonas, iconos, titulo, periodo, fondo, tamanoPeriodo },
    vistaPrevia: (c) => api.generarPlaca({ ...c, vistaPrevia: true }),
    guardar: async (c, token) => {
      const placa = await api.generarPlaca({ ...c, confirmarToken: token });
      setZonas(c.zonas); setIconos(c.iconos); // el mapa de la página refleja lo que salió en la placa
      setTitulo(c.titulo); setPeriodo(c.periodo); setFondo(c.fondo); setTamanoPeriodo(c.tamanoPeriodo);
      setImagenes(comoImagenes(placa)); setVista('placa');
      return placa;
    },
  });
  const crearRecomendaciones = () => crearPlacaRecomendaciones({
    inicial: { titulo, fondo, texto: recomendaciones, imagen: null },
    vistaPrevia: (c) => api.generarRecomendaciones({ ...c, vistaPrevia: true }),
    guardar: async (c, token) => {
      const placa = await api.generarRecomendaciones({ ...c, imagen: null, confirmarToken: token });
      setTitulo(c.titulo); setFondo(c.fondo); setRecomendaciones(c.texto);
      setImagenesRecomendaciones(comoImagenes(placa)); setVista('recomendaciones');
      return placa;
    },
  });
  const revisarYPublicar = () => publicarAlertasPorPasos({
    cambios: detalle, sinPublicar: !publicado, iconosCambiaron,
    publicar: async () => { setPublicado(await api.publicarAlertasMeteorologicas(zonas, iconos)); setMensaje('Publicado. El mapa público ya muestra este mapa.'); },
  });

  return <div className="admin-layout risk-layout meteo-layout">
    <BrandHeader subtitulo="Alertas meteorológicas"><Link to="/panel/mapas" className="btn-link">← Panel</Link></BrandHeader>
    <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading"><h1>Alertas meteorológicas</h1><p>Asigná el color y los fenómenos de cada departamento con el asistente; el mapa muestra el borrador.</p></div>
      {error && <div className="risk-message risk-message--error" role="alert">{error}</div>}
      {!catalogo ? <p>Cargando departamentos…</p> : <>
        <PublicationStatus changed={cambios} published={publicado} />
        <div className="admin-acciones">
          <button className="btn btn--primary btn--block" onClick={editarMapa}>Editar mapa</button>
          <button className="btn btn--block" onClick={crearPlacaMapa}>Crear placa del mapa</button>
          <button className="btn btn--block" onClick={crearRecomendaciones}>Crear placa de recomendaciones</button>
          <button className="btn btn--block" disabled={!puedePublicar} onClick={revisarYPublicar}>Revisar y publicar</button>
        </div>
        <p className="admin-panel__hint">La placa del mapa usa los niveles y fenómenos que ves a la derecha. El mapa público muestra lo último que publicaste.</p>
        <details><summary>Qué significa cada nivel</summary>{catalogo.categorias.map(c => <p key={c.nombre}><strong>{c.nombre} · {c.accion}</strong><br />{c.descripcion}</p>)}</details>
        <EmbedShare path="/embed/alertas-meteorologicas" title="Alertas meteorológicas · Misiones" />
      </>}
    </section>
    <PlacaPreview vista={vista} onVista={setVista} titulo="alertas meteorológicas" imagenes={imagenes} recomendaciones={imagenesRecomendaciones}>
      {catalogo && geo ? <RiesgoMap geo={geo} zonas={zonas} iconos={iconos} catalogo={catalogo} publicadoEn={cambios ? null : publicado?.publicadoEn} /> : <div className="admin-map-area__vacio">Preparando mapa…</div>}
    </PlacaPreview>
  </div>;
}
