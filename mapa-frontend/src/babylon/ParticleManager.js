import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { GPUParticleSystem } from "@babylonjs/core/Particles/gpuParticleSystem";
import "@babylonjs/core/Particles/webgl2ParticleSystem";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";

const PARTICLE = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='4' height='16'><rect x='1' width='2' height='16' rx='1' fill='white'/></svg>");

export class ParticleManager {
  constructor(scene, engine, quality) {
    this.scene = scene; this.engine = engine; this.quality = quality; this.target = Vector3.Zero();
    const gpu = GPUParticleSystem.IsSupported;
    this.rain = gpu ? new GPUParticleSystem("gpuRain", { capacity: quality.particles }, scene) : new ParticleSystem("rainFallback", Math.min(1800, quality.particles), scene);
    this.rain.particleTexture = new Texture(PARTICLE, scene, true, false);
    this.rain.emitter = this.target; this.rain.minEmitBox = new Vector3(-42, 22, -42); this.rain.maxEmitBox = new Vector3(42, 65, 42);
    this.rain.color1 = new Color4(.65,.82,1,.5); this.rain.color2 = new Color4(.85,.92,1,.35); this.rain.colorDead = new Color4(.4,.55,.7,0);
    this.rain.minSize = .06; this.rain.maxSize = .14; this.rain.minLifeTime = .45; this.rain.maxLifeTime = 1.1; this.rain.gravity = new Vector3(0,-85,0); this.rain.direction1 = new Vector3(0,-1,0); this.rain.direction2 = new Vector3(0,-1,0); this.rain.emitRate = 0; this.rain.start();
    this.hail = new ParticleSystem("hail", Math.min(800, quality.particles / 5), scene); this.hail.particleTexture = new Texture(PARTICLE, scene, true, false); this.hail.emitter = this.target; this.hail.minEmitBox = new Vector3(-28,20,-28); this.hail.maxEmitBox = new Vector3(28,50,28); this.hail.gravity = new Vector3(0,-110,0); this.hail.minSize=.14;this.hail.maxSize=.28;this.hail.minLifeTime=.4;this.hail.maxLifeTime=.8;this.hail.emitRate=0;this.hail.start();
  }
  setTarget(v) { this.target.copyFrom(v); }
  update({ nearPrecipitation = 0, hail = 0, wind = 0, weather }) {
    const angle = ((weather?.windDirection || 0) * Math.PI) / 180; const wx = Math.sin(angle) * wind * 22; const wz = Math.cos(angle) * wind * 22;
    this.rain.gravity.set(wx, -85, wz); this.rain.emitRate = nearPrecipitation * this.quality.particles * .8;
    this.hail.gravity.set(wx*.5,-110,wz*.5); this.hail.emitRate = hail * Math.min(800, this.quality.particles/5);
  }
  dispose() { this.rain.dispose(); this.hail.dispose(); }
}
