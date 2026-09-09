import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandHeader from '../components/BrandHeader';
import EmbedShare from '../components/EmbedShare';
import RiesgoMap from '../components/RiesgoMap';
import SmnAlertas from '../components/SmnAlertas';
import * as api from '../api';

export default function AlertasMeteorologicasPage() {
  const [catalogo,setCatalogo]=useState(null),[geo,setGeo]=useState(null),[zonas,setZonas]=useState([]),[publicado,setPublicado]=useState(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[periodo,setPeriodo]=useState('Próximas 24 horas'),[fondo,setFondo]=useState('tormenta');
  const [imagen,setImagen]=useState(null),[vista,setVista]=useState('manual'),[smn,setSmn]=useState(null);
  useEffect(()=>{
    let alive=true;
    Promise.all([api.getAlertasMeteorologicasCatalogo(),api.getAlertasMeteorologicasGeojson(),api.getAlertasMeteorologicasActual()]).then(([c,g,p])=>{
      if(!alive)return;setCatalogo(c);setGeo(g);setPublicado(p);
      setZonas(c.departamentos.map(d=>{const z=p?.zonas?.find(x=>String(x.id)===String(d.id));return {id:String(d.id),categoria:z?.categoria==='Gris'?'Verde':z?.categoria||'Verde',iconos:z?.iconos||[]};}));
    }).catch(e=>{if(alive)setError(e.message);});
    const refresh=()=>api.getSmnAlertas().then(r=>{if(alive)setSmn(r);}).catch(()=>{});
    refresh();const timer=setInterval(refresh,60000);return()=>{alive=false;clearInterval(timer);};
  },[]);
  useEffect(()=>()=>{if(imagen)URL.revokeObjectURL(imagen);},[imagen]);
  function change(id,patch){setZonas(z=>z.map(x=>x.id===id?{...x,...patch}:x));setImagen(null);}
  async function guardar(){setBusy(true);setError('');try{setPublicado(await api.publicarAlertasMeteorologicas(zonas));}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function generar(){setBusy(true);setError('');try{const blob=await api.renderAlertaPng({zonas,periodo,fondo});setImagen(URL.createObjectURL(blob));setVista('placa');}catch(e){setError(e.message);}finally{setBusy(false);}}
  const avisos=smn?Object.values(smn.fuentes).flatMap(f=>f.alertas):[];
  const cambios=JSON.stringify(zonas)!==JSON.stringify(publicado?.zonas||[]);
  return <div className="admin-layout risk-layout">
    <BrandHeader subtitulo="Alertas meteorológicas"><Link to="/panel" className="btn-link">← Panel</Link></BrandHeader>
    <section className="admin-panel">
      <div className="editor-heading"><span className="editor-eyebrow">MAPA Y PLACA PARA REDES</span><h1>Alertas meteorológicas</h1><p>Asigná el color y uno o varios fenómenos a cada departamento.</p></div>
      {smn&&<div className="risk-message" role="status"><strong>SMN · {smn.alcance==='argentina'?'Argentina (prueba)':'Misiones'}</strong><p>{avisos.length?`${avisos.length} avisos recibidos. Revisá los períodos y prepará la placa que corresponda.`:'Sin avisos en los últimos datos recibidos.'}</p>{Object.values(smn.fuentes).some(f=>f.desactualizado)&&<p>Hay consultas pendientes o desactualizadas.</p>}<button className="btn" onClick={()=>setVista('smn')}>Ver alertas automáticas</button></div>}
      {error&&<div className="risk-message risk-message--error" role="alert">{error}</div>}
      {!catalogo?<p>Cargando departamentos…</p>:<>
        <div className="risk-zones">{catalogo.departamentos.map(d=>{const z=zonas.find(x=>x.id===String(d.id));return <div className="risk-zone" key={d.id} style={{display:'block'}}>
          <strong>{d.nombre}</strong><div style={{display:'flex',gap:8,marginTop:8}}>
            <select aria-label={`Nivel de alerta de ${d.nombre}`} value={z.categoria} disabled={busy} onChange={e=>change(z.id,{categoria:e.target.value})}>{catalogo.categorias.map(c=><option key={c.nombre} value={c.nombre}>{c.nombre} · {c.accion}</option>)}</select>
            <select aria-label={`Agregar icono a ${d.nombre}`} value="" disabled={busy||z.iconos.length===catalogo.iconos.length} onChange={e=>{if(e.target.value)change(z.id,{iconos:[...z.iconos,e.target.value]});}}><option value="">+ Icono</option>{catalogo.iconos.filter(i=>!z.iconos.includes(i.id)).map(i=><option key={i.id} value={i.id}>{i.nombre}</option>)}</select>
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>{z.iconos.map(id=><button key={id} type="button" disabled={busy} onClick={()=>change(z.id,{iconos:z.iconos.filter(i=>i!==id)})} title="Quitar icono">{catalogo.iconos.find(i=>i.id===id)?.nombre} ×</button>)}</div>
        </div>;})}</div>
        <details><summary>Qué significa cada nivel</summary>{catalogo.categorias.map(c=><p key={c.nombre}><strong>{c.nombre} · {c.accion}</strong><br/>{c.descripcion}</p>)}</details>
        <label className="field"><span>Período de la placa</span><input value={periodo} maxLength={60} disabled={busy} onChange={e=>{setPeriodo(e.target.value);setImagen(null);}}/></label>
        <label className="field"><span>Fondo</span><select value={fondo} disabled={busy} onChange={e=>{setFondo(e.target.value);setImagen(null);}}><option value="tormenta">Tormenta</option><option value="nubes">Nubes</option></select></label>
        <button className="btn btn--primary btn--block" disabled={busy||!periodo.trim()} onClick={generar}>{busy?'Procesando…':'Generar placa para redes'}</button>
        {imagen&&<a className="btn btn--block" href={imagen} download="alerta-meteorologica.png">Descargar PNG</a>}
        <button className="btn btn--block" disabled={busy||!cambios} onClick={guardar}>Guardar mapa manual</button>
        <p>El mapa público se actualiza con el SMN. La placa usa los colores e iconos seleccionados acá.</p>
        <EmbedShare path="/embed/alertas-meteorologicas" title="Alertas meteorológicas SMN"/>
      </>}
    </section>
    <div className="admin-map-area" style={{display:'flex',flexDirection:'column'}}>
      <div style={{padding:10,display:'flex',gap:10,background:'#fff'}}>{[['manual','Mapa manual'],['placa','Placa para redes'],['smn','SMN automático']].map(([id,label])=><button key={id} className="btn" onClick={()=>setVista(id)} disabled={vista===id}>{label}</button>)}</div>
      <div style={{flex:1,minHeight:0,overflow:vista==='manual'?'hidden':'auto'}}>
        {vista==='smn'?<SmnAlertas/>:vista==='placa'?imagen?<img src={imagen} alt="Vista previa de la placa meteorológica" style={{display:'block',maxWidth:'100%',maxHeight:'100%',margin:'auto',objectFit:'contain'}}/>:<div className="admin-map-area__vacio">Elegí colores e iconos y presioná «Generar placa para redes».</div>:catalogo&&geo?<RiesgoMap geo={geo} zonas={zonas} catalogo={catalogo} publicadoEn={publicado?.publicadoEn}/>:<div className="admin-map-area__vacio">Preparando mapa…</div>}
      </div>
    </div>
  </div>;
}
