const path = require("path");
const fs = require("fs");
const { createCanvas, loadImage, registerFont } = require("canvas");

const coordinates = require("../config/coordinates");
const { proyectar } = require("../config/projection");
const { formatoFecha } = require("./dateUtils");
const { resolveIconPath } = require("./iconResolver");
const { armarMunicipiosConPronostico } = require("./municipios");
const { colorPorCondicion } = require("./condiciones");

const COLOR_TEXT = "#21130d"; // (33,19,13)
const COLOR_TMIN = "#063970"; // (6,57,112)
const COLOR_TMAX = "#872338"; // (135,35,56)

const MATERIALES_DIR = path.join(__dirname, "..", "..", "data", "materiales");
const MUNICIPIOS_GEOJSON_PATH = path.join(__dirname, "..", "..", "data", "municipios.geojson");

// Municipio "interior" usado como semilla del relleno por flood-fill que
// detecta la silueta de la provincia en basemap.png (ver pintarMunicipios).
const SEMILLA_LAT = -27.452;
const SEMILLA_LNG = -55.118; // Oberá — céntrico, lejos de cualquier borde.

let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const candidates = [
    { file: "FiraSans-SemiBold.ttf", family: "FiraSans-SemiBold" },
    { file: "FiraSans-Regular.ttf", family: "FiraSans-Regular" },
    { file: "FiraSans-Bold.ttf", family: "FiraSans-Bold" },
  ];
  for (const { file, family } of candidates) {
    const fontPath = path.join(MATERIALES_DIR, "fonts", file);
    if (fs.existsSync(fontPath)) {
      registerFont(fontPath, { family });
    } else {
      console.warn(
        `[generateMap] No se encontró ${file} en data/materiales/fonts — se usa una fuente genérica de reemplazo.`
      );
    }
  }
}

function fontStack(preferredFamily, size, fallback = "sans-serif") {
  const fileFor = {
    "FiraSans-Bold": "FiraSans-Bold.ttf",
    "FiraSans-SemiBold": "FiraSans-SemiBold.ttf",
    "FiraSans-Regular": "FiraSans-Regular.ttf",
  };
  const fontPath = path.join(MATERIALES_DIR, "fonts", fileFor[preferredFamily]);
  const family = fs.existsSync(fontPath) ? preferredFamily : fallback;
  const weight = preferredFamily === "FiraSans-Regular" ? "normal" : "bold";
  return `${weight} ${size}px "${family}"`;
}

function areaInterseccion(a, b) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
}

function ubicarTarjeta(anchorX, anchorY, ocupadas, reservadas, w, h, margen, canvasW, canvasH, d) {
  const candidatos = [
    { x: anchorX + d, y: anchorY - h / 2 },
    { x: anchorX - w - d, y: anchorY - h / 2 },
    { x: anchorX - w / 2, y: anchorY - h - d },
    { x: anchorX - w / 2, y: anchorY + d },
    { x: anchorX + d, y: anchorY - h - d },
    { x: anchorX - w - d, y: anchorY - h - d },
    { x: anchorX + d, y: anchorY + d },
    { x: anchorX - w - d, y: anchorY + d },
  ];
  let mejor = null;
  let mejorCosto = Infinity;
  for (const c of candidatos) {
    const box = { x: Math.round(c.x), y: Math.round(c.y), w, h };
    let costo = 0;
    if (box.x < margen) costo += (margen - box.x) * 10000;
    if (box.y < margen) costo += (margen - box.y) * 10000;
    if (box.x + w > canvasW - margen) costo += (box.x + w - (canvasW - margen)) * 10000;
    if (box.y + h > canvasH - margen) costo += (box.y + h - (canvasH - margen)) * 10000;
    for (const o of ocupadas) costo += areaInterseccion(box, o) * 200;
    for (const r of reservadas) costo += areaInterseccion(box, r) * 300;
    // Favorece una guía corta cuando dos opciones son igualmente válidas.
    costo += Math.hypot(box.x + w / 2 - anchorX, box.y + h / 2 - anchorY);
    if (costo < mejorCosto) {
      mejorCosto = costo;
      mejor = box;
    }
  }
  return mejor;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Traza el contorno de un Polygon/MultiPolygon de GeoJSON (coordenadas
 * [lng, lat]) como un path de canvas, proyectando cada vértice a píxel.
 * "evenodd" para que los anillos siguientes a la primera se recorten como
 * agujeros, que es la convención de GeoJSON.
 */
function trazarGeometria(ctx, geometry) {
  const poligonos = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
  ctx.beginPath();
  for (const anillos of poligonos) {
    for (const anillo of anillos) {
      anillo.forEach(([lng, lat], i) => {
        const { x, y } = proyectar(lat, lng);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
  }
}

/**
 * Detecta por flood-fill la silueta de la provincia impresa en basemap.png
 * (relleno de color uniforme) a partir de un punto semilla interior.
 * Devuelve una máscara (1 = adentro de la silueta) del tamaño del canvas,
 * usada para recortar el color de los municipios exactamente a la forma
 * dibujada, sin importar cuánto se pasen sus polígonos reales (de
 * Ordenamiento Territorial) del borde ilustrado.
 */
function detectarSiluetaProvincia(ctx, width, height, seedX, seedY) {
  const { data } = ctx.getImageData(0, 0, width, height);
  const mascara = new Uint8Array(width * height);
  const sx = Math.round(seedX);
  const sy = Math.round(seedY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return mascara;

  const i0 = (sy * width + sx) * 4;
  const objetivo = [data[i0], data[i0 + 1], data[i0 + 2]];
  const TOL = 30;
  const coincide = (x, y) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 200) return false;
    return (
      Math.abs(data[i] - objetivo[0]) <= TOL &&
      Math.abs(data[i + 1] - objetivo[1]) <= TOL &&
      Math.abs(data[i + 2] - objetivo[2]) <= TOL
    );
  };

  const visitado = new Uint8Array(width * height);
  const pila = [[sx, sy]];
  visitado[sy * width + sx] = 1;
  while (pila.length) {
    const [x, y] = pila.pop();
    if (!coincide(x, y)) continue;
    mascara[y * width + x] = 1;
    const vecinos = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of vecinos) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const idx = ny * width + nx;
      if (visitado[idx]) continue;
      visitado[idx] = 1;
      pila.push([nx, ny]);
    }
  }
  return mascara;
}

/**
 * Pinta cada municipio con el color de su condición climática (mismo
 * criterio que colorPorCondicion() del mapa interactivo), recortado a la
 * silueta de la provincia dibujada en basemap.png. Se dibuja en un canvas
 * aparte y se compone semitransparente sobre el mapa, como hace el mapa
 * interactivo con sus polígonos (fill-opacity 0.78).
 */
function pintarMunicipios(ctx, width, height, forecastRows, scale) {
  const geojson = JSON.parse(fs.readFileSync(MUNICIPIOS_GEOJSON_PATH, "utf-8"));
  const municipios = armarMunicipiosConPronostico(forecastRows);
  const porId = new Map(municipios.map((m) => [m.id, m]));

  const capa = createCanvas(width, height);
  const cctx = capa.getContext("2d");
  cctx.lineJoin = "round";
  for (const feature of geojson.features) {
    const municipio = porId.get(feature.properties.id);
    trazarGeometria(cctx, feature.geometry);
    cctx.fillStyle = colorPorCondicion(municipio?.pronostico?.CONDICION);
    cctx.fill("evenodd");
    cctx.strokeStyle = "rgba(52,83,69,0.55)";
    cctx.lineWidth = Math.max(1, scale);
    cctx.stroke();
  }

  const seed = proyectar(SEMILLA_LAT, SEMILLA_LNG);
  const mascara = detectarSiluetaProvincia(ctx, width, height, seed.x, seed.y);

  const capaData = cctx.getImageData(0, 0, width, height);
  for (let p = 0; p < mascara.length; p++) {
    if (!mascara[p]) capaData.data[p * 4 + 3] = 0;
  }
  cctx.putImageData(capaData, 0, 0);

  ctx.save();
  ctx.globalAlpha = 0.78;
  ctx.drawImage(capa, 0, 0);
  ctx.restore();
}

/**
 * Genera el PNG del mapa de pronóstico para redes (mismo tamaño que
 * basemap.png). Las tarjetas/fuentes escalan en proporción al ancho de la
 * imagen — se calibraron a mano para un diseño de 1280px de ancho, DESIGN_W
 * lo mantiene proporcional si basemap.png cambia de tamaño.
 *
 * @param {Array} forecastRows - [{LOCALIDAD, TMIN, TMAX, CONDICION}, ...]
 * @param {string} outputPath
 * @param {Date} [date] - fecha usada para el título (default: ahora)
 */
async function generateForecastMap({ forecastRows, outputPath, date = new Date() }) {
  ensureFonts();

  const baseImage = await loadImage(path.join(MATERIALES_DIR, "basemap.png"));
  const canvas = createCanvas(baseImage.width, baseImage.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(baseImage, 0, 0);
  ctx.textBaseline = "top";

  const DESIGN_W = 1280;
  const scale = baseImage.width / DESIGN_W;

  pintarMunicipios(ctx, baseImage.width, baseImage.height, forecastRows, scale);

  ctx.fillStyle = COLOR_TEXT;
  ctx.font = fontStack("FiraSans-SemiBold", 42 * scale);
  ctx.fillText(formatoFecha(date), 125 * scale, 290 * scale);

  const byLocalidad = new Map(
    forecastRows.map((r) => [r.LOCALIDAD.trim().toUpperCase(), r])
  );

  const imgsDir = path.join(MATERIALES_DIR, "imgs");

  const elementos = await Promise.all(coordinates.map(async (coord) => {
    const row = byLocalidad.get(coord.LOCALIDAD.trim().toUpperCase());
    if (!row) {
      console.warn(`[generateMap] Sin datos de pronóstico para "${coord.LOCALIDAD}"`);
      return null;
    }
    const iconPath = resolveIconPath(imgsDir, row.CONDICION);
    if (!iconPath) {
      console.warn(
        `[generateMap] Ícono no encontrado para condición "${row.CONDICION}"`
      );
    }
    return { coord, row, icon: iconPath ? await loadImage(iconPath) : null };
  }));

  const CARD_W = 226 * scale;
  const CARD_H = 72 * scale;
  const MARGEN = 22 * scale;
  const GAP = 18 * scale;
  const ocupadas = [];
  // Zonas del basemap con arte/texto fijo (título+fecha, "en caso de
  // incendios", franja del pie) donde no puede caer una tarjeta.
  const reservadas = [
    { x: 60, y: 55, w: 1180 * scale, h: 300 * scale },
    { x: 1380 * scale, y: 2380 * scale, w: 750 * scale, h: 180 * scale },
    { x: 0, y: 2600 * scale, w: baseImage.width, h: baseImage.height - 2600 * scale },
  ];

  for (const item of elementos.filter(Boolean)) {
    const { coord, row, icon } = item;
    const box = ubicarTarjeta(
      coord.anchorX,
      coord.anchorY,
      ocupadas,
      reservadas,
      CARD_W,
      CARD_H,
      MARGEN,
      baseImage.width,
      baseImage.height,
      GAP
    );
    ocupadas.push(box);

    const px = Math.max(box.x, Math.min(coord.anchorX, box.x + box.w));
    const py = Math.max(box.y, Math.min(coord.anchorY, box.y + box.h));
    ctx.strokeStyle = "rgba(66,74,70,0.7)";
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(coord.anchorX, coord.anchorY);
    ctx.lineTo(px, py);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.91)";
    ctx.strokeStyle = "rgba(74,91,83,0.42)";
    ctx.lineWidth = 1.5 * scale;
    roundedRect(ctx, box.x, box.y, box.w, box.h, 12 * scale);
    ctx.fill();
    ctx.stroke();

    if (icon) {
      const tam = 62 * scale;
      const escala = Math.min(tam / icon.width, tam / icon.height);
      const iw = icon.width * escala;
      const ih = icon.height * escala;
      ctx.drawImage(
        icon,
        box.x + 6 * scale + (58 * scale - iw) / 2,
        box.y + 7 * scale + (58 * scale - ih) / 2,
        iw,
        ih
      );
    }

    const tx = box.x + 70 * scale;
    let nombreSize = 17 * scale;
    do {
      ctx.font = fontStack("FiraSans-SemiBold", nombreSize);
      if (ctx.measureText(row.LOCALIDAD).width <= 146 * scale || nombreSize <= 13 * scale) break;
      nombreSize -= scale;
    } while (nombreSize > 12 * scale);
    ctx.fillStyle = COLOR_TEXT;
    ctx.fillText(row.LOCALIDAD, tx, box.y + 10 * scale);

    ctx.font = fontStack("FiraSans-Bold", 25 * scale);
    ctx.fillStyle = COLOR_TMIN;
    ctx.fillText(`${row.TMIN}°`, tx, box.y + 37 * scale);
    ctx.fillStyle = "#8b8f8c";
    ctx.fillRect(tx + 54 * scale, box.y + 40 * scale, 1.5 * scale, 23 * scale);
    ctx.fillStyle = COLOR_TMAX;
    ctx.fillText(`${row.TMAX}°`, tx + 68 * scale, box.y + 37 * scale);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
  return outputPath;
}

module.exports = { generateForecastMap, MATERIALES_DIR };
