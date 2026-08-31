import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";

export const GEO_ORIGIN = { lng: -54.8, lat: -27.05 };
export const GEO_SCALE = 110;

export function geoToWorld(lng, lat, y = 0) {
  return new Vector3((lng - GEO_ORIGIN.lng) * GEO_SCALE, y, -(lat - GEO_ORIGIN.lat) * GEO_SCALE);
}

export function ringToWorld(ring) {
  return ring.slice(0, -1).map(([lng, lat]) => {
    const p = geoToWorld(lng, lat);
    return new Vector2(p.x, p.z);
  });
}

export function featureRings(feature) {
  const polygons = feature.geometry?.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry?.coordinates || [];
  return polygons.map((p) => ({ outer: ringToWorld(p[0]), holes: p.slice(1).map(ringToWorld) }));
}

export function featureCenter(feature) {
  const ring = feature.geometry?.type === "Polygon" ? feature.geometry.coordinates[0] : feature.geometry.coordinates[0][0];
  let lng = 0; let lat = 0; let n = 0;
  for (const point of ring) { lng += point[0]; lat += point[1]; n++; }
  return geoToWorld(lng / n, lat / n);
}
