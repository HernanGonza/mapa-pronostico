/**
 * Adaptador opcional para 3D Tiles dentro de Babylon.
 *
 * El mapa político de producción sigue siendo BaseMap/MapLibre. Esta clase sólo
 * se activa cuando se configura un tileset real (Cesium ion, Google o un
 * servidor propio), evitando reemplazar el globo ni fabricar cobertura.
 */
import { TilesRenderer } from "3d-tiles-renderer/babylonjs";
import { CesiumIonAuthPlugin } from "3d-tiles-renderer/core/plugins";

export class TilesWorldManager {
  constructor({ scene, rootUrl, cesiumIonToken, cesiumIonAssetId, onError, onUpdate } = {}) {
    this.scene = scene;
    this.rootUrl = rootUrl?.trim() || "";
    this.onError = onError;
    this.tiles = null;
    this.handleUpdate = null;

    if (!scene || (!this.rootUrl && !cesiumIonToken)) return;

    // 3d-tiles-renderer requiere coordenadas de mano derecha.
    scene.useRightHandedSystem = true;
    try {
      this.tiles = new TilesRenderer(this.rootUrl, scene);
      if (cesiumIonToken) {
        this.tiles.registerPlugin(new CesiumIonAuthPlugin({
          apiToken: cesiumIonToken,
          assetId: String(cesiumIonAssetId || "2275207"),
          autoRefreshToken: true,
        }));
      }
      this.tiles.addEventListener("load-error", (event) => {
        this.onError?.(event.error || new Error(`No se pudo cargar 3D Tiles: ${event.url || this.rootUrl}`));
      });
      const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      this.tiles.errorTarget = mobile ? 28 : 16;
      // Mantener los padres visibles evita el cuadro vacío mientras llegan los
      // hijos de mayor detalle al acercarse rápidamente al nivel urbano.
      this.tiles.displayActiveTiles = true;
      this.tiles.loadAncestors = true;
      {
        const MB = 1024 * 1024;
        this.tiles.lruCache.maxBytesSize = (mobile ? 150 : 280) * MB;
        this.tiles.lruCache.minBytesSize = (mobile ? 100 : 190) * MB;
      }
      if (mobile) {
        this.tiles.lruCache.maxSize = 1500;
        this.tiles.lruCache.minSize = 1000;
        this.tiles.downloadQueue.maxJobs = 6;
        this.tiles.parseQueue.maxJobs = 2;
      }
      this.handleUpdate = () => {
        // Cerca del suelo, pedir un error demasiado fino dispara cientos de
        // texturas simultáneas y puede perder el contexto WebGL. Una calidad
        // algo más conservadora mantiene la escena continua y navegable.
        const radius = scene.activeCamera?.radius;
        this.tiles.errorTarget = radius < 2500 ? (mobile ? 36 : 24) : (mobile ? 28 : 16);
        this.tiles?.update();
        onUpdate?.({
          visibleTiles: this.tiles?.visibleTiles?.size || 0,
          attributions: this.tiles?.getAttributions?.() || [],
        });
      };
      scene.onBeforeRenderObservable.add(this.handleUpdate);
      // Con URL propia se inicia explícitamente. El plugin de Cesium ion
      // resuelve sus credenciales y raíz al registrarse.
      if (this.rootUrl) {
        this.tiles.loadRootTileset().catch((error) => this.onError?.(error));
      }
    } catch (error) {
      this.onError?.(error);
      this.dispose();
    }
  }

  get enabled() { return Boolean(this.tiles); }

  dispose() {
    if (this.handleUpdate && this.scene) {
      this.scene.onBeforeRenderObservable.removeCallback(this.handleUpdate);
    }
    this.tiles?.dispose();
    this.tiles = null;
    this.handleUpdate = null;
  }
}

export default TilesWorldManager;
