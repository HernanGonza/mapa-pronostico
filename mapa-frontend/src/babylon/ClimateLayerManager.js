import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { geoToWorld } from "./geo";

const clamp=(n)=>Math.max(0,Math.min(1,n));
function tempColor(t){const x=clamp((t-5)/35);return x<.5?Color3.Lerp(new Color3(.12,.38,.9),new Color3(.2,.82,.55),x*2):Color3.Lerp(new Color3(.95,.78,.18),new Color3(.82,.08,.12),(x-.5)*2);}
function at(p,key,h){const values=p[key]||[];if(!values.length)return 0;const i=Math.max(0,Math.min(values.length-1,Math.floor(h)));const j=Math.min(values.length-1,i+1),f=h-i;return (values[i]??0)*(1-f)+(values[j]??0)*f;}

export class ClimateLayerManager {
  constructor(scene){this.scene=scene;this.root={temp:new TransformNode("temperature-layer",scene),nubes:new TransformNode("cloud-layer",scene),lluvia:new TransformNode("rain-layer",scene),viento:new TransformNode("wind-layer",scene)};this.enabled={temp:false,nubes:true,lluvia:true,viento:true};}
  clear(){for(const root of Object.values(this.root))for(const child of root.getChildren())child.dispose(false,true);}
  setData(grid,hour=0){this.clear();if(!grid?.puntos)return;const stride=grid.puntos.length>80?2:1;
    for(let i=0;i<grid.puntos.length;i+=stride){const p=grid.puntos[i],base=geoToWorld(p.lng,p.lat);const temp=at(p,"temp",hour),cloud=clamp(at(p,"cloud",hour)/100),rain=clamp(at(p,"precip",hour)/8),u=at(p,"windU",hour),v=at(p,"windV",hour);
      const heat=MeshBuilder.CreateDisc(`temp-${i}`,{radius:15,tessellation:18},this.scene);heat.rotation.x=Math.PI/2;heat.position.copyFrom(base);heat.position.y=1.45;const hm=new StandardMaterial(`temp-mat-${i}`,this.scene);hm.diffuseColor=tempColor(temp);hm.emissiveColor=hm.diffuseColor.scale(.35);hm.alpha=.58;hm.disableDepthWrite=true;heat.material=hm;heat.parent=this.root.temp;heat.isPickable=false;
      if(cloud>.08){const c=MeshBuilder.CreateDisc(`cloud-${i}`,{radius:12+cloud*12,tessellation:14},this.scene);c.rotation.x=Math.PI/2;c.position.copyFrom(base);c.position.y=7;const cm=new StandardMaterial(`cloud-mat-${i}`,this.scene);cm.diffuseColor=new Color3(.82,.87,.89);cm.emissiveColor=new Color3(.18,.2,.21);cm.alpha=.05+cloud*.25;cm.disableDepthWrite=true;c.material=cm;c.parent=this.root.nubes;c.isPickable=false;}
      if(rain>.02){const curtain=MeshBuilder.CreateCylinder(`rain-zone-${i}`,{height:16,diameter:10+rain*16,tessellation:12},this.scene);curtain.position.copyFrom(base);curtain.position.y=8;const rm=new StandardMaterial(`rain-mat-${i}`,this.scene);rm.diffuseColor=new Color3(.18,.48,.72);rm.emissiveColor=new Color3(.06,.14,.22);rm.alpha=.04+rain*.14;rm.disableDepthWrite=true;curtain.material=rm;curtain.parent=this.root.lluvia;curtain.isPickable=false;}
      const speed=Math.hypot(u,v);if(speed>.3){const scale=2.5+Math.min(10,speed*.7);const points=[new Vector3(base.x,2.3,base.z),new Vector3(base.x+u*scale,2.3,base.z-v*scale)];const line=MeshBuilder.CreateLines(`wind-${i}`,{points},this.scene);line.color=new Color3(.88,.94,.94);line.alpha=.5;line.parent=this.root.viento;line.isPickable=false;}
    }this.applyVisibility();}
  setVisible(id,value){this.enabled[id]=value;this.applyVisibility();}
  applyVisibility(){for(const [id,root] of Object.entries(this.root))root.setEnabled(this.enabled[id]);}
  dispose(){for(const root of Object.values(this.root))root.dispose(false,true);}
}
