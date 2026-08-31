import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

export class AtmosphereManager {
  constructor(scene) {
    this.scene = scene; scene.fogMode = 3; scene.fogDensity = .002;
    this.sky = MeshBuilder.CreateSphere("atmosphere", { diameter: 800, segments: 20, sideOrientation: 1 }, scene);
    const material = new StandardMaterial("skyMaterial", scene); material.disableLighting = true; material.backFaceCulling = false; material.emissiveColor = new Color3(.2, .42, .68); this.sky.material = material; this.sky.isPickable = false;
  }
  update({ weather, fog = 0, haze = 0, darkness = 0, clouds = 0 }) {
    const night = weather?.isDay === false; const storm = darkness;
    const sky = night ? new Color3(.012, .025, .08) : new Color3(.18, .42, .7);
    this.sky.material.emissiveColor = Color3.Lerp(sky, new Color3(.08, .1, .13), storm * .8 + clouds * .16);
    this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    this.scene.fogDensity = .0005 + fog * .022 + haze * .004;
    this.scene.fogColor = Color3.Lerp(night ? new Color3(.05,.07,.12) : new Color3(.62,.72,.78), new Color3(.16,.18,.2), storm);
  }
  dispose() { this.sky.dispose(); }
}
