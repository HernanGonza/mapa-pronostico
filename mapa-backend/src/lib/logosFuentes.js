const path = require('path');
const { loadImage } = require('canvas');

/**
 * Logos de los organismos que aportan los datos (recortados al contenido, en data/brand/fuentes):
 * smn (color), inta e hidrologico (blancos, para fondos oscuros).
 */
const DIR = path.join(__dirname, '../../data/brand/fuentes');
const cache = new Map();
const cargar = (nombre) => {
  if (!cache.has(nombre)) cache.set(nombre, loadImage(path.join(DIR, `${nombre}.png`)).catch((e) => { cache.delete(nombre); throw e; }));
  return cache.get(nombre);
};

/** Ancho que ocupa el logo `nombre` dibujado a `alto` de alto. */
async function anchoLogo(nombre, alto) {
  const img = await cargar(nombre);
  return (img.width / img.height) * alto;
}

/** Dibuja los logos en fila, de izquierda a derecha desde `x`, centrados en `yc`; devuelve el x donde termina. */
async function dibujarLogos(ctx, nombres, x, yc, alto, separacion) {
  for (const n of nombres) {
    const img = await cargar(n), w = (img.width / img.height) * alto;
    ctx.drawImage(img, x, yc - alto / 2, w, alto);
    x += w + separacion;
  }
  return x - separacion;
}

module.exports = { dibujarLogos, anchoLogo };
