import PlacaPreview from "../components/PlacaPreview";
import { useNotificacion } from "../lib/useNotificacion";
import PublicationStatus from "../components/PublicationStatus";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandHeader from '../components/BrandHeader';
import EmbedShare from '../components/EmbedShare';
import RiesgoMap from '../components/RiesgoMap';
import { editarMapaAlertas, publicarAlertasPorPasos } from "../lib/asistentesAlertas";
import * as api from '../api';
import { confirmar, pedirTexto, pedirCampos } from '../lib/ui';
import PublicarEnRedes from '../components/PublicarEnRedes';
import MenuAcciones from '../components/MenuAcciones';
import { cambiarVigenciaPorPasos, recomendacionesPorPasos, avisoDeAlertaPorPasos, actualizacionNivelPorPasos, placaMapaPorPasos, nivelDe, nivelDelMapa, proximoCambioDeNivel, ASISTENTE_DE, TIPO_PLACA } from '../lib/asistentePlacasAlerta';
import { vigenciasPorNivelPorPasos } from '../lib/asistenteVigencias';
import { enFemenino } from "../lib/nivelAlerta.js";

const fechaHora = (iso) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Las 17 zonas de una publicación para el mapa de la página (sin dato o gris = verde). */
const zonasDe = (catalogo, pub) => catalogo.departamentos.map(d => { const z = (pub?.zonasBase || pub?.zonas)?.find(x => String(x.id) === String(d.id)); return { id: String(d.id), categoria: z?.categoria === 'Gris' ? 'Verde' : z?.categoria || 'Verde' }; });

// Los íconos publicados (con sus dos colores); `iconos` de la publicación puede traer el color ya resuelto a esta hora.
const iconosDe = (p) => p?.iconosBase || p?.iconos || [];
const comoImagenes = (p) => ({ feed: p.feedUrl, historias: p.historiasUrl, feedNombre: p.feedNombre, historiasNombre: p.historiasNombre });

export default function AlertasMeteorologicasPage() {
  const [catalogo, setCatalogo] = useState(null), [geo, setGeo] = useState(null), [zonas, setZonas] = useState([]), [publicado, setPublicado] = useState(null);
  const [error, setError] = useState(''), [mensaje, setMensaje] = useState('');
  useNotificacion(mensaje);
  // Valores con los que arrancan los asistentes (se actualizan con lo último que se generó).
  const [periodo] = useState('Próximas 24 horas');
  // Publicaciones que se ven ahora en el mapa público (cada una se saca sola al vencer)
  // y las que esperan en fila a que termine otra.
  const [pendientes, setPendientes] = useState(null), [despublicando, setDespublicando] = useState(null);
  const vigentes = pendientes?.vigentes, enFila = pendientes?.enFila || [];
  const cargarVigentes = () => api.getAlertasMeteorologicasPendientes().then(p => { setPendientes(p); return p; }).catch(e => { setPendientes({ vigentes: [], enFila: [] }); setError(e.message); });
  // «Nueva alerta»: borrador en blanco que no corrige la publicada (por defecto va en fila).
  const [nueva, setNueva] = useState(false);
  // La tarjeta de la pila que se está viendo en el mapa de la página (null = borrador nuevo).
  const [seleccionada, setSeleccionada] = useState(null), [fijando, setFijando] = useState(false);
  useEffect(() => { cargarVigentes(); const t = setInterval(cargarVigentes, 60000); return () => clearInterval(t); }, []);
  const [iconos, setIconos] = useState([]), [imagenes, setImagenes] = useState(null), [vista, setVista] = useState('mapa');

  useEffect(() => {
    let vivo = true;
    Promise.all([api.getAlertasMeteorologicasCatalogo(), api.getAlertasMeteorologicasGeojson(), api.getAlertasMeteorologicasActual()]).then(([c, g, p]) => {
      if (!vivo) return;
      setCatalogo(c); setGeo(g); setPublicado(p);
      setZonas(zonasDe(c, p));
      setIconos(iconosDe(p)); setSeleccionada(p?.id ?? null);
    }).catch(e => { if (vivo) setError(e.message); });
    return () => { vivo = false; };
  }, []);

  const antes = (id) => (publicado?.zonasBase || publicado?.zonas)?.find(p => String(p.id) === String(id))?.categoria || 'Verde';
  const zonasCambiadas = zonas.filter(z => z.categoria !== antes(z.id));
  const iconosCambiaron = JSON.stringify(iconos) !== JSON.stringify(iconosDe(publicado));
  const cambios = zonasCambiadas.length > 0 || iconosCambiaron;
  const republicar = !!publicado && !cambios;
  const detalle = zonasCambiadas.map(z => ({ nombre: catalogo?.departamentos.find(d => String(d.id) === String(z.id))?.nombre || String(z.id), antes: antes(z.id), despues: z.categoria }));

  // «Nueva alerta»: borrador en blanco (aparece arriba de la pila) y directo a armar el mapa.
  async function nuevaAlerta() {
    if (cambios && !(await confirmar({ titulo: '¿Empezar una alerta nueva?', texto: 'Se descartan los cambios del borrador que no publicaste.', confirmar: 'Empezar de cero' }))) return;
    const blanco = catalogo.departamentos.map(d => ({ id: String(d.id), categoria: 'Verde' }));
    setZonas(blanco); setIconos([]);
    setPublicado(null); setNueva(true); setImagenes(null); setVista('mapa'); setSeleccionada(null);
    editarMapaAlertas({ catalogo, zonas: blanco, iconos: [], aplicar: (z, i) => { setZonas(z); setIconos(i); } });
  }
  // «Editar mapa» de una tarjeta: arma un borrador con el mapa de esa alerta (al publicarlo, la reemplaza).
  async function editarMapaDe(v) {
    if (v.id !== seleccionada && !(await verEnMapa(v))) return;
    const base = v.id === seleccionada ? { zonas, iconos } : { zonas: zonasDe(catalogo, v), iconos: iconosDe(v) };
    // Una alerta ya emitida se corrige en el lugar: lo que cambiás queda guardado en ella (y en el mapa público) sin republicar.
    editarMapaAlertas({ catalogo, ...base, aplicar: (z, i) => { setZonas(z); setIconos(i); }, guardar: async (z, i) => {
      await api.cambiarMapaAlerta(v.id, z, i);
      const p = await cargarVigentes();
      const nueva = p && [...p.vigentes, ...p.enFila].find(x => x.id === v.id);
      if (nueva) { setPublicado(nueva); setZonas(zonasDe(catalogo, nueva)); setIconos(iconosDe(nueva)); setSeleccionada(nueva.id); setNueva(false); setImagenes(null); }
    } });
  }
  // «Placa para redes» (derecha): la recién generada o, si no, la última de la alerta elegida.
  const ultimaMapa = [...(vigentes || []), ...enFila].find(v => v.id === seleccionada)?.placas?.find(p => p.tipo === 'mapa');
  const imagenesPlaca = imagenes || (ultimaMapa ? comoImagenes(ultimaMapa) : null);
  // Todo verde no es una alerta: no se publica (para sacar una publicada está «Despublicar»).
  const todoVerde = zonas.length > 0 && zonas.every(z => !z.categoria || z.categoria === 'Verde');
  const editarBorrador = () => editarMapaAlertas({ catalogo, zonas, iconos, aplicar: (z, i) => { setZonas(z); setIconos(i); } });
  // Descartar el borrador: vuelve a la alerta que se estaba corrigiendo (o a la primera de la pila).
  function descartar() {
    const volver = nueva ? (vigentes || [])[0] || enFila[0] || null : publicado;
    setNueva(false); setImagenes(null); setVista('mapa');
    setZonas(volver ? zonasDe(catalogo, volver) : catalogo.departamentos.map(d => ({ id: String(d.id), categoria: 'Verde' })));
    setIconos(iconosDe(volver)); setPublicado(volver); setSeleccionada(volver?.id ?? null);
  }
  // «Crear placa para redes» de una alerta: la placa del mapa, guardada en su tarjeta (y a la derecha, en «Placa para redes»).
  const crearPlacaParaRedes = (v) => placaMapaPorPasos({ pub: v, catalogo, alTerminar: (placa) => { setImagenes(comoImagenes(placa)); setVista('placa'); cargarVigentes(); } });
  // Publica un mapa en la página: el del borrador (zonas/iconos de la página) o el de una alerta ya emitida (`de`).
  const abrirPublicacion = ({ zonas: z, iconos: ic, ...resto }) => publicarAlertasPorPasos({
    catalogo, zonas: z, vigentes: vigentes || [], enFila,
    publicar: async (opciones) => {
      const pub = await api.publicarAlertasMeteorologicas(z, ic, opciones);
      setPublicado(pub); setNueva(false); setSeleccionada(pub.id); setZonas(zonasDe(catalogo, pub)); setIconos(iconosDe(pub)); await cargarVigentes();
      setMensaje(pub.enFilaDe ? 'Quedó en fila: aparece sola cuando termine la anterior.' : 'Publicado. El mapa público ya muestra este mapa.');
      return pub;
    }, ...resto });
  const revisarYPublicar = () => abrirPublicacion({ zonas, iconos, cambios: detalle, sinPublicar: !publicado, iconosCambiaron, republicar, nueva, corrige: nueva ? null : publicado?.id ?? null, periodoSugerido: publicado?.periodo || periodo });
  // «Republicar» de una tarjeta: vuelve a publicar el mapa de esa alerta (reemplazándola), con otro período y vigencia.
  async function republicarDe(v) {
    if (!(await verEnMapa(v))) return;
    abrirPublicacion({ zonas: zonasDe(catalogo, v), iconos: iconosDe(v), cambios: [], sinPublicar: false, iconosCambiaron: false, republicar: true, nueva: false, corrige: v.id, periodoSugerido: v.periodo || periodo });
  }
  const periodoDe = (id) => [...(vigentes || []), ...enFila].find(x => x.id === id)?.periodo || 'la anterior';
  async function despublicar(v) {
    const esperando = enFila.includes(v), siguiente = enFila.find(x => x.enFilaDe === v.id);
    const ok = await confirmar(esperando
      ? { titulo: '¿Sacar la alerta de la fila?', texto: 'No va a aparecer en el mapa público.', confirmar: 'Sacar de la fila' }
      : { titulo: '¿Sacar la alerta del mapa público?', texto: `Deja de mostrarse ahora, sin esperar a que venza.${siguiente ? ` En su lugar aparece «${siguiente.periodo}».` : ''}`, confirmar: 'Despublicar' });
    if (!ok) return;
    setDespublicando(v.id); setError('');
    try { await api.despublicarAlertaMeteorologica(v.id); await cargarVigentes(); setMensaje(esperando ? 'Listo: la alerta salió de la fila.' : siguiente ? `Listo: ahora se muestra «${siguiente.periodo}».` : 'Listo: la alerta ya no se muestra en el mapa público.'); }
    catch (e) { setError(e.message); }
    finally { setDespublicando(null); }
  }

  // Tocar una tarjeta de la pila: el mapa de la página pasa a mostrar esa alerta (y «Editar
  // mapa» / «Republicar» trabajan sobre ella). Así se vuelve a una anterior después de «Nueva alerta».
  async function verEnMapa(v) {
    if (v.id === seleccionada) return true;
    if (cambios && !(await confirmar({ titulo: '¿Ver otra alerta?', texto: 'Se descartan los cambios del borrador que no publicaste.', confirmar: 'Ver la otra' }))) return false;
    setZonas(zonasDe(catalogo, v)); setIconos(iconosDe(v)); setPublicado(v); setNueva(false);
    setSeleccionada(v.id); setImagenes(null); setVista('mapa');
    return true;
  }
  const alTocarTarjeta = (v) => (e) => { if (e.target.closest('button, a, input, label')) return; verEnMapa(v); };
  const alTeclaTarjeta = (v) => (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); verEnMapa(v); } };
  // Qué se ve en el mapa público: la fijada a mano o, si no hay, las vigentes por fecha.
  const fijada = [...(vigentes || []), ...enFila].find(x => x.fijada);
  async function fijar(v) {
    setFijando(true); setError('');
    try {
      await api.fijarAlertaMeteorologica(v ? v.id : null); await cargarVigentes();
      setMensaje(v ? `Listo: el mapa público muestra sólo «${v.periodo}».` : 'Listo: el mapa público vuelve a mostrar las alertas según su vigencia.');
    } catch (e) { setError(e.message); }
    finally { setFijando(false); }
  }
  async function cambiarLeyenda(v) {
    const nueva = await pedirTexto({ titulo: 'Leyenda en el mapa público', texto: 'Es el texto que se lee en el mapa público. No cambia ninguna placa.', valor: v.periodo || '' });
    if (!nueva) return;
    if (nueva === (v.periodo || '')) return;
    setError('');
    try { await api.cambiarLeyendaAlerta(v.id, nueva); await cargarVigentes(); setMensaje(`Listo: el mapa público ahora dice «${nueva}».`); }
    catch (e) { setError(e.message); }
  }
  // Lo que se lee al tocar un departamento en el mapa público: un campo por cada color que tenga la alerta.
  async function cambiarLeyendasPorColor(v) {
    const niveles = ['Rojo', 'Naranja', 'Amarillo'].filter(n => (v.zonasBase || v.zonas || []).some(z => z.categoria === n));
    if (!niveles.length) { setError('Esta alerta no tiene departamentos en amarillo, naranja ni rojo.'); return; }
    const nuevas = await pedirCampos({ titulo: 'Leyendas de los departamentos', texto: 'Es lo que se lee al tocar un departamento en el mapa público, según su color. Vacío = vuelve al texto de la alerta.',
      campos: niveles.map(n => ({ clave: n, etiqueta: `Alerta ${enFemenino(n).toLowerCase()}`, valor: v.leyendas?.[n] || '' })) });
    if (!nuevas) return;
    setError('');
    try { await api.cambiarLeyendasAlerta(v.id, nuevas); await cargarVigentes(); setMensaje('Listo: el mapa público muestra las leyendas nuevas al tocar los departamentos.'); }
    catch (e) { setError(e.message); }
  }
  const botonFijar = (v) => v.fijada
    ? <button type="button" className="btn" disabled={fijando} onClick={() => fijar(null)}>Desfijar (volver a automático)</button>
    : <button type="button" className="btn" disabled={fijando} onClick={() => fijar(v)}>Fijar en el mapa público</button>;
  const propsTarjeta = (v) => ({ className: `alerta-tarjeta${v.id === seleccionada ? ' alerta-tarjeta--elegida' : ''}`, onClick: alTocarTarjeta(v), onKeyDown: alTeclaTarjeta(v), tabIndex: 0, 'aria-current': v.id === seleccionada || undefined, title: 'Tocá la tarjeta para ver esta alerta en el mapa' });
  const estadoPublico = fijada
    ? <p className="alerta-mapa-publico alerta-mapa-publico--fijada">📌 El mapa público muestra sólo «{fijada.periodo}» (fijada a mano).</p>
    : vigentes?.length > 1 ? <p className="alerta-mapa-publico">El mapa público muestra las {vigentes.length} vigentes, con páginas para pasar de una a otra.</p>
    : vigentes?.length === 1 ? <p className="alerta-mapa-publico">El mapa público muestra «{vigentes[0].periodo}» según su vigencia.</p> : null;

  // Botones y placas de cada tarjeta de la pila (vigente o en fila): placas nuevas de esa alerta.
  const colorNivel = (n) => catalogo?.categorias.find(c => c.nombre === n)?.color;
  const asistentePlaca = (fn, v) => fn({ pub: v, catalogo, alTerminar: cargarVigentes });
  // Acciones de una tarjeta, agrupadas: editar la alerta, crear placas para redes y el resto (menú «⋯»).
  const accionesPlacas = (v) => <>
    <MenuAcciones primario etiqueta="Editar" items={[
      { texto: 'Colores y fenómenos del mapa', alHacer: () => editarMapaDe(v) },
      { texto: 'Horarios por nivel', alHacer: () => vigenciasPorNivelPorPasos({ pub: v, catalogo, alTerminar: cargarVigentes }) },
      { texto: 'Leyenda del título', alHacer: () => cambiarLeyenda(v) },
      { texto: 'Leyendas por color', alHacer: () => cambiarLeyendasPorColor(v) },
    ]} />
    <MenuAcciones etiqueta="Placas para redes" items={[
      { texto: 'Placa del mapa', alHacer: () => crearPlacaParaRedes(v) },
      { texto: 'Actualización de vigencia', alHacer: () => asistentePlaca(cambiarVigenciaPorPasos, v) },
      { texto: 'Recomendaciones', alHacer: () => asistentePlaca(recomendacionesPorPasos, v) },
      { texto: 'Aviso de alerta', alHacer: () => asistentePlaca(avisoDeAlertaPorPasos, v) },
      { texto: 'Actualización de nivel', alHacer: () => asistentePlaca(actualizacionNivelPorPasos, v) },
    ]} />
    <MenuAcciones etiqueta="Más" titulo="Más acciones" items={[
      { texto: 'Republicar con otro período y vigencia', alHacer: () => republicarDe(v) },
      { texto: v.fijada ? 'Desfijar (volver a automático)' : 'Fijar en el mapa público', deshabilitado: fijando, alHacer: () => fijar(v.fijada ? null : v) },
      { separador: true },
      { texto: enFila.includes(v) ? 'Sacar de la fila' : 'Despublicar', peligro: true, deshabilitado: despublicando != null, alHacer: () => despublicar(v) },
    ]} />
  </>;
  // Horarios de la alerta en una línea por nivel: «Naranja hasta 06:00 → Amarillo hasta 00:00».
  const horaTramo = (iso) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const resumenHorarios = (v) => ['Rojo', 'Naranja', 'Amarillo'].map(n => {
    const dep = (v.zonasBase || v.zonas || []).find(z => z.categoria === n);
    if (!dep) return null;
    const t = v.tramos?.[String(dep.id)];
    return { nivel: n, texto: t?.length ? t.map(x => `${x.categoria} hasta ${horaTramo(x.hasta)}`).join(' → ') : `${n} hasta ${horaTramo(v.vigenteHasta)}` };
  }).filter(Boolean);
  // Tarjeta de una alerta de la pila (vigente o en fila).
  const tarjeta = (v, esperando) => <li key={v.id} {...propsTarjeta(v)}>
    <div className="alerta-tarjeta__cab">
      {etiquetaNivel(v)}<strong>{v.periodo}{v.fijada && ' 📌'}</strong><small className="alerta-numero">#{v.id}</small>
      <span className="alerta-tarjeta__estado">{esperando ? 'En fila' : 'Se ve ahora'}</span>
      {v.id === seleccionada && <span className="alerta-tarjeta__viendo">En el mapa de acá</span>}
    </div>
    <div className="alerta-tarjeta__resumen">{resumenHorarios(v).map(r => <span key={r.nivel}><i style={{ background: colorNivel(r.nivel) }} />{r.texto}</span>)}</div>
    <small>{esperando ? <>Aparece cuando termine «{periodoDe(v.enFilaDe)}»</> : <>Publicada el {fechaHora(v.publicadoEn)}</>}{actualizadaEn(v) && <> · actualizada el {fechaHora(actualizadaEn(v))}</>} · se saca sola el {fechaHora(v.vigenteHasta)}</small>
    <div className="avisos-lista__acciones">{accionesPlacas(v)}</div>
    {placasDe(v)}
  </li>;
  const REDES = { facebook: 'Facebook', instagram: 'Instagram', telegram: 'Telegram' };
  const dondeSalio = (redes) => [...new Set(redes.map(r => REDES[r.destino] || r.destino))].join(', ');
  const [eliminando, setEliminando] = useState(null);
  async function eliminarPlaca(pl) {
    const enRedes = pl.redes?.length > 0;
    const ok = await confirmar({ titulo: `¿Eliminar la placa «${TIPO_PLACA[pl.tipo]}»?`, confirmar: 'Eliminar',
      texto: enRedes ? `Ya se publicó en redes (${dondeSalio(pl.redes)}): se saca sólo de acá, no de las redes.` : 'Se saca de la tarjeta de la alerta.' });
    if (!ok) return;
    setEliminando(pl.id); setError('');
    try { await api.eliminarPlacaAlerta(pl.id); await cargarVigentes(); setMensaje('Listo: la placa se sacó de la tarjeta.'); }
    catch (e) { setError(e.message); }
    finally { setEliminando(null); }
  }
  const placasDe = (v) => v.placas?.length > 0 && <ul className="alerta-placas">{v.placas.map(pl => {
    const actual = (pl.redes || []).filter(r => r.version === 'actual'), anterior = (pl.redes || []).filter(r => r.version === 'anterior');
    return <li key={pl.id} style={{ '--nivel': colorNivel(pl.nivel) }}>
      <a href={pl.feedUrl} target="_blank" rel="noreferrer"><img src={pl.feedUrl} alt={`Placa ${TIPO_PLACA[pl.tipo]}`} loading="lazy" /></a>
      <div>
        <strong>{TIPO_PLACA[pl.tipo]} · {pl.nivel}</strong>
        <small>{fechaHora(pl.editadoEn || pl.generadoEn)}{pl.editadoEn && ' (editada)'}{pl.generadoPorEmail && <> · {pl.generadoPorEmail}</>} · <a href={`${pl.feedUrl}?download=${encodeURIComponent(pl.feedNombre)}`}>feed</a> · <a href={`${pl.historiasUrl}?download=${encodeURIComponent(pl.historiasNombre)}`}>historias</a></small>
        {/* Siempre a la vista si salió en redes (lo dice el servidor al cargar la tarjeta). */}
        {actual.length > 0 && <span className="alerta-placas__redes">✓ Publicada en redes · {dondeSalio(actual)}</span>}
        {anterior.length > 0 && <span className="alerta-placas__redes alerta-placas__redes--anterior">La versión anterior se publicó en: {dondeSalio(anterior)}</span>}
        <div className="alerta-placas__acciones">
          <PublicarEnRedes unaVez alTerminar={cargarVigentes} className="btn btn--ghost" feedUrl={pl.feedUrl} historiasUrl={pl.historiasUrl} epigrafe={`${TIPO_PLACA[pl.tipo]} · Alerta ${enFemenino(pl.nivel).toLowerCase()}\n\nMinisterio de Ecología y RNR de Misiones`} />
          <button type="button" className="btn btn--ghost" onClick={() => ASISTENTE_DE[pl.tipo]({ pub: v, catalogo, placa: pl, alTerminar: cargarVigentes })}>Editar</button>
          <button type="button" className="btn btn--ghost" disabled={eliminando != null} onClick={() => eliminarPlaca(pl)}>{eliminando === pl.id ? 'Eliminando…' : 'Eliminar'}</button>
        </div>
      </div>
    </li>;
  })}</ul>;
  // Última actualización: un cambio de vigencia o la última «Actualización de vigencia / de nivel» (generada o editada).
  const actualizadaEn = (v) => [v.actualizadaEn, ...(v.placas || []).filter(p => p.tipo === 'vigencia' || p.tipo === 'nivel').map(p => p.editadoEn || p.generadoEn)]
    .filter(Boolean).sort().at(-1) || null;
  // El nivel de ahora: si una «Actualización de nivel» está en su horario, el de ésa (y avisa el próximo cambio).
  const horaCorta = (d) => d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const etiquetaNivel = (v) => {
    const n = nivelDe(v), prox = proximoCambioDeNivel(v);
    // Con varios niveles en el mapa (ej. naranja y amarillo) el badge lleva todos los colores, de mayor a menor.
    const niveles = ['Rojo', 'Naranja', 'Amarillo'].filter(x => (v.zonasBase || v.zonas || []).some(z => z.categoria === x));
    const varios = niveles.length > 1 && n === nivelDelMapa(v);
    const fondo = varios ? `linear-gradient(90deg, ${niveles.map((x, i) => `${colorNivel(x)} ${(i / niveles.length) * 100}% ${((i + 1) / niveles.length) * 100}%`).join(', ')})` : undefined;
    return <><span className="alerta-nivel" style={{ '--nivel': colorNivel(n), ...(fondo ? { background: fondo } : {}) }}>{varios ? niveles.join(' / ') : n}</span>
      {prox && <span className="alerta-nivel alerta-nivel--proximo" style={{ '--nivel': colorNivel(prox.nivel) }} title="Según la «Actualización de nivel»">→ {prox.nivel} desde {horaCorta(prox.inicio)}</span>}</>;
  };

  return <div className="admin-layout risk-layout meteo-layout">
    <BrandHeader subtitulo="Alertas meteorológicas"><Link to="/panel/mapas" className="btn-link">← Panel</Link></BrandHeader>
    <section className="admin-panel" id="contenido-principal" tabIndex={-1}>
      <div className="editor-heading"><h1>Alertas meteorológicas</h1><p>Cada tarjeta es una alerta publicada: se edita, se le sacan placas para redes y se despublica desde ahí.</p></div>
      {error && <div className="risk-message risk-message--error" role="alert">{error}</div>}
      {!catalogo ? <p>Cargando departamentos…</p> : <>
        <PublicationStatus changed={cambios} published={publicado} />
        <div className="admin-acciones">
          <button className="btn btn--primary btn--block" onClick={nuevaAlerta}>Nueva alerta</button>
        </div>
        {(nueva || cambios) && <div className="avisos-lista avisos-lista--pendiente">
          <h2>{nueva ? 'Alerta nueva · sin publicar' : `Corrección de «${publicado?.periodo || 'la alerta'}» · sin publicar`}</h2>
          <p className="avisos-lista__texto">{nueva && !cambios ? 'Armá el mapa con «Editar mapa».' : 'El mapa de la derecha muestra este borrador.'}{!nueva && ' Al publicarlo reemplaza a la alerta que estás corrigiendo.'}</p>
          <div className="avisos-lista__acciones">
            <button type="button" className="btn btn--primary" disabled={todoVerde || (nueva && !cambios)} onClick={revisarYPublicar}>Publicar en la página</button>
            <button type="button" className="btn" onClick={editarBorrador}>Editar mapa</button>
            <button type="button" className="btn btn--ghost" onClick={descartar}>Descartar</button>
          </div>
          {todoVerde && <p className="alerta-borrador__aviso">Está todo en verde, así que no es una alerta: para publicarla en la página, poné al menos un departamento en amarillo, naranja o rojo con «Editar mapa».{!nueva && ' Para sacar la alerta del mapa público, usá «Despublicar» en su tarjeta.'}</p>}
        </div>}
        {vigentes?.length > 0 && <div className="avisos-lista">
          <h2>Vigentes en el mapa público</h2>
          {estadoPublico}
          <ul>{vigentes.map(v => tarjeta(v, false))}</ul>
        </div>}
        {enFila.length > 0 && <div className="avisos-lista">
          <h2>En fila</h2>
          <ul>{enFila.map(v => tarjeta(v, true))}</ul>
        </div>}
        {vigentes?.length === 0 && <p className="admin-panel__hint">No hay alertas por departamento vigentes en el mapa público.</p>}
        <details><summary>Qué significa cada nivel</summary>{catalogo.categorias.map(c => <p key={c.nombre}><strong>{c.nombre} · {c.accion}</strong><br />{c.descripcion}</p>)}</details>
        <EmbedShare path="/embed/alertas-meteorologicas" title="Alertas meteorológicas · Misiones" />
      </>}
    </section>
    <PlacaPreview vista={vista} onVista={setVista} titulo="alertas meteorológicas" imagenes={imagenesPlaca}>
      {catalogo && geo ? <RiesgoMap geo={geo} zonas={zonas} iconos={iconos} catalogo={catalogo} publicadoEn={cambios ? null : publicado?.publicadoEn} /> : <div className="admin-map-area__vacio">Preparando mapa…</div>}
    </PlacaPreview>
  </div>;
}
