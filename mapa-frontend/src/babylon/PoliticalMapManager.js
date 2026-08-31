import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PolygonMeshBuilder } from "@babylonjs/core/Meshes/polygonMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import earcut from "earcut";
import { geoToWorld, ringToWorld } from "./geo";
import { featureCenter } from "./geo";

const REGION = { west: -61, east: -49, south: -35, north: -20 };
const intersects = (ring) => ring.some(([lng,lat]) => lng>REGION.west&&lng<REGION.east&&lat>REGION.south&&lat<REGION.north);
function polygons(feature){const c=feature.geometry?.coordinates||[];return feature.geometry?.type==="Polygon"?[c]:feature.geometry?.type==="MultiPolygon"?c:[];}
function lineRings(feature){if(feature.geometry?.type==="LineString")return [feature.geometry.coordinates];if(feature.geometry?.type==="MultiLineString")return feature.geometry.coordinates;return polygons(feature).flatMap((p)=>p);}

export class PoliticalMapManager {
  constructor(scene){this.scene=scene;this.items=[];this.labels=[];}
  clear(){for(const m of this.items)m.dispose(false,true);for(const m of this.labels)m.dispose(false,true);this.items=[];this.labels=[];}
  addCountries(geojson){
    for(const f of geojson?.features||[]){for(const poly of polygons(f)){if(!intersects(poly[0]))continue;const outer=ringToWorld(poly[0]);if(outer.length<3)continue;const b=new PolygonMeshBuilder(`pais-${f.properties?.nombre}`,outer,this.scene,earcut);for(const h of poly.slice(1))if(intersects(h))b.addHole(ringToWorld(h));const mesh=b.build(false,.18);mesh.position.y=-.05;mesh.isPickable=false;const mat=new StandardMaterial(`pais-mat-${this.items.length}`,this.scene);const n=(f.properties?.nombre||"").toLowerCase();mat.diffuseColor=n.includes("argentina")?new Color3(.12,.23,.2):n.includes("brazil")?new Color3(.16,.25,.2):new Color3(.18,.22,.2);mat.specularColor=Color3.Black();mesh.material=mat;this.items.push(mesh);}}
  }
  addBoundaries(geojson,{color=new Color3(.48,.62,.55),y=.85,dashed=false}={}){
    for(const f of geojson?.features||[]){for(const ring of lineRings(f)){if(!intersects(ring))continue;const points=ring.filter((_,i)=>!dashed||i%2===0).map(([lng,lat])=>geoToWorld(lng,lat,y));if(points.length<2)continue;const line=MeshBuilder.CreateLines(`limite-${this.items.length}`,{points,updatable:false},this.scene);line.color=color;line.alpha=.72;line.isPickable=false;this.items.push(line);}}
  }
  addLabels(geojson,{size=8,y=3,color="#dce8df"}={}){
    for(const f of geojson?.features||[]){if(f.geometry?.type!=="Point")continue;const [lng,lat]=f.geometry.coordinates;if(!intersects([[lng,lat]]))continue;const name=f.properties?.nombre||f.properties?.name;if(!name)continue;const tex=new DynamicTexture(`label-${name}`,{width:512,height:96},this.scene,false);tex.hasAlpha=true;tex.drawText(String(name).toUpperCase(),null,62,"600 38px Arial",color,"transparent",true,true);const mat=new StandardMaterial(`label-mat-${name}`,this.scene);mat.diffuseTexture=tex;mat.opacityTexture=tex;mat.emissiveColor=new Color3(.85,.9,.87);mat.disableLighting=true;mat.backFaceCulling=false;const plane=MeshBuilder.CreatePlane(`rotulo-${name}`,{width:size*4.8,height:size*.9},this.scene);plane.position=geoToWorld(lng,lat,y);plane.billboardMode=Mesh.BILLBOARDMODE_ALL;plane.material=mat;plane.isPickable=false;this.labels.push(plane);}
  }
  addMunicipalityLabels(geojson){for(const f of geojson?.features||[]){const name=f.properties?.nombre;if(!name)continue;const p=featureCenter(f);const tex=new DynamicTexture(`mun-label-${name}`,{width:384,height:72},this.scene,false);tex.hasAlpha=true;tex.drawText(String(name).toUpperCase(),null,47,"600 27px Arial","#f1f5ed","transparent",true,true);const mat=new StandardMaterial(`mun-label-mat-${name}`,this.scene);mat.diffuseTexture=tex;mat.opacityTexture=tex;mat.emissiveColor=Color3.White();mat.disableLighting=true;mat.backFaceCulling=false;const plane=MeshBuilder.CreatePlane(`mun-rotulo-${name}`,{width:22,height:4.1},this.scene);plane.position=p;plane.position.y=3.5;plane.billboardMode=Mesh.BILLBOARDMODE_ALL;plane.material=mat;plane.isPickable=false;this.labels.push(plane);}}
  dispose(){this.clear();}
}
