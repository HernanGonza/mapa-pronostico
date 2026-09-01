import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { GPUParticleSystem } from "@babylonjs/core/Particles/gpuParticleSystem";
import "@babylonjs/core/Particles/webgl2ParticleSystem";
import { presetVisual } from "../weather/WeatherPresets";
import { WeatherDirector } from "../weather/WeatherDirector";
import { AudioManager } from "../babylon/AudioManager";

const RAIN_TEXTURE = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='8' height='32'><defs><linearGradient id='g' y2='1'><stop stop-color='white' stop-opacity='0'/><stop offset='1' stop-color='#b9dcff'/></linearGradient></defs><rect x='3' width='2' height='32' rx='1' fill='url(#g)'/></svg>"
);

const HAIL_TEXTURE = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><circle cx='8' cy='8' r='6' fill='#edf7ff'/></svg>"
);
const CLOUD_TEXTURE = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='128' height='64'><defs><radialGradient id='g'><stop stop-color='#e9f0f2' stop-opacity='.65'/><stop offset='.7' stop-color='#9aa9b0' stop-opacity='.25'/><stop offset='1' stop-color='#65747c' stop-opacity='0'/></radialGradient></defs><ellipse cx='64' cy='32' rx='62' ry='29' fill='url(#g)'/></svg>"
);

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

/**
 * Escena meteorológica Babylon transparente. La geografía y la cámara siguen
 * perteneciendo a BaseMap/MapLibre: este canvas nunca reemplaza el globo.
 */
const BabylonWeatherFX = forwardRef(function BabylonWeatherFX(
  { active, sampler, flightProgress, quality = "MEDIUM", onUnavailable },
  ref
) {
  const canvasRef = useRef(null);
  const runtimeRef = useRef(null);
  const directorRef = useRef(null);
  const propsRef = useRef({ active, sampler, flightProgress, quality });
  propsRef.current = { active, sampler, flightProgress, quality };

  useImperativeHandle(ref, () => ({ canvas: () => canvasRef.current }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    // No crear un segundo contexto WebGL mientras el mapa está en modo normal.
    // Babylon sólo vive durante la cinematográfica meteorológica.
    if (!active) return undefined;
    let engine;
    let scene;
    let disposed = false;
    try {
      engine = new Engine(canvas, true, {
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        stencil: false,
      });
      scene = new Scene(engine);
      const audio = new AudioManager();
      directorRef.current = new WeatherDirector({ audio });
      scene.autoClear = true;
      scene.clearColor = new Color4(0, 0, 0, 0);
      const camera = new FreeCamera("weather-camera", new Vector3(0, 0, -24), scene);
      camera.setTarget(Vector3.Zero());
      camera.mode = FreeCamera.ORTHOGRAPHIC_CAMERA;
      camera.orthoLeft = -16;
      camera.orthoRight = 16;
      camera.orthoTop = 9;
      camera.orthoBottom = -9;

      const haze = MeshBuilder.CreatePlane("weather-haze", { width: 32, height: 18 }, scene);
      haze.position.z = 1;
      const hazeMaterial = new StandardMaterial("weather-haze-material", scene);
      hazeMaterial.diffuseColor = new Color3(0.68, 0.76, 0.79);
      hazeMaterial.emissiveColor = new Color3(0.2, 0.25, 0.28);
      hazeMaterial.alpha = 0;
      hazeMaterial.disableLighting = true;
      hazeMaterial.backFaceCulling = false;
      haze.material = hazeMaterial;

      const useGpu = GPUParticleSystem.IsSupported;
      const rain = useGpu
        ? new GPUParticleSystem("babylon-rain", { capacity: 2600 }, scene)
        : new ParticleSystem("babylon-rain", 1100, scene);
      rain.particleTexture = new Texture(RAIN_TEXTURE, scene, true, false);
      rain.emitter = new Vector3(0, 12, 0);
      rain.minEmitBox = new Vector3(-18, -2, -2);
      rain.maxEmitBox = new Vector3(18, 5, 2);
      rain.direction1 = new Vector3(-1.2, -20, 0);
      rain.direction2 = new Vector3(1.2, -25, 0);
      rain.gravity = new Vector3(0, -18, 0);
      rain.minLifeTime = 0.55;
      rain.maxLifeTime = 1.15;
      rain.minSize = 0.08;
      rain.maxSize = 0.18;
      rain.color1 = new Color4(0.62, 0.82, 1, 0.62);
      rain.color2 = new Color4(0.82, 0.92, 1, 0.4);
      rain.colorDead = new Color4(0.5, 0.7, 1, 0);
      rain.emitRate = 0;
      rain.start();

      const hail = useGpu
        ? new GPUParticleSystem("babylon-hail", { capacity: 420 }, scene)
        : new ParticleSystem("babylon-hail", 260, scene);
      hail.particleTexture = new Texture(HAIL_TEXTURE, scene, true, false);
      hail.emitter = new Vector3(0, 12, 0);
      hail.minEmitBox = new Vector3(-17, -2, -1);
      hail.maxEmitBox = new Vector3(17, 4, 1);
      hail.direction1 = new Vector3(-1, -24, 0);
      hail.direction2 = new Vector3(1, -30, 0);
      hail.gravity = new Vector3(0, -24, 0);
      hail.minLifeTime = 0.45;
      hail.maxLifeTime = 0.9;
      hail.minSize = 0.09;
      hail.maxSize = 0.22;
      hail.color1 = new Color4(0.9, 0.96, 1, 0.9);
      hail.color2 = new Color4(0.72, 0.86, 1, 0.72);
      hail.emitRate = 0;
      hail.start();

      const clouds = new ParticleSystem("babylon-clouds", 42, scene);
      clouds.particleTexture = new Texture(CLOUD_TEXTURE, scene, true, false);
      clouds.emitter = new Vector3(0, 7, 0);
      clouds.minEmitBox = new Vector3(-18, 0, -1);
      clouds.maxEmitBox = new Vector3(18, 4, 1);
      clouds.direction1 = new Vector3(-0.2, 0.02, 0);
      clouds.direction2 = new Vector3(0.2, 0.04, 0);
      clouds.minLifeTime = 18;
      clouds.maxLifeTime = 34;
      clouds.minSize = 3.5;
      clouds.maxSize = 8;
      clouds.color1 = new Color4(0.8, 0.88, 0.91, 0.22);
      clouds.color2 = new Color4(0.45, 0.53, 0.58, 0.12);
      clouds.colorDead = new Color4(0.4, 0.5, 0.55, 0);
      clouds.emitRate = 0;
      clouds.start();

      let lastLightning = 0;
      let flash = 0;
      let lastRender = 0;
      engine.runRenderLoop(() => {
        const p = propsRef.current;
        if (!p.active) return;
        const now = performance.now();
        if (now - lastRender < 1000 / 30) return;
        lastRender = now;
        const progress = clamp01(p.flightProgress?.() ?? 1);
        const weather = p.sampler?.() || {};
        const key = JSON.stringify([weather.preset, weather.condition, weather.precipitationRate, weather.cloudCoverage, weather.windSpeed, weather.lightningProbability]);
        if (key !== directorRef.current.key) directorRef.current.transitionTo(weather);
        const visual = directorRef.current.update(now, progress);
        const preset = presetVisual(weather.preset || "CLEAR");
        const measuredRain = clamp01((weather.precipitationRate || weather.precipitation || 0) / 8);
        const rainValue = Math.max(measuredRain, clamp01(visual.rain), clamp01(preset.rain));
        const hailValue = Math.max(clamp01(weather.hail), clamp01(visual.hail), clamp01(preset.hail));
        const wind = Math.max(clamp01((weather.windSpeed || 0) / 20), clamp01(visual.wind));
        const direction = ((weather.windDirection || 0) * Math.PI) / 180;
        const qualityScale = p.quality === "HIGH" ? 1 : p.quality === "LOW" ? 0.38 : 0.68;
        const entry = clamp01((progress - 0.45) / 0.55);
        hazeMaterial.alpha = Math.min(0.34, clamp01(visual.fog) * 0.28 + clamp01(visual.haze) * 0.06) * entry;
        clouds.emitRate = visual.clouds * 18 * qualityScale;
        clouds.direction1.x = -0.2 - wind * 1.5;
        clouds.direction2.x = 0.2 - wind * 1.5;
        rain.emitRate = rainValue * entry * 4300 * qualityScale;
        hail.emitRate = hailValue * entry * 700 * qualityScale;
        const wx = Math.sin(direction) * wind * 10;
        rain.direction1.x = wx - 0.8;
        rain.direction2.x = wx + 0.8;
        hail.direction1.x = wx * 0.65 - 0.6;
        hail.direction2.x = wx * 0.65 + 0.6;

        const lightning = Math.max(
          clamp01(weather.lightningProbability || weather.lightning),
          clamp01(preset.lightning),
          clamp01(visual.lightning)
        );
        if (lightning > 0.05 && now - lastLightning > 800 + Math.random() * 2400 && Math.random() < lightning * 0.12) {
          flash = 0.7 + lightning * 0.3;
          lastLightning = now;
        }
        flash *= 0.72;
        scene.clearColor = new Color4(0.72, 0.84, 1, flash * 0.34);
        scene.render();
      });

      const resize = () => engine.resize();
      window.addEventListener("resize", resize);
      runtimeRef.current = { engine, scene, resize, audio, clouds };
    } catch (error) {
      console.warn("[BabylonWeatherFX] no disponible:", error);
      onUnavailable?.(error);
    }
    return () => {
      disposed = true;
      const runtime = runtimeRef.current;
      if (runtime) window.removeEventListener("resize", runtime.resize);
      if (!disposed) return;
      scene?.dispose();
      engine?.dispose();
      runtime?.audio?.dispose();
      runtimeRef.current = null;
    };
  }, [active, onUnavailable]);

  return <canvas ref={canvasRef} className="babylon-weather-fx" hidden={!active} aria-hidden="true" />;
});

export default BabylonWeatherFX;
