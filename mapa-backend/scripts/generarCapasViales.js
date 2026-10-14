/**
 * Genera las capas viales del módulo Inundaciones (data/rutas-misiones.geojson, puentes-misiones.geojson y
 * puntos-criticos-dpv.geojson) desde el SIG de la Dirección Provincial de Vialidad (https://sigvial.dpvmisiones.gob.ar,
 * GeoNode + GeoServer, capas públicas). Se corre a mano cuando Vialidad actualice sus capas:
 *   node scripts/generarCapasViales.js
 * Usa curl porque es lo que respeta el proxy / la red de la oficina.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const BASE = "https://sigvial.dpvmisiones.gob.ar/geoserver/ows";
const DATA = path.join(__dirname, "..", "data");

function pedir(query) {
  for (let intento = 1; ; intento++) {
    try {
      const out = execFileSync("curl", ["-sS", "-f", "-m", "120", "-A", "Mozilla/5.0 (ministerio-ecologia)", `${BASE}?${query}`], { maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      return JSON.parse(out.toString("utf8"));
    } catch (e) {
      if (intento >= 4) throw e;
      execFileSync("sleep", ["10"]);
    }
  }
}
const wfs = (capa) => pedir(`service=WFS&version=2.0.0&request=GetFeature&typeNames=geonode:${capa}&outputFormat=application/json&srsName=EPSG:4326`).features;

const r5 = (n) => Math.round(n * 1e5) / 1e5;
const redondear = (c) => (typeof c[0] === "number" ? [r5(c[0]), r5(c[1])] : c.map(redondear));
const limpio = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// RP2, "RP 23 Bis", RC, 0012 → "RP 2", "RP 23 Bis", "Ruta Costera", "RN 12"
function nombreRuta(ref) {
  const r = limpio(ref);
  if (/^\d+$/.test(r)) return `RN ${Number(r)}`;
  if (r === "RC") return "Ruta Costera";
  return r.replace(/^(RP|RN)\s*/i, "$1 ");
}

const lineas = [];
for (const [capa, tipo] of [["red_primaria_provincial", "provincial"], ["red_secundaria_provincial", "provincial"], ["red_vial_nacional", "nacional"]]) {
  for (const f of wfs(capa)) {
    const ref = f.properties.ref || f.properties.cod_ruta;
    if (!f.geometry || !ref) continue;
    lineas.push({ type: "Feature", properties: { nombre: nombreRuta(ref), tipo, superficie: f.properties.surface || "" }, geometry: { type: f.geometry.type, coordinates: redondear(f.geometry.coordinates) } });
  }
}

const puentes = wfs("puentes_2023").filter((f) => f.geometry).map((f) => {
  const p = f.properties;
  const [rutaTxt, ...resto] = limpio(p.name || p.alt_name).split(" - ");
  const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  return { type: "Feature", properties: { nombre: resto.join(" - ") || limpio(p.name), ruta: nombreRuta(String(p.ref || rutaTxt).split(";")[0]),
    largo: num(p.largo), tramos: num(p.tramos), altura: num(p.altura) }, geometry: { type: "Point", coordinates: redondear(f.geometry.coordinates) } };
});

// «Puntos de Estudio Emergencia 2026»: la capa sólo permite ver (no bajar) → se lee por GetFeatureInfo con un buffer que cubre la provincia.
const criticos = pedir("service=WMS&version=1.1.1&request=GetFeatureInfo&layers=geonode:puntos_criticos_emergencia_2026&query_layers=geonode:puntos_criticos_emergencia_2026&info_format=application/json&srs=EPSG:4326&bbox=-56.1,-28.2,-53.6,-25.4&width=101&height=101&x=50&y=50&feature_count=5000&buffer=200").features
  .filter((f) => f.geometry && f.geometry.type === "Point")
  .map((f) => ({ type: "Feature", properties: { nombre: limpio(f.properties.name), nota: limpio(f.properties.descripcion) }, geometry: { type: "Point", coordinates: redondear(f.geometry.coordinates) } }));

const fc = (features) => JSON.stringify({ type: "FeatureCollection", features });
fs.writeFileSync(path.join(DATA, "rutas-misiones.geojson"), fc(lineas));
fs.writeFileSync(path.join(DATA, "puentes-misiones.geojson"), fc(puentes));
fs.writeFileSync(path.join(DATA, "puntos-criticos-dpv.geojson"), fc(criticos));
console.log(`rutas: ${lineas.length} tramos · puentes: ${puentes.length} · puntos críticos: ${criticos.length}`);
