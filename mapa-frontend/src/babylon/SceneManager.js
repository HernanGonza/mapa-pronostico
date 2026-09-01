import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PolygonMeshBuilder } from "@babylonjs/core/Meshes/polygonMesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import "@babylonjs/core/Rendering/edgesRenderer";
import earcut from "earcut";
import { featureCenter, featureRings } from "./geo";
import { QualityManager } from "./QualityManager";
import { CameraDirector } from "./CameraDirector";
import { LightingManager } from "./LightingManager";
import { AtmosphereManager } from "./AtmosphereManager";
import { ParticleManager } from "./ParticleManager";
import { WeatherDirector } from "./WeatherDirector";
import { PoliticalMapManager } from "./PoliticalMapManager";
import { ClimateLayerManager } from "./ClimateLayerManager";

export class SceneManager {
  static async create(canvas, options={}) { const manager=new SceneManager(canvas,options);await manager.init();return manager; }
  constructor(canvas,{onPick,onDoublePick}={}) { this.canvas=canvas;this.onPick=onPick;this.onDoublePick=onDoublePick;this.meshes=new Map();this.last=performance.now(); }
  async init() {
    if (navigator.gpu) { try { this.engine=new WebGPUEngine(this.canvas,{antialias:true,adaptToDeviceRatio:false});await Promise.race([this.engine.initAsync(),new Promise((_,reject)=>setTimeout(()=>reject(new Error("Timeout inicializando WebGPU")),3500))]);this.backend="WebGPU";} catch(e){console.warn("[Babylon] WebGPU no disponible, usando WebGL2",e);try{this.engine?.dispose();}catch{/* engine incompleto */}this.engine=new Engine(this.canvas,true,{preserveDrawingBuffer:true,stencil:true});this.backend="WebGL2";} }
    else { this.engine=new Engine(this.canvas,true,{preserveDrawingBuffer:true,stencil:true});this.backend="WebGL2"; }
    this.scene=new Scene(this.engine);this.quality=new QualityManager(this.engine);this.camera=new CameraDirector(this.scene,this.canvas);this.lighting=new LightingManager(this.scene);this.atmosphere=new AtmosphereManager(this.scene);this.particles=new ParticleManager(this.scene,this.engine,this.quality);this.weather=new WeatherDirector({scene:this.scene,atmosphere:this.atmosphere,lighting:this.lighting,particles:this.particles});this.political=new PoliticalMapManager(this.scene);this.climateLayers=new ClimateLayerManager(this.scene);
    this.scene.onPointerPick=(evt,pick)=>{const id=pick.pickedMesh?.metadata?.municipioId;if(id)this.onPick?.(id);};
    this.canvas.addEventListener("dblclick",this.handleDouble=()=>{const pick=this.scene.pick(this.scene.pointerX,this.scene.pointerY);const id=pick?.pickedMesh?.metadata?.municipioId;if(id)this.onDoublePick?.(id);});
    this.engine.runRenderLoop(()=>{const now=performance.now();this.camera.update(now-this.last);this.last=now;this.weather.update(now,this.camera.flightProgress);this.onFrame?.(now);this.scene.render();});this.resize=()=>this.engine.resize();window.addEventListener("resize",this.resize);
  }
  setMunicipios(geojson,dataById) { for(const mesh of this.meshes.values())mesh.dispose();this.meshes.clear();for(const feature of geojson?.features||[]){const id=feature.properties.id;for(const [index,rings] of featureRings(feature).entries()){if(rings.outer.length<3)continue;const builder=new PolygonMeshBuilder(`municipio-${id}-${index}`,rings.outer,this.scene,earcut);for(const hole of rings.holes)builder.addHole(hole);const mesh=builder.build(false,.65);mesh.position.y=.65;mesh.metadata={municipioId:id};const mat=new PBRMaterial(`mat-${id}-${index}`,this.scene);const cond=dataById.get(id)?.pronostico?.CONDICION||"";mat.albedoColor=/torment|lluv/i.test(cond)?new Color3(.12,.3,.42):/despej|sole/i.test(cond)?new Color3(.42,.65,.33):new Color3(.31,.53,.47);mat.roughness=.72;mat.metallic=.05;mesh.material=mat;mesh.enableEdgesRendering();mesh.edgesWidth=1.5;mesh.edgesColor.set(.05,.16,.12,1);this.meshes.set(`${id}-${index}`,mesh);}feature.properties.__worldCenter=featureCenter(feature); } }
  setPolitical({world,provinces,countryLabels,provinceLabels,municipios}) { this.political.clear();this.political.addCountries(world);this.political.addBoundaries(world,{color:new Color3(.66,.82,.73),y:1.42});this.political.addBoundaries(provinces,{color:new Color3(.82,.9,.85),y:1.5});this.political.addLabels(countryLabels,{size:10,y:3.2,color:"#b9c9bf"});this.political.addLabels(provinceLabels,{size:6,y:2.8,color:"#d6e2da"});this.political.addMunicipalityLabels(municipios); }
  setClimateGrid(grid,hour){this.climateLayers.setData(grid,hour);}
  setClimateLayer(id,value){this.climateLayers.setVisible(id,value);}
  setWeather(weather,progress=1) { this.weather.transitionTo(weather);this.weatherProgress=progress; }
  flyTo(feature,municipal=true) { const target=feature?.properties?.__worldCenter||featureCenter(feature);this.particles.setTarget(target);this.camera.flyTo(target,municipal,matchMedia?.("(prefers-reduced-motion: reduce)").matches); }
  capture() { return this.canvas.toDataURL("image/png"); }
  dispose(){window.removeEventListener("resize",this.resize);this.canvas.removeEventListener("dblclick",this.handleDouble);this.scene.dispose();this.engine.dispose();}
}
