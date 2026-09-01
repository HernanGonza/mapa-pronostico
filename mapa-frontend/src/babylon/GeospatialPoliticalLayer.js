import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;
const REGION = { west: -62.5, east: -48, south: -36, north: -19 };

function inRegion([lon, lat]) {
  return lon >= REGION.west && lon <= REGION.east && lat >= REGION.south && lat <= REGION.north;
}

function ecef([lon, lat], altura) {
  const phi = lat * Math.PI / 180;
  const lambda = lon * Math.PI / 180;
  const sinPhi = Math.sin(phi);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  return new Vector3(
    (n + altura) * Math.cos(phi) * Math.cos(lambda),
    (n + altura) * Math.cos(phi) * Math.sin(lambda),
    (n * (1 - WGS84_E2) + altura) * sinPhi,
  );
}

function rings(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function visibleSegments(ring, stride) {
  const segments = [];
  let current = [];
  ring.forEach((coordinate, index) => {
    if (inRegion(coordinate)) {
      if (index % stride === 0 || current.length === 0) current.push(coordinate);
    } else if (current.length) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
  });
  if (current.length > 1) segments.push(current);
  return segments;
}

function completeRing(ring, stride) {
  const sampled = ring.filter((_, index) => index % stride === 0);
  if (ring.length && sampled.at(-1) !== ring.at(-1)) sampled.push(ring.at(-1));
  return sampled.length > 1 ? [sampled] : [];
}

function featurePoint(feature) {
  if (feature.geometry?.type === "Point") return feature.geometry.coordinates;
  const coordinates = rings(feature).flat();
  if (!coordinates.length) return null;
  let west = Infinity; let east = -Infinity; let south = Infinity; let north = -Infinity;
  for (const [lon, lat] of coordinates) {
    west = Math.min(west, lon); east = Math.max(east, lon);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return [(west + east) / 2, (south + north) / 2];
}

export class GeospatialPoliticalLayer {
  constructor(scene) {
    this.scene = scene;
    this.groups = { countries: [], provinces: [], municipios: [] };
    this.labels = { countries: [], provinces: [], municipios: [] };
  }

  add(geojson, { level, color, altitude, stride = 1, global = false }) {
    const meshes = this.groups[level];
    if (!meshes) return;
    for (const feature of geojson?.features || []) {
      for (const ring of rings(feature)) {
        if (ring.length < 2 || (!global && !ring.some(inRegion))) continue;
        const segments = global ? completeRing(ring, stride) : visibleSegments(ring, stride);
        for (const segment of segments) {
          const line = MeshBuilder.CreateLines(`geo-${level}-${meshes.length}`, {
            points: segment.map((coordinate) => ecef(coordinate, altitude)),
          }, this.scene);
          line.color = color;
          line.alpha = level === "municipios" ? 0.92 : 0.48;
          line.isPickable = false;
          line.renderingGroupId = 3;
          line.metadata = {
            featureId: feature.properties?.id,
            featureName: feature.properties?.nombre || feature.properties?.name,
            baseColor: color.clone(),
          };
          meshes.push(line);
        }
      }
    }
  }

  selectMunicipality(feature) {
    const id = feature?.properties?.id;
    const name = feature?.properties?.nombre || feature?.properties?.name;
    for (const line of this.groups.municipios) {
      const selected = (id != null && String(line.metadata?.featureId) === String(id)) || (name && line.metadata?.featureName === name);
      line.color = selected ? Color3.White() : line.metadata.baseColor;
      line.alpha = selected ? 1 : 0.72;
    }
  }

  addLabels(geojson, { level, altitude, width, color = "#f1f5ed", global = false }) {
    const labels = this.labels[level];
    if (!labels) return;
    for (const feature of geojson?.features || []) {
      const point = featurePoint(feature);
      const name = feature.properties?.nombre || feature.properties?.name;
      if (!point || !name || (!global && !inRegion(point))) continue;
      const texture = new DynamicTexture(`geo-label-${level}-${labels.length}`, { width: 512, height: 96 }, this.scene, false);
      texture.hasAlpha = true;
      texture.drawText(String(name).toUpperCase(), null, 62, "600 34px Arial", color, "transparent", true, true);
      const material = new StandardMaterial(`geo-label-material-${level}-${labels.length}`, this.scene);
      material.diffuseTexture = texture;
      material.opacityTexture = texture;
      material.emissiveColor = Color3.White();
      material.disableLighting = true;
      material.backFaceCulling = false;
      const plane = MeshBuilder.CreatePlane(`geo-label-plane-${level}-${labels.length}`, { width, height: width * 0.18 }, this.scene);
      plane.position = ecef(point, altitude);
      plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
      plane.material = material;
      plane.isPickable = false;
      plane.renderingGroupId = 3;
      labels.push(plane);
    }
  }

  setCameraRadius(radius) {
    // A nivel urbano las líneas no conocen la altura de cada edificio. Se
    // apagan antes de que parezcan suspendidas sobre la fotogrametría.
    const showCountries = radius > 350000;
    const showRegional = radius > 9000;
    const showMunicipios = radius > 1800;
    for (const mesh of this.groups.countries) mesh.setEnabled(showCountries);
    for (const mesh of this.groups.provinces) mesh.setEnabled(showRegional);
    for (const mesh of this.groups.municipios) mesh.setEnabled(showMunicipios);
    for (const mesh of this.labels.countries) mesh.setEnabled(radius > 500000);
    for (const mesh of this.labels.provinces) mesh.setEnabled(radius > 35000);
    // Los nombres municipales acompañan toda la navegación local/provincial.
    // Recién se retiran en escala continental para evitar 79 rótulos sobre el mundo.
    for (const mesh of this.labels.municipios) mesh.setEnabled(radius < 500000);
  }

  dispose() {
    for (const meshes of Object.values(this.groups)) {
      for (const mesh of meshes) mesh.dispose();
      meshes.length = 0;
    }
    for (const labels of Object.values(this.labels)) {
      for (const label of labels) label.dispose(false, true);
      labels.length = 0;
    }
  }
}

export const POLITICAL_COLORS = {
  countries: new Color3(0.92, 0.96, 0.91),
  provinces: new Color3(0.55, 0.72, 0.62),
  municipios: new Color3(1, 0.82, 0.38),
};
