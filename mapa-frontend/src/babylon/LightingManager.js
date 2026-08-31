import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";

export class LightingManager {
  constructor(scene) {
    this.hemi = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
    this.sun = new DirectionalLight("sun", new Vector3(-.35, -1, .25), scene);
    this.sun.position = new Vector3(80, 130, -80); this.sun.intensity = 2.2;
  }
  update({ isDay = true, darkness = 0, lightning = 0 }) {
    const day = isDay ? 1 : .28; this.hemi.intensity = Math.max(.18, day * (1 - darkness * .65) + lightning);
    this.sun.intensity = isDay ? 2.2 * (1 - darkness * .8) + lightning * 2 : lightning * 2.5;
    this.hemi.diffuse = isDay ? new Color3(.78, .88, 1) : new Color3(.22, .3, .5);
  }
}
