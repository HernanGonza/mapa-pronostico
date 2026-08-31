const path = require("path");
const fs = require("fs");
const { createCanvas, loadImage, registerFont } = require("canvas");

const coordinates = require("../config/coordinates");
const { formatoFecha } = require("./dateUtils");
const { resolveIconPath } = require("./iconResolver");

const COLOR_TEXT = "#21130d"; // (33,19,13)
const COLOR_TMIN = "#063970"; // (6,57,112)
const COLOR_TMAX = "#872338"; // (135,35,56)

const MATERIALES_DIR = path.join(__dirname, "..", "..", "data", "materiales");

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

function ubicarTarjeta(anchorX, anchorY, ocupadas, reservadas, w, h) {
  const d = 18;
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
    if (box.x < 22) costo += (22 - box.x) * 10000;
    if (box.y < 16) costo += (16 - box.y) * 10000;
    if (box.x + w > 1258) costo += (box.x + w - 1258) * 10000;
    if (box.y + h > 1122) costo += (box.y + h - 1122) * 10000;
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
 * Genera el PNG cuadrado del mapa de pronóstico (pensado para redes /
 * Instagram, 1280x1280 como el basemap original).
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

  ctx.fillStyle = COLOR_TEXT;
  ctx.font = fontStack("FiraSans-SemiBold", 42);
  ctx.fillText(formatoFecha(date), 125, 290);

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

  const CARD_W = 226;
  const CARD_H = 72;
  const ocupadas = [];
  const reservadas = [
    { x: 60, y: 55, w: 510, h: 105 },
    { x: 80, y: 260, w: 590, h: 105 },
    { x: 820, y: 995, w: 430, h: 105 },
  ];

  for (const item of elementos.filter(Boolean)) {
    const { coord, row, icon } = item;
    const box = ubicarTarjeta(
      coord.anchorX,
      coord.anchorY,
      ocupadas,
      reservadas,
      CARD_W,
      CARD_H
    );
    ocupadas.push(box);

    const px = Math.max(box.x, Math.min(coord.anchorX, box.x + box.w));
    const py = Math.max(box.y, Math.min(coord.anchorY, box.y + box.h));
    ctx.strokeStyle = "rgba(66,74,70,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(coord.anchorX, coord.anchorY);
    ctx.lineTo(px, py);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.91)";
    ctx.strokeStyle = "rgba(74,91,83,0.42)";
    ctx.lineWidth = 1.5;
    roundedRect(ctx, box.x, box.y, box.w, box.h, 12);
    ctx.fill();
    ctx.stroke();

    if (icon) {
      const escala = Math.min(62 / icon.width, 62 / icon.height);
      const iw = icon.width * escala;
      const ih = icon.height * escala;
      ctx.drawImage(icon, box.x + 6 + (58 - iw) / 2, box.y + 7 + (58 - ih) / 2, iw, ih);
    }

    const tx = box.x + 70;
    let nombreSize = 17;
    do {
      ctx.font = fontStack("FiraSans-SemiBold", nombreSize);
      if (ctx.measureText(row.LOCALIDAD).width <= 146 || nombreSize <= 13) break;
      nombreSize -= 1;
    } while (nombreSize > 12);
    ctx.fillStyle = COLOR_TEXT;
    ctx.fillText(row.LOCALIDAD, tx, box.y + 10);

    ctx.font = fontStack("FiraSans-Bold", 25);
    ctx.fillStyle = COLOR_TMIN;
    ctx.fillText(`${row.TMIN}°`, tx, box.y + 37);
    ctx.fillStyle = "#8b8f8c";
    ctx.fillRect(tx + 54, box.y + 40, 1.5, 23);
    ctx.fillStyle = COLOR_TMAX;
    ctx.fillText(`${row.TMAX}°`, tx + 68, box.y + 37);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
  return outputPath;
}

module.exports = { generateForecastMap, MATERIALES_DIR };
