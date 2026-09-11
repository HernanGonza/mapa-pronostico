import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandHeader from '../components/BrandHeader';
import EmbedShare from '../components/EmbedShare';
import RiesgoMap from '../components/RiesgoMap';
import * as api from '../api';

export default function AlertasMeteorologicasPage() {
  const [catalogo,setCatalogo]=useState(null),[geo,setGeo]=useState(null),[zonas,setZonas]=useState([]),[publicado,setPublicado]=useState(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[periodo,setPeriodo]=useState('Próximas 24 horas'),[fondo,setFondo]=useState('tormenta');
  const [iconos,setIconos]=useState([]),[imagenes,setImagenes]=useState(null),[vista,setVista]=useState('manual');
  const [confirmando,setConfirmando]=useState(false),[mensaje,setMensaje]=useState('');
  const [recomendaciones,setRecomendaciones]=useState(''),[imagenesRecomendaciones,setImagenesRecomendaciones]=useState(null);
  const [titulo,setTitulo]=useState('Alerta meteorológica');
  const [imagenRecomendaciones,setImagenRecomendaciones]=useState(null);
  const textoRef=useRef(null);
  const imagenRef=useRef(null);
  useEffect(()=>{
    let alive=true;
    Promise.all([api.getAlertasMeteorologicasCatalogo(),api.getAlertasMeteorologicasGeojson(),api.getAlertasMeteorologicasActual()]).then(([c,g,p])=>{
      if(!alive)return;setCatalogo(c);setGeo(g);setPublicado(p);
      setZonas(c.departamentos.map(d=>{const z=p?.zonas?.find(x=>String(x.id)===String(d.id));return {id:String(d.id),categoria:z?.categoria==='Gris'?'Verde':z?.categoria||'Verde'};}));
      setIconos(p?.iconos||[]);
    }).catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;};
  },[]);
  function change(id,patch){setZonas(z=>z.map(x=>x.id===id?{...x,...patch}:x));setImagenes(null);setConfirmando(false);setMensaje('');}
  function agregarIcono(id){if(!id)return;setIconos(l=>[...l,{id,categoria:'Rojo'}]);setImagenes(null);setConfirmando(false);setMensaje('');}
  function cambiarIcono(id,patch){setIconos(l=>l.map(i=>i.id===id?{...i,...patch}:i));setImagenes(null);setConfirmando(false);setMensaje('');}
  function quitarIcono(id){setIconos(l=>l.filter(i=>i.id!==id));setImagenes(null);setConfirmando(false);setMensaje('');}
  async function guardar(){setBusy(true);setError('');try{setPublicado(await api.publicarAlertasMeteorologicas(zonas,iconos));setConfirmando(false);setMensaje('Publicado. El mapa público ya muestra este mapa.');}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function generar(){setBusy(true);setError('');try{
    const placa=await api.generarPlaca({zonas,periodo,fondo,iconos,titulo});
    setImagenes({feed:placa.feedUrl,historias:placa.historiasUrl,feedNombre:placa.feedNombre,historiasNombre:placa.historiasNombre});setVista('placa');
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  async function generarTexto(){setBusy(true);setError('');try{
    const placa=await api.generarRecomendaciones({texto:recomendaciones,fondo,titulo,imagen:imagenRecomendaciones});
    setImagenesRecomendaciones({feed:placa.feedUrl,historias:placa.historiasUrl,feedNombre:placa.feedNombre,historiasNombre:placa.historiasNombre});setVista('recomendaciones');
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  async function cargarImagen(event) {
    const archivo=event.target.files?.[0];
    if(!archivo)return;
    setError('');
    if(!['image/png','image/jpeg','image/webp'].includes(archivo.type)||archivo.size>5*1024*1024){
      setError('Elegí una imagen PNG, JPG o WebP de hasta 5 MB.');event.target.value='';return;
    }
    setBusy(true);
    try {
      const data=await new Promise((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('No se pudo leer la imagen.'));reader.readAsDataURL(archivo);
      });
      const img=new Image();img.src=data;await img.decode();
      if(img.naturalWidth*img.naturalHeight>25000000)throw new Error('La imagen supera los 25 megapíxeles. Elegí una más pequeña.');
      setImagenRecomendaciones(data);setImagenesRecomendaciones(null);
    }catch(e){setError(e.message||'No se pudo leer la imagen.');if(imagenRef.current)imagenRef.current.value='';}
    finally{setBusy(false);}
  }
  function insertarIcono(icono){
    const campo=textoRef.current, inicio=campo?.selectionStart??recomendaciones.length, fin=campo?.selectionEnd??inicio;
    const nuevo=recomendaciones.slice(0,inicio)+icono+recomendaciones.slice(fin);
    if(nuevo.length>2400)return;
    setRecomendaciones(nuevo);setImagenesRecomendaciones(null);
    requestAnimationFrame(()=>{campo?.focus();campo?.setSelectionRange(inicio+icono.length,inicio+icono.length);});
  }
  const imagenesVista=vista==='recomendaciones'?imagenesRecomendaciones:imagenes;
  const zonasCambiadas=zonas.filter(z=>z.categoria!==(publicado?.zonas?.find(p=>String(p.id)===String(z.id))?.categoria||'Verde'));
  const iconosCambiaron=JSON.stringify(iconos)!==JSON.stringify(publicado?.iconos||[]);
  const cambios=zonasCambiadas.length>0||iconosCambiaron;
  return <div className="admin-layout risk-layout meteo-layout">
    <BrandHeader subtitulo="Alertas meteorológicas"><Link to="/panel" className="btn-link">← Panel</Link></BrandHeader>
    <section className="admin-panel">
      <div className="editor-heading"><span className="editor-eyebrow">MAPA Y PLACA PARA REDES</span><h1>Alertas meteorológicas</h1><p>Asigná el color y uno o varios fenómenos a cada departamento.</p></div>
      {error&&<div className="risk-message risk-message--error" role="alert">{error}</div>}
      {mensaje&&<p className="risk-message" role="status">{mensaje}</p>}
      {!catalogo?<p>Cargando departamentos…</p>:<>
        <div className="risk-progress"><span>{cambios?'Cambios sin publicar':publicado?'Publicado':'Sin publicar'}</span></div>
        <div className="risk-zones">{catalogo.departamentos.map(d=>{const z=zonas.find(x=>x.id===String(d.id));return <div className="risk-zone" key={d.id} style={{display:'block'}}>
          <strong>{d.nombre}</strong>
          <select aria-label={`Nivel de alerta de ${d.nombre}`} value={z.categoria} disabled={busy} onChange={e=>change(z.id,{categoria:e.target.value})} style={{marginTop:8}}>{catalogo.categorias.map(c=><option key={c.nombre} value={c.nombre}>{c.nombre} · {c.accion}</option>)}</select>
        </div>;})}</div>
        <details><summary>Qué significa cada nivel</summary>{catalogo.categorias.map(c=><p key={c.nombre}><strong>{c.nombre} · {c.accion}</strong><br/>{c.descripcion}</p>)}</details>
        <div className="field">
          <span>Fenómenos de la placa</span>
          <select aria-label="Agregar fenómeno" value="" disabled={busy||iconos.length===catalogo.iconos.length} onChange={e=>agregarIcono(e.target.value)}><option value="">+ Icono</option>{catalogo.iconos.filter(i=>!iconos.some(x=>x.id===i.id)).map(i=><option key={i.id} value={i.id}>{i.nombre}</option>)}</select>
          {iconos.map(elegido=>{const info=catalogo.iconos.find(i=>i.id===elegido.id);return <div key={elegido.id} style={{display:'flex',gap:8,alignItems:'center',marginTop:8}}>
            <span style={{flex:1}}>{info?.nombre}</span>
            <select aria-label={`Color de ${info?.nombre}`} value={elegido.categoria} disabled={busy} onChange={e=>cambiarIcono(elegido.id,{categoria:e.target.value})}>{catalogo.categorias.map(c=><option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}</select>
            <button type="button" disabled={busy} onClick={()=>quitarIcono(elegido.id)} title="Quitar icono">×</button>
          </div>;})}
        </div>
        <label className="field"><span>Título de las placas</span><input value={titulo} maxLength={60} disabled={busy} placeholder="Ej.: Aviso" onChange={e=>{setTitulo(e.target.value);setImagenes(null);setImagenesRecomendaciones(null);}}/><small>Se aplica a la placa del mapa y a las recomendaciones.</small></label>
        <label className="field"><span>Período de la placa</span><textarea value={periodo} rows={3} maxLength={140} disabled={busy} onChange={e=>{setPeriodo(e.target.value);setImagenes(null);}}/></label>
        <label className="field"><span>Fondo</span><select value={fondo} disabled={busy} onChange={e=>{setFondo(e.target.value);setImagenes(null);setImagenesRecomendaciones(null);}}><option value="tormenta">Tormenta</option><option value="nubes">Nubes</option></select></label>
        <button className="btn btn--primary btn--block" disabled={busy||!periodo.trim()||!titulo.trim()} onClick={generar}>{busy?'Procesando…':'Generar placa para redes'}</button>
        {imagenes&&<div className="meteo-downloads">
          {/* Las imágenes ahora viven en el bucket de Storage (otro origen) — el
              atributo `download` del <a> no fuerza la descarga en cross-origin;
              Supabase Storage sí soporta el query param `?download=` para eso. */}
          <a className="btn btn--block" href={`${imagenes.feed}?download=${encodeURIComponent(imagenes.feedNombre)}`}>Descargar feed</a>
          <a className="btn btn--block" href={`${imagenes.historias}?download=${encodeURIComponent(imagenes.historiasNombre)}`}>Descargar historias</a>
        </div>}
        <section className="meteo-recomendaciones" aria-labelledby="recomendaciones-titulo">
          <h2 id="recomendaciones-titulo">Recomendaciones <small>Opcional</small></h2>
          <p>Texto e imagen opcional sobre el fondo elegido: {fondo==='tormenta'?'Tormenta':'Nubes'}. Podés pegar emojis y usar Enter para separar párrafos.</p>
          <label className="field"><span>Texto de recomendaciones</span><textarea ref={textoRef} value={recomendaciones} rows={12} maxLength={2400} disabled={busy} placeholder="Escribí aquí las recomendaciones para la población…" onChange={e=>{setRecomendaciones(e.target.value);setImagenesRecomendaciones(null);}}/></label>
          <label className="field"><span>Imagen para las recomendaciones (opcional)</span><input ref={imagenRef} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={cargarImagen}/><small>PNG, JPG o WebP, hasta 5 MB y 25 megapíxeles. Se coloca arriba del texto sin recortarla.</small></label>
          {imagenRecomendaciones&&<div className="meteo-imagen-preview"><img src={imagenRecomendaciones} alt="Imagen elegida para las recomendaciones"/><button className="btn" type="button" disabled={busy} onClick={()=>{setImagenRecomendaciones(null);setImagenesRecomendaciones(null);if(imagenRef.current)imagenRef.current.value='';}}>Quitar imagen</button></div>}
          <div className="meteo-emojis" role="group" aria-label="Insertar icono en el texto">
            {[['⚠️','Advertencia'],['⛈️','Tormenta'],['🌧️','Lluvia'],['💨','Viento'],['🏠','Casa'],['🚫','Prohibido'],['✅','Recomendación'],['📞','Teléfono'],['🔌','Electricidad']].map(([icono,nombre])=><button key={nombre} type="button" className="btn" aria-label={`Insertar ${nombre}`} title={nombre} disabled={busy} onClick={()=>insertarIcono(icono)}>{icono}</button>)}
          </div>
          <p className="meteo-count">{recomendaciones.length}/2400 caracteres</p>
          <button type="button" className="btn btn--primary btn--block" disabled={busy||!recomendaciones.trim()||!titulo.trim()} onClick={generarTexto}>{busy?'Procesando…':'Generar placa de recomendaciones'}</button>
          {imagenesRecomendaciones&&<div className="meteo-downloads">
            <a className="btn" href={`${imagenesRecomendaciones.feed}?download=${encodeURIComponent(imagenesRecomendaciones.feedNombre)}`}>Descargar recomendaciones feed</a>
            <a className="btn" href={`${imagenesRecomendaciones.historias}?download=${encodeURIComponent(imagenesRecomendaciones.historiasNombre)}`}>Descargar recomendaciones historias</a>
          </div>}
        </section>
        {confirmando&&<div className="risk-review"><h2>Revisar publicación</h2>
          {zonasCambiadas.length>0&&<><p>Se actualizarán {zonasCambiadas.length} departamentos en el mapa público.</p>
            <ul>{zonasCambiadas.map(z=><li key={z.id}><b>{catalogo.departamentos.find(d=>String(d.id)===String(z.id))?.nombre}</b>: {publicado?.zonas?.find(p=>String(p.id)===String(z.id))?.categoria||'Verde'} → {z.categoria}</li>)}</ul></>}
          {iconosCambiaron&&<p>Cambiaron los fenómenos/iconos de la placa.</p>}
          <button className="btn btn--primary btn--block" disabled={busy} onClick={guardar}>Confirmar y publicar</button>
          <button className="btn btn--block" disabled={busy} onClick={()=>setConfirmando(false)}>Seguir editando</button>
        </div>}
        {!confirmando&&<button className="btn btn--primary btn--block" disabled={busy||!cambios} onClick={()=>setConfirmando(true)}>Revisar y publicar</button>}
        <p>El mapa público muestra lo último que publicaste acá. La placa usa los colores e iconos seleccionados.</p>
        <EmbedShare path="/embed/alertas-meteorologicas" title="Alertas meteorológicas · Misiones"/>
      </>}
    </section>
    <div className="admin-map-area" style={{display:'flex',flexDirection:'column'}}>
      <div style={{padding:10,display:'flex',flexWrap:'wrap',gap:10,background:'#fff'}}>{[['manual','Mapa manual'],['placa','Placa para redes'],['recomendaciones','Recomendaciones']].map(([id,label])=><button key={id} className="btn" onClick={()=>setVista(id)} disabled={vista===id}>{label}</button>)}</div>
      <div style={{flex:1,minHeight:0,overflow:vista==='manual'?'hidden':'auto'}}>
        {vista!=='manual'?imagenesVista?<div style={{display:'flex',gap:16,height:'100%',padding:16,boxSizing:'border-box'}}>
          <figure style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',alignItems:'center',margin:0}}><figcaption>Feed</figcaption><img src={imagenesVista.feed} alt={`Vista previa de ${vista} (feed)`} style={{flex:1,minHeight:0,maxWidth:'100%',objectFit:'contain'}}/></figure>
          <figure style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',alignItems:'center',margin:0}}><figcaption>Historias</figcaption><img src={imagenesVista.historias} alt={`Vista previa de ${vista} (historias)`} style={{flex:1,minHeight:0,maxWidth:'100%',objectFit:'contain'}}/></figure>
        </div>:<div className="admin-map-area__vacio">{vista==='recomendaciones'?'Escribí el texto y presioná «Generar placa de recomendaciones».':'Elegí colores e iconos y presioná «Generar placa para redes». '}</div>:catalogo&&geo?<RiesgoMap geo={geo} zonas={zonas} iconos={iconos} catalogo={catalogo} publicadoEn={publicado?.publicadoEn}/>:<div className="admin-map-area__vacio">Preparando mapa…</div>}
      </div>
    </div>
  </div>;
}
