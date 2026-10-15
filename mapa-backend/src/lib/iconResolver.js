const fs = require("fs");
const path = require("path");
const { loadImage } = require("canvas");
const { partesCondicion, CATALOGO } = require("./condiciones");

const DIR_ICONOS = path.join(__dirname, "..", "..", "data", "iconos-smn");

/**
 * Ruta del ícono (PNG del SMN, de día) de una condición del tiempo. Con varias («Nublado + Chaparrones»)
 * se usa el de la más severa, que es la que cuenta. `imgsDir` se conserva por compatibilidad (los PNG viejos ya no se usan).
 * Devuelve la ruta absoluta o null si no se reconoce ninguna condición.
 */
function resolveIconPath(imgsDir, condicion, momento = "dia") {
  const c = partesCondicion(condicion).reduce((a, b) => (!a || CATALOGO.indexOf(b) > CATALOGO.indexOf(a) ? b : a), null);
  if (!c) return null;
  const archivo = path.join(DIR_ICONOS, path.basename(c[momento === "noche" ? "noche" : "dia"])); // «smn/3.png» → 3.png
  return fs.existsSync(archivo) ? archivo : null;
}

const cacheImagenes = new Map();
/** Carga un ícono (PNG o SVG) como imagen de node-canvas. A los SVG a veces les falta width/height (canvas lo exige): se les pone el tamaño del viewBox ×4. */
function cargarIcono(ruta) {
  if (!cacheImagenes.has(ruta)) {
    const p = (async () => {
      if (!/\.svg$/i.test(ruta)) return loadImage(ruta);
      let svg = fs.readFileSync(ruta, "utf8");
      if (!/<svg[^>]*\swidth=/.test(svg)) svg = svg.replace("<svg ", '<svg width="256" height="256" ');
      return loadImage(Buffer.from(svg));
    })();
    cacheImagenes.set(ruta, p);
    p.catch(() => cacheImagenes.delete(ruta));
  }
  return cacheImagenes.get(ruta);
}

module.exports = { resolveIconPath, cargarIcono, DIR_ICONOS };
