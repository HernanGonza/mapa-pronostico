import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Animation } from "@babylonjs/core/Animations/animation";

export class CameraDirector {
  constructor(scene, canvas) {
    this.scene = scene; this.canvas = canvas; this.flightProgress = 1; this.orbit = false;
    this.camera = new ArcRotateCamera("eagleCamera", Math.PI/2, .38, 390, Vector3.Zero(), scene);
    this.camera.lowerRadiusLimit = 20; this.camera.upperRadiusLimit = 1400; this.camera.lowerBetaLimit = .25; this.camera.upperBetaLimit = 1.48;
    this.camera.wheelPrecision = 8; this.camera.panningSensibility = 120; this.camera.attachControl(canvas, true);
  }
  flyTo(target, municipal = true, reduced = false) {
    this.orbit = false; this.flightProgress = reduced ? 1 : 0; const frames = reduced ? 1 : 90;
    Animation.CreateAndStartAnimation("targetFlight", this.camera, "target", 30, frames, this.camera.target.clone(), target.clone(), 1);
    Animation.CreateAndStartAnimation("radiusFlight", this.camera, "radius", 30, frames, this.camera.radius, municipal ? 48 : 390, 1, undefined, () => { this.flightProgress = 1; this.orbit = municipal; });
    Animation.CreateAndStartAnimation("betaFlight", this.camera, "beta", 30, frames, this.camera.beta, .86, 1);
    this.flightStart = performance.now(); this.flightDuration = frames / 30 * 1000;
  }
  reset() { this.orbit = false; this.flyTo(Vector3.Zero(), false); }
  update(dt) { if (this.flightProgress < 1) this.flightProgress = Math.min(1, (performance.now()-this.flightStart)/this.flightDuration); if (this.orbit) this.camera.alpha += dt * .000035; }
  dispose() { this.camera.dispose(); }
}
