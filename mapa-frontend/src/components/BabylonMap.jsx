import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { SceneManager } from "../babylon/SceneManager";
import { normalizeWeather } from "../weather/WeatherState";
import { horaActualFrac, horaActual } from "../lib/campoClima";
import { tiempoRelativo } from "../lib/tiempoRelativo";
import WeatherIcon from "./WeatherIcon";
import WeatherDebugPanel from "./WeatherDebugPanel";
import LayerPanel from "./LayerPanel";

const BabylonMap = forwardRef(function BabylonMap({ municipiosGeojson, pronostico, clima, titulo, publicadoEn, interactive=true }, ref) {
  const canvasRef=useRef(null);const managerRef=useRef(null);const dataRef=useRef(new Map());const featuresRef=useRef(new Map());
  const [ready,setReady]=useState(false);const [backend,setBackend]=useState("");const [selected,setSelected]=useState(null);const [eagle,setEagle]=useState(null);const [quality,setQuality]=useState("MEDIUM");const [debug,setDebug]=useState(null);const [hora,setHora]=useState(()=>clima?horaActual(clima):0);const [capas,setCapas]=useState({nubes:true,lluvia:true,viento:true,temp:false});
  const relativo=useMemo(()=>tiempoRelativo(publicadoEn),[publicadoEn]);
  useEffect(()=>{dataRef.current=new Map((pronostico||[]).map((m)=>[m.id,m]));featuresRef.current=new Map((municipiosGeojson?.features||[]).map((f)=>[f.properties.id,f]));},[pronostico,municipiosGeojson]);
  const select=useCallback((id)=>setSelected(id?dataRef.current.get(id)||null:null),[]);
  const enter=useCallback((id)=>{const feature=featuresRef.current.get(id);if(!feature||!managerRef.current)return;select(id);setEagle(id);managerRef.current.flyTo(feature,true);},[select]);
  useEffect(()=>{let disposed=false;if(!canvasRef.current)return;SceneManager.create(canvasRef.current,{onPick:interactive?select:null,onDoublePick:interactive?enter:null}).then((m)=>{if(disposed){m.dispose();return;}managerRef.current=m;setBackend(m.backend);setQuality(m.quality.level);setReady(true);});return()=>{disposed=true;managerRef.current?.dispose();managerRef.current=null;};},[enter,interactive,select]);
  useEffect(()=>{if(ready)managerRef.current.setMunicipios(municipiosGeojson,dataRef.current);},[ready,municipiosGeojson,pronostico]);
  const weather=useMemo(()=>{const active=selected&&eagle?selected:null;const feature=active?featuresRef.current.get(active.id):null;const c=feature?.properties?.__worldCenter;const preset=debug?.preset&&debug.preset!=="AUTO"?debug.preset:undefined;const override=(preset||debug&&Object.values(debug).some((v)=>typeof v==="number"&&v>=0))?{preset,condition:preset,precipitationRate:debug?.rain>=0?debug.rain*8:undefined,cloudCoverage:debug?.clouds>=0?debug.clouds*100:undefined,windSpeed:debug?.wind>=0?debug.wind*20:undefined,lightningProbability:debug?.lightning>=0?debug.lightning:undefined,fog:debug?.fog>=0?debug.fog:undefined}:null;return normalizeWeather({condicion:active?.pronostico?.CONDICION||"despejado",pronostico:active?.pronostico,grilla:clima,lngLat:c?[-54.8+c.x/110,-27.05-c.z/110]:null,hora,isDay:hora>=6&&hora<20,override});},[selected,eagle,clima,hora,debug]);
  useEffect(()=>{if(ready&&weather)managerRef.current?.setWeather(weather);},[ready,weather]);
  useImperativeHandle(ref,()=>({capturePng:()=>managerRef.current?.capture()||null}));
  const leave=()=>{setEagle(null);managerRef.current?.camera.reset();};
  const setQ=(q)=>{setQuality(q);managerRef.current?.quality.set(q);};
  return <div className="base-map babylon-map">
    <canvas ref={canvasRef} className="babylon-map__canvas" aria-label="Mapa meteorológico 3D de Misiones" />
    {!ready&&<div className="babylon-map__loading">Iniciando motor 3D…</div>}
    {titulo&&<div className="map-title"><img src="/brand/ecologia-flor.png" alt="" width={30} height={30}/><div><strong>{titulo}</strong>{relativo&&<span className="map-title__meta">actualizado {relativo}</span>}<span className="map-title__meta">Babylon.js · {backend||"iniciando"}</span></div></div>}
    {interactive&&clima&&<LayerPanel capas={capas} onToggle={(id)=>setCapas((c)=>({...c,[id]:!c[id]}))} horas={clima.horas} hora={hora} horaAhora={horaActual(clima)} onHora={setHora}/>} 
    {interactive&&<button className={`eagle-btn ${eagle?"eagle-btn--on":""}`} onClick={()=>eagle?leave():null} disabled={!eagle} title="Hacé doble clic en un municipio para iniciar el vuelo"><span className="eagle-btn__icon">{eagle?"■":"🦅"}</span>{eagle?"Salir del modo águila":"Doble clic para volar"}</button>}
    {eagle&&<label className="weather-quality">Calidad clima<select value={quality} onChange={(e)=>setQ(e.target.value)}><option value="LOW">Baja</option><option value="MEDIUM">Media</option><option value="HIGH">Alta</option></select></label>}
    {import.meta.env.DEV&&<WeatherDebugPanel onChange={setDebug}/>} 
    {selected&&<div className="info-card"><button className="info-card__close" onClick={()=>select(null)}>✕</button><h3 className="info-card__nombre">{selected.nombre}</h3>{selected.pronostico?<div className="info-card__prono"><WeatherIcon condicion={selected.pronostico.CONDICION} size={56}/><div><div className="info-card__temps"><span className="info-card__tmin">{selected.pronostico.TMIN}°</span><span className="info-card__tmax">{selected.pronostico.TMAX}°</span></div><div className="info-card__cond">{selected.pronostico.CONDICION}</div></div></div>:<p>Sin pronóstico publicado.</p>}<button className="info-card__calle" onClick={()=>enter(selected.id)}>🦅 Ver en modo águila</button></div>}
  </div>;
});
export default BabylonMap;
