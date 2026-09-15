const path = require("path");
const fs = require("fs");
const { loadImage } = require("canvas");

/**
 * Mapa vectorial de los 17 departamentos de Misiones (MAPA MISIONES.svg,
 * provisto por diseño junto con las placas de alertas meteorológicas) —
 * compartido por cualquier generador de placa que necesite pintar un
 * choropleth por departamento sin depender de flood-fill sobre un PNG
 * plano (la técnica vieja de generateRiesgoMap.js, que no tolera
 * reescalar ni recomponer el fondo). Extraído de generateAlertaMap.js
 * para poder reutilizarlo en riesgo de incendios y pronóstico.
 */
const DIR = path.join(__dirname, "../../data/alertas");
const PLACAS_DIR = path.join(DIR, "placas-2025");

// gris (redondeado a la decena) -> id de depto: mismo criterio de color que
// traía el arte plano viejo, ahora resuelto contra "MAPA MISIONES.svg" (mapa
// vectorial real) en vez de flood-fill sobre un PNG.
const ZONAS = [[10,'4'],[20,'3'],[30,'1'],[40,'11'],[50,'5'],[60,'15'],[70,'14'],[80,'13'],[90,'2'],[100,'10'],[110,'17'],[120,'8'],[130,'12'],[140,'16'],[150,'6'],[160,'9'],[170,'7']];

const mapaSvgCrudo = fs.readFileSync(path.join(PLACAS_DIR, "MAPA MISIONES.svg"), "utf8");
// Resuelve, una sola vez al cargar, qué clase CSS del SVG corresponde a cada
// depto: cada clase trae de fábrica un gris (mismo criterio que ZONAS); no
// hace falta ningún flood-fill, es una tabla directa clase -> gray -> depto.
const claseDeDepto = (() => {
  const grayADepto = new Map(ZONAS);
  const claseAGray = new Map();
  for (const m of mapaSvgCrudo.matchAll(/\.(cls-\d+)\s*\{\s*fill:\s*#([0-9a-fA-F]{6});\s*\}/g)) {
    claseAGray.set(m[1], Math.round(parseInt(m[2].slice(0, 2), 16) / 10) * 10);
  }
  const out = new Map();
  for (const [clase, gray] of claseAGray) {
    const depto = grayADepto.get(gray);
    if (depto) out.set(depto, clase);
  }
  if (out.size !== ZONAS.length) throw new Error(`MAPA MISIONES.svg: se esperaban ${ZONAS.length} deptos, se resolvieron ${out.size}.`);
  return out;
})();

const MAPA_ASPECT = 976.1 / 1072.11;

/**
 * Rasteriza el mapa a `w`x`h`, coloreando cada departamento con
 * `coloresPorDepto.get(id)` (id = mismo string que loadDepartamentos()).
 * Devuelve una Image de node-canvas, lista para ctx.drawImage.
 */
async function rasterizarMapa(coloresPorDepto, w, h) {
  let svg = mapaSvgCrudo;
  for (const [depto, clase] of claseDeDepto) {
    const hex = coloresPorDepto.get(depto);
    if (!hex) continue;
    svg = svg.replace(new RegExp(`\\.${clase}\\s*\\{\\s*fill:\\s*#[0-9a-fA-F]{6};\\s*\\}`), `.${clase} { fill: ${hex}; }`);
  }
  svg = svg.replace(/<svg\b([^>]*)>/, (m, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, "")} width="${w}" height="${h}">`);
  return loadImage(Buffer.from(svg));
}

/** Dibuja el mapa centrado en el recuadro {x,y,w,h}, sin deformarlo (2x
 * de resolución interna para que quede nítido al tamaño final). */
async function dibujarMapaEnRecuadro(ctx, coloresPorDepto, recuadro) {
  let mw = recuadro.w, mh = Math.round(mw / MAPA_ASPECT);
  if (mh > recuadro.h) { mh = recuadro.h; mw = Math.round(mh * MAPA_ASPECT); }
  const mapaImg = await rasterizarMapa(coloresPorDepto, mw * 2, mh * 2);
  const x = recuadro.x + (recuadro.w - mw) / 2, y = recuadro.y + (recuadro.h - mh) / 2;
  ctx.drawImage(mapaImg, x, y, mw, mh);
  return { x, y, w: mw, h: mh };
}

module.exports = { PLACAS_DIR, ZONAS, MAPA_ASPECT, rasterizarMapa, dibujarMapaEnRecuadro };
