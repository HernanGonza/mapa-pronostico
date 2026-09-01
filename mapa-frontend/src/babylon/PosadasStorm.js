import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";

const CLOUD_TEXTURE = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128"><defs><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".018 .04" numOctaves="5" seed="7"/><feColorMatrix values="1 0 0 0 .08 0 1 0 0 .1 0 0 1 0 .13 0 0 0 1.7 -.45"/></filter><radialGradient id="v"><stop stop-color="#d4dce1" stop-opacity=".86"/><stop offset=".55" stop-color="#68747e" stop-opacity=".72"/><stop offset="1" stop-color="#17202a" stop-opacity="0"/></radialGradient><mask id="m"><ellipse cx="128" cy="64" rx="126" ry="61" fill="url(#v)"/></mask></defs><rect width="256" height="128" filter="url(#n)" mask="url(#m)"/></svg>`);
const RAIN_TEXTURE = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="128"><defs><linearGradient id="r" y2="1"><stop stop-color="#eff9ff" stop-opacity="0"/><stop offset=".35" stop-color="#c8e8fa" stop-opacity=".22"/><stop offset="1" stop-color="#f5fbff" stop-opacity=".92"/></linearGradient></defs><path d="M8 0 4 128" stroke="url(#r)" stroke-width="2.2" stroke-linecap="round"/></svg>`);
const clamp01 = (value) => Math.max(0, Math.min(1, value));

export class PosadasStorm {
  constructor(scene, center) {
    this.scene = scene;
    this.center = center.clone();
    this.up = center.normalize();
    this.east = new Vector3(-center.y, center.x, 0).normalize();
    this.north = Vector3.Cross(this.up, this.east).normalize();
    this.nextLightning = performance.now() + 1100;
    this.flashStart = 0;
    this.flashDuration = 0;
    this.bolt = null;
    this.enabled = true;
    this.baseClearColor = scene.clearColor.clone();
    this.baseFog = {
      mode: scene.fogMode,
      density: scene.fogDensity,
      color: scene.fogColor?.clone(),
    };

    this.ambient = new HemisphericLight("storm-ambient", this.up, scene);
    this.ambient.diffuse = new Color3(0.25, 0.3, 0.36);
    this.ambient.groundColor = new Color3(0.025, 0.035, 0.05);
    this.ambient.specular = new Color3(0.08, 0.1, 0.13);
    this.ambient.intensity = 0.34;

    this.flashLight = new PointLight("storm-flash", this.center, scene);
    this.flashLight.diffuse = new Color3(0.7, 0.84, 1);
    this.flashLight.specular = new Color3(0.82, 0.9, 1);
    this.flashLight.range = 18000;
    this.flashLight.intensity = 0;

    this.clouds = new ParticleSystem("posadas-storm-clouds", 260, scene);
    this.clouds.particleTexture = new Texture(CLOUD_TEXTURE, scene, true, false);
    this.clouds.minLifeTime = 24; this.clouds.maxLifeTime = 45;
    this.clouds.minSize = 2100; this.clouds.maxSize = 5100;
    this.clouds.emitRate = 15;
    this.clouds.color1 = new Color4(0.31, 0.35, 0.39, 0.82);
    this.clouds.color2 = new Color4(0.075, 0.09, 0.12, 0.94);
    this.clouds.colorDead = new Color4(0.04, 0.055, 0.075, 0);
    this.clouds.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.clouds.startPositionFunction = (_matrix, position) => this._randomPosition(position, 9200, 2500, 4200);
    this.clouds.startDirectionFunction = (_matrix, direction) => direction.copyFrom(this.east).scaleInPlace(18 + Math.random() * 14);
    this.clouds.start();

    this.scud = new ParticleSystem("posadas-storm-scud", 100, scene);
    this.scud.particleTexture = new Texture(CLOUD_TEXTURE, scene, true, false);
    this.scud.minLifeTime = 12; this.scud.maxLifeTime = 24;
    this.scud.minSize = 700; this.scud.maxSize = 1900;
    this.scud.emitRate = 8;
    this.scud.color1 = new Color4(0.12, 0.15, 0.18, 0.58);
    this.scud.color2 = new Color4(0.055, 0.07, 0.095, 0.76);
    this.scud.colorDead = new Color4(0.05, 0.06, 0.08, 0);
    this.scud.startPositionFunction = (_matrix, position) => this._randomPosition(position, 7600, 2050, 2700);
    this.scud.startDirectionFunction = (_matrix, direction) => direction.copyFrom(this.east).scaleInPlace(28 + Math.random() * 18);
    this.scud.start();

    this.rain = new ParticleSystem("posadas-storm-rain", 5200, scene);
    this.rain.particleTexture = new Texture(RAIN_TEXTURE, scene, true, false);
    this.rain.minLifeTime = 1.5; this.rain.maxLifeTime = 2.7;
    this.rain.minSize = 11; this.rain.maxSize = 28;
    this.rain.emitRate = 2800;
    this.rain.color1 = new Color4(0.66, 0.8, 0.9, 0.56);
    this.rain.color2 = new Color4(0.84, 0.91, 0.98, 0.34);
    this.rain.colorDead = new Color4(0.45, 0.58, 0.7, 0);
    this.rain.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.rain.startPositionFunction = (_matrix, position) => this._randomPosition(position, 7600, 2350, 3900);
    this.rain.startDirectionFunction = (_matrix, direction) => direction.copyFrom(this.up).scaleInPlace(-1250 - Math.random() * 650).addInPlace(this.east.scale(180 + Math.random() * 120));
    this.rain.start();
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.ambient.setEnabled(enabled);
    if (enabled) {
      this.scene.fogMode = 3;
      this.scene.fogDensity = 0.000055;
      this.scene.fogColor = new Color3(0.11, 0.14, 0.18);
      this.clouds.start(); this.scud.start(); this.rain.start();
      this.nextLightning = performance.now() + 700 + Math.random() * 1000;
    } else {
      this.clouds.stop(); this.clouds.reset();
      this.scud.stop(); this.scud.reset();
      this.rain.stop(); this.rain.reset();
      this._disposeBolt();
      this._setFlash(0);
      this.scene.clearColor.copyFrom(this.baseClearColor);
      this.scene.fogMode = this.baseFog.mode;
      this.scene.fogDensity = this.baseFog.density;
      if (this.baseFog.color) this.scene.fogColor.copyFrom(this.baseFog.color);
    }
  }

  _randomPosition(result, radius, minHeight, maxHeight) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * radius;
    const height = minHeight + Math.random() * (maxHeight - minHeight);
    result.copyFrom(this.center).addInPlace(this.east.scale(Math.cos(angle) * distance)).addInPlace(this.north.scale(Math.sin(angle) * distance)).addInPlace(this.up.scale(height));
  }

  _makePath(start, length, segments, spread = 1) {
    const points = [start.clone()];
    let point = start.clone();
    let driftEast = (Math.random() - 0.5) * 90;
    let driftNorth = (Math.random() - 0.5) * 90;
    for (let index = 1; index <= segments; index += 1) {
      driftEast = driftEast * 0.55 + (Math.random() - 0.5) * 170 * spread;
      driftNorth = driftNorth * 0.55 + (Math.random() - 0.5) * 170 * spread;
      point = point.add(this.up.scale(-length / segments)).add(this.east.scale(driftEast)).add(this.north.scale(driftNorth));
      points.push(point);
    }
    return points;
  }

  _createTube(name, path, radius, material, tessellation = 6) {
    const mesh = MeshBuilder.CreateTube(name, { path, radius, tessellation, cap: MeshBuilder.NO_CAP }, this.scene);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.renderingGroupId = 3;
    return mesh;
  }

  _createBolt() {
    this._disposeBolt();
    const root = new TransformNode("storm-bolt", this.scene);
    const start = this.center.add(this.east.scale((Math.random() - 0.5) * 9000)).add(this.north.scale((Math.random() - 0.5) * 5500)).add(this.up.scale(3300 + Math.random() * 700));
    const mainPath = this._makePath(start, 3000 + Math.random() * 550, 18, 1);
    const coreMaterial = new StandardMaterial("lightning-core-material", this.scene);
    coreMaterial.disableLighting = true; coreMaterial.diffuseColor = Color3.Black(); coreMaterial.emissiveColor = new Color3(0.9, 0.96, 1);
    const haloMaterial = new StandardMaterial("lightning-halo-material", this.scene);
    haloMaterial.disableLighting = true; haloMaterial.diffuseColor = Color3.Black(); haloMaterial.emissiveColor = new Color3(0.22, 0.46, 1); haloMaterial.alpha = 0.13; haloMaterial.disableDepthWrite = true;
    const meshes = [];
    const halo = this._createTube("lightning-halo", mainPath, 30, haloMaterial, 8);
    const core = this._createTube("lightning-core", mainPath, 7, coreMaterial, 7);
    meshes.push(halo, core);
    const branchCount = 4 + Math.floor(Math.random() * 3);
    for (let index = 0; index < branchCount; index += 1) {
      const origin = mainPath[4 + Math.floor(Math.random() * (mainPath.length - 8))];
      const branch = this._makePath(origin, 550 + Math.random() * 900, 6 + Math.floor(Math.random() * 4), 0.7);
      const side = (index % 2 ? -1 : 1) * (220 + Math.random() * 280);
      for (let p = 1; p < branch.length; p += 1) branch[p].addInPlace(this.east.scale(side * p / branch.length));
      const branchHalo = this._createTube(`lightning-branch-halo-${index}`, branch, 13, haloMaterial, 5);
      const branchCore = this._createTube(`lightning-branch-core-${index}`, branch, 3.2, coreMaterial, 5);
      meshes.push(branchHalo, branchCore);
    }
    for (const mesh of meshes) mesh.parent = root;
    this.flashLight.position.copyFrom(mainPath[Math.floor(mainPath.length * 0.48)]);
    this.bolt = { root, meshes, coreMaterial, haloMaterial };
  }

  _disposeBolt() {
    if (!this.bolt) return;
    for (const mesh of this.bolt.meshes) mesh.dispose();
    this.bolt.coreMaterial.dispose(); this.bolt.haloMaterial.dispose(); this.bolt.root.dispose();
    this.bolt = null;
  }

  _setFlash(value) {
    const flash = clamp01(value);
    this.flashLight.intensity = flash * 78;
    this.ambient.intensity = 0.34 + flash * 1.4;
    this.scene.clearColor.r = this.baseClearColor.r + flash * 0.13;
    this.scene.clearColor.g = this.baseClearColor.g + flash * 0.17;
    this.scene.clearColor.b = this.baseClearColor.b + flash * 0.24;
    if (this.bolt) {
      this.bolt.coreMaterial.alpha = Math.min(1, flash * 1.8);
      this.bolt.haloMaterial.alpha = flash * 0.16;
      this.bolt.root.setEnabled(flash > 0.015);
    }
  }

  update(now) {
    if (!this.enabled) return;
    if (now >= this.nextLightning) {
      this._createBolt(); this.flashStart = now; this.flashDuration = 360 + Math.random() * 180;
      this.nextLightning = now + 3800 + Math.random() * 6200;
    }
    const elapsed = now - this.flashStart;
    let flash = 0;
    if (elapsed >= 0 && elapsed < this.flashDuration) {
      const pulse1 = Math.exp(-elapsed / 52);
      const pulse2 = elapsed > 105 ? 0.76 * Math.exp(-(elapsed - 105) / 45) : 0;
      const pulse3 = elapsed > 215 ? 0.5 * Math.exp(-(elapsed - 215) / 65) : 0;
      flash = Math.max(pulse1, pulse2, pulse3);
    }
    this._setFlash(flash);
    if (this.bolt && elapsed > this.flashDuration + 100) this._disposeBolt();
  }

  dispose() {
    this._disposeBolt();
    this.clouds.dispose(); this.scud.dispose(); this.rain.dispose();
    this.flashLight.dispose(); this.ambient.dispose();
    this.scene.clearColor.copyFrom(this.baseClearColor);
    this.scene.fogMode = this.baseFog.mode;
    this.scene.fogDensity = this.baseFog.density;
    if (this.baseFog.color) this.scene.fogColor.copyFrom(this.baseFog.color);
  }
}
