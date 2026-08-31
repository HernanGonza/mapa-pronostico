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

  for (const coord of coordinates) {
    const row = byLocalidad.get(coord.LOCALIDAD.trim().toUpperCase());
    if (!row) {
      console.warn(`[generateMap] Sin datos de pronóstico para "${coord.LOCALIDAD}"`);
      continue;
    }

    ctx.font = fontStack("FiraSans-Regular", 32);
    ctx.fillStyle = COLOR_TEXT;
    ctx.fillText(row.LOCALIDAD, coord.X_loc, coord.Y_loc);

    ctx.font = fontStack("FiraSans-Bold", 34);
    ctx.fillStyle = COLOR_TMIN;
    ctx.fillText(String(row.TMIN), coord.X_tmin, coord.Y_tmin);

    ctx.fillStyle = COLOR_TMAX;
    ctx.fillText(String(row.TMAX), coord.X_tmax, coord.Y_tmax);

    ctx.font = fontStack("FiraSans-Regular", 32);
    ctx.fillStyle = COLOR_TEXT;
    ctx.fillText(coord.sep, coord.sep_cordx, coord.sep_cordy);

    const iconPath = resolveIconPath(imgsDir, row.CONDICION);
    if (iconPath) {
      const iconImg = await loadImage(iconPath);
      const w = Math.round(iconImg.width / 6);
      const h = Math.round(iconImg.height / 6);
      ctx.drawImage(iconImg, coord.img_cordx, coord.img_cordy, w, h);
    } else {
      console.warn(
        `[generateMap] Ícono no encontrado para condición "${row.CONDICION}"`
      );
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
  return outputPath;
}

module.exports = { generateForecastMap, MATERIALES_DIR };
