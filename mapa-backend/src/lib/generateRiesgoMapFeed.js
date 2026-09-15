const path = require("path");
const { createCanvas, loadImage, registerFont } = require("canvas");
const { categorias, errorDeZonas } = require("./riesgoIncendios");
const { fechaValida } = require("./generateRiesgoMap");
const { dibujarMapaEnRecuadro } = require("./misionesVectorMap");

/**
 * Formato "feed" del riesgo de incendios (2250x2813, misma convención de
 * tamaño que alertas meteorológicas) — misiones.png (la plantilla actual)
 * es "historias" (2250x4000) y pinta los departamentos con flood-fill
 * sobre colores exactos, técnica que no tolera reescalar ni recomponer.
 * En vez de forzar eso, esta versión arma un fondo propio (colores de
 * marca, sin foto — no hay asset de diseño para un fondo "feed" todavía)
 * y pinta los departamentos con el mismo mapa vectorial SVG que ya usa
 * alertas meteorológicas (misionesVectorMap). El pie institucional (los
 * 3 logos) se recorta de misiones.png — es arte de UI plano, no foto, así
 * que se reutiliza tal cual sin que se note el origen.
 */
const DIR = path.join(__dirname, "../../data/ecosotat");
registerFont(path.join(DIR, "OakSans-Regular.ttf"), { family: "RiesgoFeed" });
registerFont(path.join(DIR, "OakSans-Bold.ttf"), { family: "RiesgoFeed", weight: "bold" });

const W = 2250, H = 2813;
// Franja del pie (3 logos) en misiones.png: medida a mano escaneando la
// imagen — de ahí para abajo es la barra blanca, arriba es la foto.
const FOOTER_Y_ORIGEN = 3736, FOOTER_H_ORIGEN = 4000 - 3736;

function ajustarLineas(ctx, texto, maxWidth) {
  const palabras = texto.split(" "), lineas = [];
  let actual = "";
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (ctx.measureText(prueba).width > maxWidth && actual) { lineas.push(actual); actual = palabra; }
    else actual = prueba;
  }
  if (actual) lineas.push(actual);
  return lineas;
}

async function generateRiesgoMapFeed({ zonas, fecha }) {
  const error = errorDeZonas(zonas);
  if (error) throw new Error(error);
  if (!fechaValida(fecha)) throw new Error("Fecha de informe inválida.");

  const misiones = await loadImage(path.join(DIR, "misiones.png"));
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Fondo: degradé de marca (verde oscuro), sin foto — ver comentario arriba.
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#234131");
  grad.addColorStop(1, "#152318");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Título
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";
  ctx.font = 'bold 84px "RiesgoFeed"';
  const lineasTitulo = ajustarLineas(ctx, "ÍNDICE DE PELIGRO DE INCENDIOS", W - 260);
  lineasTitulo.forEach((linea, i) => ctx.fillText(linea, 130, 110 + i * 100));
  const yTrasTitulo = 110 + lineasTitulo.length * 100 + 40;

  // Leyenda de niveles: mismo lenguaje visual que "NIVEL DE ALERTA" de
  // alertas meteorológicas (caja translúcida + punto de color + texto),
  // en vez de recrear el gauge semicircular original.
  const leyenda = { x: 130, y: yTrasTitulo, w: W - 260, pad: 28 };
  ctx.font = '30px "RiesgoFeed"';
  const filaH = 54;
  const leyendaH = categorias.length * filaH + leyenda.pad * 2;
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  const r = 22;
  ctx.beginPath();
  ctx.moveTo(leyenda.x + r, leyenda.y);
  ctx.arcTo(leyenda.x + leyenda.w, leyenda.y, leyenda.x + leyenda.w, leyenda.y + leyendaH, r);
  ctx.arcTo(leyenda.x + leyenda.w, leyenda.y + leyendaH, leyenda.x, leyenda.y + leyendaH, r);
  ctx.arcTo(leyenda.x, leyenda.y + leyendaH, leyenda.x, leyenda.y, r);
  ctx.arcTo(leyenda.x, leyenda.y, leyenda.x + leyenda.w, leyenda.y, r);
  ctx.closePath();
  ctx.fill();
  categorias.forEach((c, i) => {
    const cy = leyenda.y + leyenda.pad + i * filaH + filaH / 2;
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(leyenda.x + leyenda.pad + 12, cy, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(c.nombre, leyenda.x + leyenda.pad + 40, cy + 2);
  });
  ctx.textBaseline = "top";

  // "En caso de incendios · 911"
  const yTel = leyenda.y + leyendaH + 50;
  ctx.font = '30px "RiesgoFeed"';
  ctx.fillStyle = "#ffffff";
  ctx.fillText("EN CASO DE INCENDIOS", 130, yTel);
  ctx.font = 'bold 56px "RiesgoFeed"';
  ctx.fillStyle = "#ff5b52";
  ctx.fillText("911", 130, yTel + 42);

  // Mapa vectorial, en el espacio que queda hasta el pie.
  const footerH = FOOTER_H_ORIGEN;
  const mapaTop = yTel + 130;
  const mapaRecuadro = { x: 130, y: mapaTop, w: W - 260, h: H - footerH - mapaTop - 40 };
  const colorDeCategoria = new Map(categorias.map((c) => [c.nombre, c.color]));
  const coloresPorDepto = new Map(zonas.map((z) => [String(z.id), colorDeCategoria.get(z.categoria)]));
  await dibujarMapaEnRecuadro(ctx, coloresPorDepto, mapaRecuadro);

  // Pie institucional (3 logos), recortado tal cual de misiones.png.
  ctx.drawImage(misiones, 0, FOOTER_Y_ORIGEN, W, footerH, 0, H - footerH, W, footerH);

  return canvas.toBuffer("image/png");
}

module.exports = { generateRiesgoMapFeed };
