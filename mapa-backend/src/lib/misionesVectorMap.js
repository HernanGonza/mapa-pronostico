const path = require("path");
const fs = require("fs");
const { createCanvas, loadImage } = require("canvas");
const { loadCentroides } = require("./departamentos");

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

const MAPA_VIEWBOX = { w: 976.1, h: 1072.11 };
const MAPA_ASPECT = MAPA_VIEWBOX.w / MAPA_VIEWBOX.h;

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

// --- Proyección lat/lng -> coordenadas del SVG (para dibujar un polígono
// geográfico cualquiera, ej. el del CAP del SMN, encima del mapa) ---------
//
// "MAPA MISIONES.svg" es una ilustración, no un mapa geo-referenciado: no
// trae ninguna proyección declarada. Igual que config/projection.js hace
// para basemap.png (ajuste afín por cuadrados mínimos, calibrado a mano
// contra 13 estaciones), acá se calibra un ajuste afín — pero automático,
// sin medir nada a mano: se usan los centroides de los 17 departamentos
// como puntos de referencia, comparando el centroide real (lat/lng, de
// departamentos.geojson) contra el centroide del área pintada en el SVG
// (medido por escaneo de píxeles, coloreando cada departamento solo). Con
// 17 puntos el ajuste queda sobredeterminado y tolera bien que el dibujo
// no sea geométricamente exacto.
// {x: lng, y: lat} por depto — mismo centroide real que usa el cálculo de
// riesgo de incendios (departamentos.js:loadCentroides), no uno propio.
const centroideGeoPorDepto = new Map([...loadCentroides()].map(([id, c]) => [id, { x: c.lng, y: c.lat }]));

// Resolución de trabajo para medir el centroide de cada depto en el SVG:
// no es la resolución final del mapa (esa la define quien llama a
// dibujarMapaEnRecuadro), sólo tiene que alcanzar para promediar bien los
// píxeles pintados.
const CENTROIDE_RES = { w: 1200, h: Math.round(1200 / MAPA_ASPECT) };
const COLOR_MEDICION = { r: 255, g: 0, b: 255 }; // magenta puro: no aparece en los grises originales del SVG.

let centroidesSvgPromise;
async function centroidesSvgPorDepto() {
  if (!centroidesSvgPromise) {
    centroidesSvgPromise = (async () => {
      const { w, h } = CENTROIDE_RES;
      const canvas = createCanvas(w, h);
      const ctx = canvas.getContext("2d");
      const resultado = new Map();
      for (const [, depto] of ZONAS) {
        const img = await rasterizarMapa(new Map([[depto, "#ff00ff"]]), w, h);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, w, h);
        let sx = 0, sy = 0, n = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (Math.abs(data[i] - COLOR_MEDICION.r) < 30 && data[i + 1] < 40 && Math.abs(data[i + 2] - COLOR_MEDICION.b) < 30) { sx += x; sy += y; n++; }
          }
        }
        if (!n) throw new Error(`MAPA MISIONES.svg: no se pudo medir el centroide del departamento ${depto}`);
        resultado.set(depto, { x: (sx / n) * (MAPA_VIEWBOX.w / w), y: (sy / n) * (MAPA_VIEWBOX.h / h) });
      }
      return resultado;
    })();
  }
  return centroidesSvgPromise;
}

/** Resuelve p=[a,b,c] que minimiza Σ(a·fila[0]+b·fila[1]+c·fila[2] - objetivo)² (cuadrados mínimos, ecuaciones normales). */
function resolverMinimosCuadrados(filas, objetivo) {
  const ATA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], ATb = [0, 0, 0];
  filas.forEach((f, i) => {
    for (let r = 0; r < 3; r++) {
      ATb[r] += f[r] * objetivo[i];
      for (let c = 0; c < 3; c++) ATA[r][c] += f[r] * f[c];
    }
  });
  const M = ATA.map((fila, i) => [...fila, ATb[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= 3; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return [0, 1, 2].map((r) => M[r][3] / M[r][r]);
}

let proyeccionPromise;
/** {ax,bx,cx,ay,by,cy} tal que x_svg ≈ ax·lng+bx·lat+cx, y_svg ≈ ay·lng+by·lat+cy (unidades del viewBox). */
async function calibrarProyeccion() {
  if (!proyeccionPromise) {
    proyeccionPromise = (async () => {
      const svgPorDepto = await centroidesSvgPorDepto();
      const filas = [], objetivoX = [], objetivoY = [];
      for (const [depto, geo] of centroideGeoPorDepto) {
        const svg = svgPorDepto.get(depto);
        if (!svg) continue;
        filas.push([geo.x, geo.y, 1]);
        objetivoX.push(svg.x);
        objetivoY.push(svg.y);
      }
      if (filas.length < 6) throw new Error("MAPA MISIONES.svg: no hay suficientes departamentos para calibrar la proyección.");
      const [ax, bx, cx] = resolverMinimosCuadrados(filas, objetivoX);
      const [ay, by, cy] = resolverMinimosCuadrados(filas, objetivoY);
      return { ax, bx, cx, ay, by, cy };
    })();
  }
  return proyeccionPromise;
}

// División política de los 79 municipios (mismo dataset que usa el mapa
// interactivo, `municipios.geojson`): "MAPA MISIONES.svg" sólo trae los 17
// departamentos, no hay un SVG por municipio — pero con la proyección ya
// calibrada no hace falta: se proyectan los límites reales de
// municipios.geojson igual que el polígono del aviso, y se dibujan como
// líneas finas encima del mapa. Sin esta referencia el polígono del SMN
// queda flotando sobre una silueta lisa, sin forma de ubicar qué localidad
// está adentro.
const MUNICIPIOS_GEOJSON_PATH = path.join(__dirname, "..", "..", "data", "municipios.geojson");
const municipiosGeojson = JSON.parse(fs.readFileSync(MUNICIPIOS_GEOJSON_PATH, "utf8"));

function proyectarPunto(proyeccion, caja, escalaX, escalaY, [lng, lat]) {
  const xSvg = proyeccion.ax * lng + proyeccion.bx * lat + proyeccion.cx;
  const ySvg = proyeccion.ay * lng + proyeccion.by * lat + proyeccion.cy;
  return [caja.x + xSvg * escalaX, caja.y + ySvg * escalaY];
}

function dibujarAnilloProyectado(ctx, proyeccion, caja, escalaX, escalaY, anillo) {
  ctx.beginPath();
  anillo.forEach((punto, i) => {
    const [px, py] = proyectarPunto(proyeccion, caja, escalaX, escalaY, punto);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

function dibujarMunicipios(ctx, proyeccion, caja, escalaX, escalaY) {
  ctx.save();
  ctx.strokeStyle = "rgba(38,58,49,0.6)";
  ctx.lineWidth = Math.max(1, caja.w * 0.0013);
  for (const feature of municipiosGeojson.features) {
    const poligonos = feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [feature.geometry.coordinates];
    for (const anillos of poligonos) for (const anillo of anillos) {
      dibujarAnilloProyectado(ctx, proyeccion, caja, escalaX, escalaY, anillo);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Dibuja el mapa de departamentos en `recuadro` (como dibujarMapaEnRecuadro),
 * la división de municipios encima (referencia geográfica) y, encima de
 * todo, un polígono geográfico cualquiera (anillo de [lng,lat], se cierra
 * solo) — ej. el área de un aviso del SMN — proyectado con el ajuste
 * calibrado más arriba. `colorPoligono` es un color CSS (ej. el violeta de
 * ACP); se dibuja con relleno semitransparente y borde sólido.
 */
async function dibujarMapaConPoligono(ctx, coloresPorDepto, poligonoLngLat, colorPoligono, recuadro) {
  const [caja, proyeccion] = await Promise.all([dibujarMapaEnRecuadro(ctx, coloresPorDepto, recuadro), calibrarProyeccion()]);
  const escalaX = caja.w / MAPA_VIEWBOX.w, escalaY = caja.h / MAPA_VIEWBOX.h;
  dibujarMunicipios(ctx, proyeccion, caja, escalaX, escalaY);
  dibujarAnilloProyectado(ctx, proyeccion, caja, escalaX, escalaY, poligonoLngLat);
  ctx.fillStyle = colorPoligono; ctx.globalAlpha = 0.3; ctx.fill();
  ctx.globalAlpha = 1; ctx.strokeStyle = colorPoligono; ctx.lineWidth = Math.max(3, caja.w * 0.008);
  ctx.stroke();
  return caja;
}

module.exports = { PLACAS_DIR, ZONAS, MAPA_ASPECT, MAPA_VIEWBOX, rasterizarMapa, dibujarMapaEnRecuadro, dibujarMapaConPoligono };
