// Configurable vía variable de entorno de Vite (.env / .env.production):
// VITE_API_URL=https://api.tudominio.gob.ar
const configurada = import.meta.env.VITE_API_URL;
// En desarrollo, el backend local escucha en 3000. Evitamos que el valor de
// producción de Render desvíe los requests cuando se ejecuta Vite localmente.
export const API_URL = import.meta.env.DEV
  ? (configurada && !/onrender\.com/i.test(configurada) ? configurada : "http://localhost:3000")
  : (configurada || "http://localhost:3000");

// 3D Tiles es opt-in: sin estas variables el globo MapLibre continúa siendo
// la fuente de verdad y no se realizan requests externos ni se inventa relieve.
export const TILES_ROOT_URL = String(import.meta.env.VITE_3D_TILES_ROOT_URL || "").trim();
export const CESIUM_ION_TOKEN = String(import.meta.env.VITE_CESIUM_ION_TOKEN || "").trim();
// Asset oficial de Google Photorealistic 3D Tiles publicado en Cesium ion.
export const CESIUM_ION_ASSET_ID = String(import.meta.env.VITE_CESIUM_ION_ASSET_ID || "2275207").trim();
// Video opcional para el frente de tormenta en el horizonte.
export const HORIZON_STORM_VIDEO_URL = String(import.meta.env.VITE_HORIZON_STORM_VIDEO_URL || "").trim();
