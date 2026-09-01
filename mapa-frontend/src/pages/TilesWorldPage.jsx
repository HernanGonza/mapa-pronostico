import { useEffect, useRef, useState } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { GeospatialCamera } from "@babylonjs/core/Cameras/geospatialCamera";
import { GeospatialClippingBehavior } from "@babylonjs/core/Behaviors/Cameras/geospatialClippingBehavior";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { TilesWorldManager } from "../babylon/TilesWorldManager";
import { GeospatialPoliticalLayer, POLITICAL_COLORS } from "../babylon/GeospatialPoliticalLayer";
import { CESIUM_ION_ASSET_ID, CESIUM_ION_TOKEN, HORIZON_STORM_VIDEO_URL, TILES_ROOT_URL } from "../config";
import { getGeo, getMunicipiosGeojson, getMundoGeojson } from "../api";
// El loader glTF de 3d-tiles-renderer crea materiales PBR. En Vite los
// módulos de shaders no se incluyen por tree-shaking si no se importan como
// efectos secundarios; sin ellos Babylon intenta pedir `pbr.fragment.fx` y
// recibe el index.html de Vite, provocando el shader error y tiles negros.
import "@babylonjs/core/Shaders/pbr.vertex";
import "@babylonjs/core/Shaders/pbr.fragment";

const PLANET_RADIUS = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;
const WGS84_POLAR_RADIUS = PLANET_RADIUS * (1 - WGS84_F);
// En esta escala geoespacial, un radio de ~420 m deja la cámara a unos 200 m
// sobre el terreno con el pitch de vuelo. No permitimos acercarnos más.
const SAFE_MIN_RADIUS = 420;
const EAGLE_RADIUS = 420;
const EAGLE_PITCH = 75 * Math.PI / 180;
const RENDER_REVISION = "tiles-clean-20260901-1";

const CIUDADES = {
  posadas: { nombre: "Posadas", lat: -27.3621, lon: -55.9009, altura: 1150, yaw: -0.35 },
  obera: { nombre: "Oberá", lat: -27.4871, lon: -55.1199, altura: 1050, yaw: -0.2 },
};
const VISTA_MISIONES = { nombre: "Misiones", lat: -26.92, lon: -54.72, altura: 185000, pitch: 0.32, yaw: -0.12 };
const TORMENTAS = [...Array.from({ length: 8 }, (_, index) => ({
  id: index + 1,
  nombre: `Tormenta ${index + 1}`,
  src: index === 0 ? (HORIZON_STORM_VIDEO_URL || "/storm.mp4") : `/storm${index + 1}.mp4`,
})),
  { id: "sunny", nombre: "Soleado", src: "/sunny.mp4" },
  { id: "sunny2", nombre: "Soleado 2", src: "/sunny2.mp4" },
  { id: "sunny3", nombre: "Soleado 3", src: "/sunny3.mp4" },
  { id: "sunny4", nombre: "Soleado 4", src: "/sunny4.mp4" },
  { id: "sunny5", nombre: "Soleado 5", src: "/sunny5.mp4" },
  { id: "sunny6", nombre: "Soleado 6", src: "/sunny6.mp4" },
];

function aEcef(latitud, longitud, altura = 0) {
  const lat = latitud * Math.PI / 180;
  const lon = longitud * Math.PI / 180;
  const sinLat = Math.sin(lat);
  const n = PLANET_RADIUS / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return new Vector3(
    (n + altura) * Math.cos(lat) * Math.cos(lon),
    (n + altura) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - WGS84_E2) + altura) * sinLat,
  );
}

function alturaGeodesica(position) {
  const p = Math.hypot(position.x, position.y);
  let lat = Math.atan2(position.z, p * (1 - WGS84_E2));
  let altura = 0;
  for (let index = 0; index < 5; index += 1) {
    const sinLat = Math.sin(lat);
    const n = PLANET_RADIUS / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    altura = p / Math.max(1e-8, Math.cos(lat)) - n;
    lat = Math.atan2(position.z, p * (1 - WGS84_E2 * n / (n + altura)));
  }
  return altura;
}

function limitarAlturaMinima(camera, minimo = 200) {
  if (!camera || alturaGeodesica(camera.position) >= minimo) return;
  // Aumentamos el radio hasta recuperar la altura mínima. Se hace sólo cuando
  // la cámara cruza el umbral (no en cada frame), por lo que no penaliza el
  // render normal ni el streaming de tiles.
  let low = camera.radius;
  let high = Math.max(camera.radius * 1.5, camera.radius + 300);
  for (let index = 0; index < 18; index += 1) {
    const middle = (low + high) / 2;
    camera.radius = middle;
    if (alturaGeodesica(camera.position) < minimo) low = middle;
    else high = middle;
  }
  camera.radius = high;
}

function formatMeters(value) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 10000) return `${(value / 1000).toFixed(1)} km`;
  return `${Math.round(value)} m`;
}

function degrees(radians) {
  return radians * 180 / Math.PI;
}

function headingDegrees(yaw) {
  return (degrees(yaw) % 360 + 360) % 360;
}

function lonLatFromEcef(point) {
  const lon = Math.atan2(point.y, point.x);
  const p = Math.hypot(point.x, point.y);
  let lat = Math.atan2(point.z, p * (1 - WGS84_E2));
  for (let index = 0; index < 5; index += 1) {
    const sinLat = Math.sin(lat);
    const n = PLANET_RADIUS / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    lat = Math.atan2(point.z + WGS84_E2 * n * sinLat, p);
  }
  return [lon * 180 / Math.PI, lat * 180 / Math.PI];
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function containsCoordinate(feature, coordinate) {
  const polygons = feature.geometry?.type === "Polygon"
    ? [feature.geometry.coordinates]
    : feature.geometry?.type === "MultiPolygon" ? feature.geometry.coordinates : [];
  return polygons.some((polygon) => pointInRing(coordinate, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(coordinate, hole)));
}

function featureDestination(feature) {
  const polygons = feature.geometry?.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry?.coordinates || [];
  const points = polygons.flat(2);
  let west = Infinity; let east = -Infinity; let south = Infinity; let north = -Infinity;
  for (const [lon, lat] of points) {
    west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return {
    nombre: feature.properties?.nombre || feature.properties?.name || "Municipio",
    lon: (west + east) / 2,
    lat: (south + north) / 2,
    altura: 1350,
    pitch: EAGLE_PITCH,
    yaw: -0.25,
  };
}

export default function TilesWorldPage() {
  const canvasRef = useRef(null);
  const cameraRef = useRef(null);
  const flightIdRef = useRef(0);
  const eagleRef = useRef(false);
  const lastUiRef = useRef(0);
  const altitudeUiRef = useRef(0);
  const [ciudad, setCiudad] = useState("posadas");
  const [locationName, setLocationName] = useState("Posadas");
  const [estado, setEstado] = useState(CESIUM_ION_TOKEN || TILES_ROOT_URL ? "Conectando…" : "Falta configurar el acceso");
  const [visibles, setVisibles] = useState(0);
  const [creditos, setCreditos] = useState("");
  const [eagle, setEagle] = useState(false);
  const [politicalStatus, setPoliticalStatus] = useState("Cargando límites…");
  const [cameraMetrics, setCameraMetrics] = useState({ altitude: 0, radius: 0, heading: 0, tilt: 0 });
  const [stormVideo, setStormVideo] = useState(TORMENTAS[0].src);
  const stormVideoRef = useRef(TORMENTAS[0].src);


  const irADestino = (destino, id, animado = true) => {
    const camera = cameraRef.current;
    if (!destino || !camera) return;
    const flightId = ++flightIdRef.current;
    setCiudad(id && CIUDADES[id] ? id : "");
    setLocationName(destino.nombre);
    eagleRef.current = false;
    setEagle(false);
    const centro = aEcef(destino.lat, destino.lon);
    const pitch = destino.pitch ?? 1.08;
    if (!animado) {
      camera.center = centro;
      camera.radius = destino.altura;
      camera.pitch = pitch;
      camera.yaw = destino.yaw;
      return;
    }
    const inicio = performance.now();
    const duracion = destino.altura > 50000 ? 2400 : 3200;
    const centroInicial = camera.center.clone();
    const centroInterpolado = new Vector3();
    const radioInicial = camera.radius;
    const pitchInicial = camera.pitch;
    const yawInicial = camera.yaw;
    const deltaYaw = Math.atan2(Math.sin(destino.yaw - yawInicial), Math.cos(destino.yaw - yawInicial));
    const arco = destino.altura > 50000 ? 70000 : 42000;
    setEstado(`Volando a ${destino.nombre}…`);
    const frame = (now) => {
      if (flightId !== flightIdRef.current || cameraRef.current !== camera) return;
      const linear = Math.min(1, (now - inicio) / duracion);
      const t = linear * linear * (3 - 2 * linear);
      Vector3.SlerpToRef(centroInicial, centro, t, centroInterpolado);
      camera.center = centroInterpolado;
      camera.radius = radioInicial + (destino.altura - radioInicial) * t + Math.sin(Math.PI * t) * arco;
      camera.pitch = pitchInicial + (pitch - pitchInicial) * t;
      camera.yaw = yawInicial + deltaYaw * t;
      if (linear < 1) requestAnimationFrame(frame);
      else setEstado("3D Tiles activos");
    };
    requestAnimationFrame(frame);
  };

  const irA = (id, animado = true) => irADestino(CIUDADES[id], id, animado);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || (!CESIUM_ION_TOKEN && !TILES_ROOT_URL)) return undefined;

    // Vite conserva el canvas/contexto WebGL durante algunos hot reloads. Si
    // una versión anterior perdió el contexto, el UI sigue vivo y hasta cuenta
    // tiles, pero el framebuffer queda negro. Una única recarga por revisión
    // garantiza un contexto nuevo sin entrar en un bucle.
    const revisionKey = "tiles-world-render-revision";
    if (sessionStorage.getItem(revisionKey) !== RENDER_REVISION) {
      sessionStorage.setItem(revisionKey, RENDER_REVISION);
      window.location.reload();
      return undefined;
    }

    const recoverContext = (event) => {
      event.preventDefault();
      sessionStorage.removeItem(revisionKey);
      window.location.reload();
    };
    canvas.addEventListener("webglcontextlost", recoverContext, { once: true });
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const engine = new Engine(canvas, true, { useLargeWorldRendering: true, alpha: true });
    engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, mobile ? 2 : 2.5));
    const scene = new Scene(engine);
    // Transparente para que la capa atmosférica pueda ocupar el espacio negro
    // que queda detrás del globo y no quedar tapada por el framebuffer.
    scene.clearColor = new Color4(0, 0, 0, 0);
    scene.useRightHandedSystem = true;
    const sunLight = new DirectionalLight("tiles-sun", new Vector3(-0.35, -1, 0.25), scene);
    const ambientLight = new HemisphericLight("tiles-ambient", new Vector3(0, 1, 0), scene);
    sunLight.diffuse = new Color3(1, 0.91, 0.72);
    ambientLight.diffuse = new Color3(0.76, 0.86, 1);
    ambientLight.groundColor = new Color3(0.16, 0.2, 0.25);
    sunLight.intensity = 1.9;
    ambientLight.intensity = 0.85;

    // GeospatialCamera necesita una superficie seleccionable para calcular el
    // paneo y el zoom al cursor. Los Google 3D Tiles cambian dinámicamente y no
    // son una base estable para ese picking, por eso usamos este elipsoide WGS84
    // invisible exclusivamente como superficie de navegación.
    const navigationGlobe = MeshBuilder.CreateSphere("wgs84-navigation", {
      diameter: PLANET_RADIUS * 2,
      segments: 48,
    }, scene);
    navigationGlobe.scaling.z = WGS84_POLAR_RADIUS / PLANET_RADIUS;
    navigationGlobe.isPickable = true;
    const navigationMaterial = new StandardMaterial("wgs84-navigation-material", scene);
    navigationMaterial.disableColorWrite = true;
    navigationMaterial.disableDepthWrite = true;
    navigationMaterial.backFaceCulling = false;
    navigationGlobe.material = navigationMaterial;

    const camera = new GeospatialCamera("misiones-geospatial", scene, {
      planetRadius: PLANET_RADIUS,
      pickPredicate: (mesh) => mesh === navigationGlobe,
    });
    // Normal geodésica del elipsoide, necesaria para mantener verticales y
    // horizonte coherentes al desplazarse entre localidades.
    camera.movement.calculateUpVectorFromPointToRef = (point, result) => result
      .set(point.x / (PLANET_RADIUS * PLANET_RADIUS), point.y / (PLANET_RADIUS * PLANET_RADIUS), point.z / (WGS84_POLAR_RADIUS * WGS84_POLAR_RADIUS))
      .normalize();
    // Debajo de esta distancia la cámara puede entrar en la fotogrametría y
    // el framebuffer queda cubierto por caras interiores (pantalla negra).
    camera.limits.radiusMin = SAFE_MIN_RADIUS;
    camera.limits.radiusMax = PLANET_RADIUS * 2;
    camera.limits.pitchDisabledRadiusScale = new Vector2(0.5, 1.5);
    camera.addBehavior(new GeospatialClippingBehavior());
    // El paneo geográfico exige acertar con el raycast sobre el elipsoide. En
    // una vista urbana, edificios y cielo hacen que el arrastre izquierdo se
    // pierda con facilidad. Lo convertimos en órbita, que funciona en cualquier
    // píxel del canvas y mantiene el botón derecho con el mismo comportamiento.
    const leftDrag = camera.movement.input.getEntry("pointer", "pan", { button: 0 });
    if (leftDrag) {
      leftDrag.interaction = "rotate";
      leftDrag.sensitivity = 0.22;
    }
    const wheelZoom = camera.movement.input.getEntry("wheel", "zoom");
    if (wheelZoom) wheelZoom.sensitivity = 0.22;
    camera.attachControl(false);
    cameraRef.current = camera;
    irA("posadas", false);

    let disposed = false;
    let municipalityFeatures = [];
    const political = new GeospatialPoliticalLayer(scene);
    Promise.all([getMunicipiosGeojson(), getMundoGeojson(), getGeo("paises-labels")])
      .then(([municipios, countries, countryLabels]) => {
        if (disposed) return;
        municipalityFeatures = municipios.features || [];
        // Natural Earth completo, sin recortes ni uniones artificiales.
        political.add(countries, { level: "countries", color: POLITICAL_COLORS.provinces, altitude: 2500, stride: 2, global: true });
        political.addLabels(countryLabels, { level: "countries", altitude: 5000, width: 120000, global: true });
        political.add(municipios, { level: "municipios", color: POLITICAL_COLORS.municipios, altitude: 350 });
        political.addLabels(municipios, { level: "municipios", altitude: 900, width: 6500, color: "#ffe39a" });
        setPoliticalStatus("Límites municipales activos");
      })
      .catch((error) => setPoliticalStatus(`Límites no disponibles: ${error.message}`));

    const tiles = new TilesWorldManager({
      scene,
      rootUrl: TILES_ROOT_URL,
      cesiumIonToken: TILES_ROOT_URL ? "" : CESIUM_ION_TOKEN,
      cesiumIonAssetId: CESIUM_ION_ASSET_ID,
      onError: (error) => setEstado(`Error: ${error?.message || "no se pudieron cargar los tiles"}`),
      onUpdate: ({ visibleTiles, attributions }) => {
        const now = performance.now();
        if (now - lastUiRef.current < 500) return;
        lastUiRef.current = now;
        setVisibles(visibleTiles);
        setEstado(visibleTiles ? "3D Tiles activos" : "Cargando terreno…");
        setCreditos(attributions.map((item) => item.value).filter(Boolean).join(" · "));
      },
    });
    // La primera prueba climática vive en el horizonte, no pegada al suelo:
    // con la vista águila (75°) la cámara mira tangente a la superficie y las
    // nubes/lluvia de Posadas quedan como un frente atmosférico legible.
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    let previousFrame = performance.now();
    engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min(50, now - previousFrame);
      previousFrame = now;
      if (eagleRef.current && camera.radius <= 3000) camera.yaw += dt * 0.000045;
      limitarAlturaMinima(camera);
      const stormAmount = eagleRef.current && !stormVideoRef.current.startsWith("/sunny") ? 1 : 0;
      sunLight.intensity += (1.9 * (1 - stormAmount * 0.82) - sunLight.intensity) * 0.06;
      ambientLight.intensity += (0.85 * (1 - stormAmount * 0.55) - ambientLight.intensity) * 0.06;
      sunLight.diffuse = Color3.Lerp(sunLight.diffuse, new Color3(1, 0.91, 0.72), 0.06);
      if (stormAmount) sunLight.diffuse = Color3.Lerp(sunLight.diffuse, new Color3(0.34, 0.45, 0.6), 0.08);
      ambientLight.diffuse = Color3.Lerp(ambientLight.diffuse, stormAmount ? new Color3(0.24, 0.32, 0.43) : new Color3(0.76, 0.86, 1), 0.06);
      political.setCameraRadius(camera.radius);
      if (now - altitudeUiRef.current > 180) {
        altitudeUiRef.current = now;
        setCameraMetrics({
          altitude: alturaGeodesica(camera.position),
          radius: camera.radius,
          heading: headingDegrees(camera.yaw),
          tilt: degrees(camera.pitch),
        });
      }
      scene.render();
    });
    const stopEagle = () => {
      if (!eagleRef.current) return;
      eagleRef.current = false;
      setEagle(false);
    };
    let pointerStart = null;
    const pointerDown = (event) => {
      stopEagle();
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const pointerUp = (event) => {
      if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6) return;
      const hit = scene.pick(scene.pointerX, scene.pointerY, (mesh) => mesh === navigationGlobe);
      if (!hit?.pickedPoint) return;
      const coordinate = lonLatFromEcef(hit.pickedPoint);
      const feature = municipalityFeatures.find((item) => containsCoordinate(item, coordinate));
      if (!feature) return;
      political.selectMunicipality(feature);
      irADestino(featureDestination(feature), null, true);
    };
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointerup", pointerUp);
    return () => {
      canvas.removeEventListener("webglcontextlost", recoverContext);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointerup", pointerUp);
      disposed = true;
      flightIdRef.current += 1;
      cameraRef.current = null;
      tiles.dispose();
      political.dispose();
      scene.dispose();
      sunLight.dispose();
      ambientLight.dispose();
      engine.dispose();
    };
  }, []);

  const configurado = Boolean(CESIUM_ION_TOKEN || TILES_ROOT_URL);
  const moverAltura = (direccion) => {
    const camera = cameraRef.current;
    if (!camera) return;
    flightIdRef.current += 1;
    eagleRef.current = false;
    setEagle(false);
    const alturaInicial = alturaGeodesica(camera.position);
    const objetivo = alturaInicial + direccion * 10;
    let low = direccion < 0 ? SAFE_MIN_RADIUS : camera.radius;
    let high = direccion < 0 ? camera.radius : Math.min(camera.limits.radiusMax, camera.radius + 3000);
    for (let index = 0; index < 18; index += 1) {
      const middle = (low + high) / 2;
      camera.radius = middle;
      const altitude = alturaGeodesica(camera.position);
      if (altitude < objetivo) low = middle;
      else high = middle;
    }
    camera.radius = Math.max(SAFE_MIN_RADIUS, (low + high) / 2);
  };
  const toggleEagle = async () => {
    const next = !eagleRef.current;
    // El estado se confirma antes del vuelo: algunas versiones de
    // GeospatialCamera no resuelven flyToAsync al cambiar el pitch y dejaban
    // el botón eternamente en "iniciar".
    eagleRef.current = next;
    setEagle(next);
    if (next && cameraRef.current) {
      const camera = cameraRef.current;
      const flightId = ++flightIdRef.current;
      const pitchInicial = camera.pitch;
      const inicio = performance.now();
      const duracion = 1100;
      const inclinar = (now) => {
        if (flightId !== flightIdRef.current || cameraRef.current !== camera) return;
        const linear = Math.min(1, (now - inicio) / duracion);
        const t = linear * linear * (3 - 2 * linear);
        camera.pitch = pitchInicial + (EAGLE_PITCH - pitchInicial) * t;
        if (linear < 1) requestAnimationFrame(inclinar);
        else camera.pitch = EAGLE_PITCH;
      };
      requestAnimationFrame(inclinar);
      const radioInicial = camera.radius;
      const volar = (now) => {
        if (flightId !== flightIdRef.current || cameraRef.current !== camera || !eagleRef.current) return;
        const linear = Math.min(1, (now - inicio) / duracion);
        const t = linear * linear * (3 - 2 * linear);
        camera.radius = radioInicial + (EAGLE_RADIUS - radioInicial) * t;
        if (linear < 1) requestAnimationFrame(volar);
      };
      requestAnimationFrame(volar);
    }
  };
  return <main className="tiles-world">
    <canvas ref={canvasRef} className="tiles-world__canvas" aria-label="Mundo 3D real de Posadas y Oberá" />
    <video key={stormVideo} className={`tiles-world__storm-video ${eagle ? "is-visible" : ""}`} src={stormVideo} autoPlay loop muted playsInline aria-hidden="true" />
    <section className="tiles-world__panel">
      <span className="tiles-world__eyebrow">Prueba geoespacial · Babylon.js</span>
      <h1>{locationName} en 3D</h1>
      <div className="tiles-world__actions">
        {Object.entries(CIUDADES).map(([id, item]) => <button key={id} className={id === ciudad ? "is-active" : ""} onClick={() => irA(id)}>{item.nombre}</button>)}
      </div>
      <button className="tiles-world__center" onClick={() => irADestino(VISTA_MISIONES, null, true)}>Centrar en Misiones</button>
      <button className={`tiles-world__eagle ${eagle ? "is-active" : ""}`} onClick={toggleEagle}>{eagle ? "Detener vuelo de águila" : "Iniciar vuelo de águila"}</button>
      <label className="tiles-world__storm-select">Video del horizonte
        <select value={stormVideo} onChange={(event) => { stormVideoRef.current = event.target.value; setStormVideo(event.target.value); }}>
          {TORMENTAS.map((tormenta) => <option key={tormenta.src} value={tormenta.src}>{tormenta.nombre}</option>)}
        </select>
      </label>
      <p className="tiles-world__status"><span className={visibles ? "is-online" : ""} />{estado}{visibles ? ` · ${visibles} tiles visibles` : ""}</p>
      <p className="tiles-world__political-status">{politicalStatus}</p>
      {!configurado && <div className="tiles-world__setup">Agregá <code>VITE_CESIUM_ION_TOKEN</code> a <code>mapa-frontend/.env.local</code> y reiniciá Vite. La cuenta/token debe tener acceso al asset {CESIUM_ION_ASSET_ID}.</div>}
      <small>Arrastrar: girar · rueda: acercar hasta la altura urbana segura</small>
    </section>
    {creditos && <div className="tiles-world__credits">{creditos}</div>}
    <div className="tiles-world__altimeter" aria-live="polite">
      <span>Altura cámara</span><strong>{formatMeters(cameraMetrics.altitude)}</strong>
      <span>Distancia al foco</span><strong>{formatMeters(cameraMetrics.radius)}</strong>
      <div className="tiles-world__altitude-controls">
        <button onClick={() => moverAltura(1)} title="Subir cámara 10 metros" aria-label="Subir cámara 10 metros">▲ +10 m</button>
        <button onClick={() => moverAltura(-1)} title="Bajar cámara 10 metros" aria-label="Bajar cámara 10 metros">▼ −10 m</button>
      </div>
    </div>
    <div className="tiles-world__instruments" aria-label="Brújula y nivel de cámara">
      <div className="tiles-world__compass">
        <span className="tiles-world__north">N</span>
        <span className="tiles-world__east">E</span>
        <span className="tiles-world__south">S</span>
        <span className="tiles-world__west">O</span>
        <i style={{ transform: `translateX(-50%) rotate(${cameraMetrics.heading}deg)` }} />
      </div>
      <div className="tiles-world__instrument-values">
        <span>Rumbo</span><strong>{cameraMetrics.heading.toFixed(1)}°</strong>
        <span>Inclinación</span><strong>{cameraMetrics.tilt.toFixed(1)}°</strong>
        <div className="tiles-world__level"><i style={{ left: `${Math.max(0, Math.min(100, cameraMetrics.tilt / 90 * 100))}%` }} /></div>
        <small>0° cenital · 90° horizonte</small>
      </div>
    </div>
  </main>;
}
