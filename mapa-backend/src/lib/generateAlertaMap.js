const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage, registerFont } = require('canvas');
const { categorias, iconos, errorDeZonas, errorDeIconos } = require('./alertasMeteorologicas');
const DIR = path.join(__dirname, '../../data/alertas');
const PLACAS_DIR = path.join(DIR, 'placas-2025');
registerFont(path.join(DIR, 'OakSans-Regular.ttf'), {family:'AlertaPlaca'});
registerFont(path.join(DIR, 'OakSans-Bold.ttf'), {family:'AlertaPlaca',weight:'bold'});
// Material fuente: Placas-Alertas-Separadas/ en la raíz del repo (assets
// separados por capa, provistos por diseño) — se copió tal cual a
// data/alertas/placas-2025/ para que el backend no dependa de una carpeta
// fuera de su propio árbol.
//
// gris (redondeado a la decena) -> id de depto: mismo criterio de color que
// traía el arte plano viejo, ahora resuelto contra "MAPA MISIONES.svg" (mapa
// vectorial real) en vez de flood-fill sobre un PNG.
const ZONAS = [[10,'4'],[20,'3'],[30,'1'],[40,'11'],[50,'5'],[60,'15'],[70,'14'],[80,'13'],[90,'2'],[100,'10'],[110,'17'],[120,'8'],[130,'12'],[140,'16'],[150,'6'],[160,'9'],[170,'7']];
const FONDOS = {
  // el nombre de archivo no indica tamaño ni tema (assets exportados con
  // nombres genéricos) — verificado a mano abriendo cada uno.
  nubes: { feed: 'fondo feed (2).png', historias: 'fondo feed.png' },
  tormenta: { feed: 'fondo historias.png', historias: 'fondo historias (2).png' },
};
const TAMANOS = ['feed', 'historias'];
// Coordenadas calibradas a mano sobre los fondos nuevos, reproduciendo la
// ubicación de cada elemento en las plantillas viejas (medida sobre
// "Alerta metorológica {feed,historias} {1,2}.png"): período arriba (igual
// que antes), mapa y caja de niveles en la misma zona donde estaban.
const LAYOUTS = {
  // La placa feed es más baja que la de historias (2813 vs 4000 de alto)
  // pero el mapa ocupa casi el mismo ancho relativo — con la fila de
  // fenómenos al tamaño de historias, la cola sudoeste de Misiones (la
  // parte del mapa que más entra hacia la izquierda) termina pisando la
  // última fila si hay 4 o 5 fenómenos elegidos. Por eso acá los iconos,
  // el texto y la caja de "NIVEL DE ALERTA" van más chicos.
  feed: {
    periodo: { x: 180, y: 345, w: 860, h: 175, r: 87 },
    mapa: { x: 431, y: 414, w: 1614, h: 2011 },
    niveles: { x: 195, y: 625, w: 640 },
    iconos: { x: 165, y0: 1200, rowH: 132, iw: 112, fontSize: 27, gap: 20 },
  },
  historias: {
    periodo: { x: 630, y: 448, w: 945, h: 200, r: 100 },
    mapa: { x: 191, y: 979, w: 1862, h: 2319 },
    niveles: { x: 160, y: 886, w: 780 },
    iconos: { x: 165, y0: 1570, rowH: 190, iw: 170, fontSize: 38, gap: 30 },
  },
};
// Rectángulo con puntas redondeadas dibujado a mano (arcos), en vez de
// ctx.roundRect: con radio == alto/2 (una "pill" con puntas semicirculares)
// el roundRect de node-canvas deja un corte/muesca en la punta.
function pill(ctx,x,y,w,h,r) {
  r=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y); ctx.arc(x+w-r,y+r,r,-Math.PI/2,0);
  ctx.lineTo(x+w,y+h-r); ctx.arc(x+w-r,y+h-r,r,0,Math.PI/2);
  ctx.lineTo(x+r,y+h); ctx.arc(x+r,y+h-r,r,Math.PI/2,Math.PI);
  ctx.lineTo(x,y+r); ctx.arc(x+r,y+r,r,Math.PI,Math.PI*1.5);
  ctx.closePath();
}
// Corta `texto` en líneas que entren en `maxWidth` (con `ctx.font` ya
// seteado), juntando palabra por palabra — mismo criterio simple que ya usa
// el período (ahí corta el operador a mano con Enter; acá no hay operador,
// así que se arma solo a partir de `categorias[].accion`).
function ajustarLineas(ctx, texto, maxWidth) {
  const palabras = texto.split(' '), lineas = []; let actual = '';
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (ctx.measureText(prueba).width > maxWidth && actual) { lineas.push(actual); actual = palabra; }
    else actual = prueba;
  }
  if (actual) lineas.push(actual);
  return lineas;
}
let symbolsPromise;
function loadSymbols() {
  if (!symbolsPromise) symbolsPromise = Promise.all(iconos.map(async i => [i.id, await loadImage(path.join(PLACAS_DIR, 'iconos', `${i.id}.png`))])).then(Object.fromEntries);
  return symbolsPromise;
}
let fondosPromise;
function loadFondos() {
  if (!fondosPromise) fondosPromise = Promise.all(TAMANOS.flatMap(tamano => Object.keys(FONDOS).map(async fondo => [`${fondo}:${tamano}`, await loadImage(path.join(PLACAS_DIR, FONDOS[fondo][tamano]))]))).then(Object.fromEntries);
  return fondosPromise;
}
// --- Mapa vectorial (departamentos) ---------------------------------------
const mapaSvgCrudo = fs.readFileSync(path.join(PLACAS_DIR, 'MAPA MISIONES.svg'), 'utf8');
// Resuelve, una sola vez al cargar, qué clase CSS del SVG corresponde a cada
// depto: cada clase trae de fábrica un gris (mismo criterio que ZONAS); no
// hace falta ningún flood-fill, es una tabla directa clase -> gray -> depto.
const claseDeDepto = (() => {
  const grayADepto = new Map(ZONAS);
  const claseAGray = new Map();
  for (const m of mapaSvgCrudo.matchAll(/\.(cls-\d+)\s*\{\s*fill:\s*#([0-9a-fA-F]{6});\s*\}/g)) {
    claseAGray.set(m[1], Math.round(parseInt(m[2].slice(0,2),16)/10)*10);
  }
  const out = new Map();
  for (const [clase, gray] of claseAGray) {
    const depto = grayADepto.get(gray);
    if (depto) out.set(depto, clase);
  }
  if (out.size !== ZONAS.length) throw new Error(`MAPA MISIONES.svg: se esperaban ${ZONAS.length} deptos, se resolvieron ${out.size}.`);
  return out;
})();
async function rasterizarMapa(zonas, w, h) {
  const byId = new Map(zonas.map(z => [String(z.id), z]));
  const colorDeCategoria = new Map(categorias.map(c => [c.nombre, c.color]));
  let svg = mapaSvgCrudo;
  for (const [depto, clase] of claseDeDepto) {
    const hex = colorDeCategoria.get(byId.get(depto).categoria);
    svg = svg.replace(new RegExp(`\\.${clase}\\s*\\{\\s*fill:\\s*#[0-9a-fA-F]{6};\\s*\\}`), `.${clase} { fill: ${hex}; }`);
  }
  svg = svg.replace(/<svg\b([^>]*)>/, (m, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g,'')} width="${w}" height="${h}">`);
  return loadImage(Buffer.from(svg));
}
// --- Caja "NIVEL DE ALERTA" (referencias) ---------------------------------
const nivelesSvgCrudo = fs.readFileSync(path.join(PLACAS_DIR, 'NIVELES DE ALERTA.svg'), 'utf8');
// El SVG trae el texto en <text>/<tspan> con font-family "Oak Sans" — pero
// esa tipografía sólo está registrada para node-canvas (registerFont más
// arriba), no a nivel del sistema operativo, así que si rasterizamos el SVG
// tal cual el texto sale con una tipografía cualquiera del sistema. Se saca
// el <text> del SVG (sólo queda la caja translúcida + los 4 círculos, que
// no dependen de ninguna fuente) y el texto se dibuja aparte con
// ctx.fillText, usando las mismas coordenadas (en unidades del viewBox)
// que traía el original.
const nivelesSvgSinTexto = nivelesSvgCrudo.replace(/<text[\s\S]*?<\/text>/g, '');
const NIVELES_VIEWBOX = { w: 450.67, h: 331.51 };
const NIVELES_TEXTO = {
  titulo: { x: 38.81, y: 60.36, size: 38.46 },
  filaX: 87.93,
  filaY: [111.72, 155.51, 199.3, 238.72], // baseline de la 1ª línea de cada categoría (orden = categorias[])
  size: 30.65,
  lineH: 32.4,
  maxWidth: NIVELES_VIEWBOX.w - 87.93 - 24,
};
let nivelesCache = new Map();
async function rasterizarNiveles(w, h) {
  const key = `${w}x${h}`;
  if (!nivelesCache.has(key)) {
    const svg = nivelesSvgSinTexto.replace(/<svg\b([^>]*)>/, (m, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g,'')} width="${w}" height="${h}">`);
    nivelesCache.set(key, loadImage(Buffer.from(svg)));
  }
  return nivelesCache.get(key);
}
const TITULO_PREDETERMINADO = 'Alerta meteorológica';
function errorDeTitulo(titulo) {
  return typeof titulo !== 'string' || !titulo.trim() || titulo.length > 60 || /[\r\n]/.test(titulo)
    ? 'Escribí un título de hasta 60 caracteres, en una sola línea.' : null;
}
// El encabezado original forma parte del PNG. Un panel opaco lo sustituye
// por completo cuando se elige otro título, sin tocar el pie institucional.
function dibujarTitulo(ctx, titulo, tamano, width) {
  if (titulo === TITULO_PREDETERMINADO) return;
  const h = tamano === 'feed' ? 330 : 430;
  ctx.save();
  ctx.fillStyle = '#172332'; ctx.fillRect(0, 0, width, h);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 116px AlertaPlaca';
  ctx.textAlign = tamano === 'feed' ? 'left' : 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(titulo.trim().toLocaleUpperCase('es-AR'), tamano === 'feed' ? 190 : width / 2, h * 0.72, width - 380);
  ctx.restore();
}
async function generateAlertaMap({zonas,periodo='Próximas 24 horas',fondo='tormenta',tamano='feed',iconos:iconosElegidos=[],titulo=TITULO_PREDETERMINADO}) {
  const error=errorDeZonas(zonas)||errorDeIconos(iconosElegidos)||errorDeTitulo(titulo);if(error)throw new Error(error);
  if(!['tormenta','nubes'].includes(fondo)||!TAMANOS.includes(tamano)||typeof periodo!=='string'||!periodo.trim()||periodo.length>140)throw new Error('Período, fondo o tamaño inválido.');
  const layout = LAYOUTS[tamano];
  const [fondos, symbols] = await Promise.all([loadFondos(), loadSymbols()]);
  const fondoImg = fondos[`${fondo}:${tamano}`];
  const canvas=createCanvas(fondoImg.width,fondoImg.height),ctx=canvas.getContext('2d');
  ctx.drawImage(fondoImg,0,0);
  dibujarTitulo(ctx,titulo,tamano,canvas.width);

  // Mapa: se rasteriza a un tamaño generoso (según el ancho del recuadro
  // donde va) y se dibuja centrado ahí, conservando el aspect ratio real
  // del SVG (el recuadro es sólo una referencia de encuadre, no se
  // deforma el mapa para llenarlo).
  const m = layout.mapa, mapaAspect = 976.1/1072.11;
  let mw = m.w, mh = Math.round(mw/mapaAspect);
  if (mh > m.h) { mh = m.h; mw = Math.round(mh*mapaAspect); }
  const mapaImg = await rasterizarMapa(zonas, mw*2, mh*2); // 2x para nitidez, se dibuja al tamaño final
  ctx.drawImage(mapaImg, m.x+(m.w-mw)/2, m.y+(m.h-mh)/2, mw, mh);

  // Caja "NIVEL DE ALERTA": mismo criterio, ancho fijo por layout, alto
  // según el aspect ratio real del SVG.
  const niv = layout.niveles, nivEscala = niv.w/NIVELES_VIEWBOX.w, nivH = Math.round(NIVELES_VIEWBOX.h*nivEscala);
  const nivelesImg = await rasterizarNiveles(niv.w*2, nivH*2);
  ctx.drawImage(nivelesImg, niv.x, niv.y, niv.w, nivH);
  ctx.fillStyle='#fff';
  ctx.font=`bold ${NIVELES_TEXTO.titulo.size*nivEscala}px AlertaPlaca`;
  ctx.textAlign='left';ctx.textBaseline='alphabetic';
  ctx.fillText('NIVEL DE ALERTA', niv.x+NIVELES_TEXTO.titulo.x*nivEscala, niv.y+NIVELES_TEXTO.titulo.y*nivEscala);
  ctx.font=`${NIVELES_TEXTO.size*nivEscala}px AlertaPlaca`;
  categorias.forEach((c,i)=>{
    const lineas = ajustarLineas(ctx, c.accion, NIVELES_TEXTO.maxWidth*nivEscala);
    const x0 = niv.x+NIVELES_TEXTO.filaX*nivEscala, y0 = niv.y+NIVELES_TEXTO.filaY[i]*nivEscala;
    lineas.forEach((linea,j)=>ctx.fillText(linea, x0, y0+j*NIVELES_TEXTO.lineH*nivEscala));
  });

  // Período (igual que antes: pill blanca + texto centrado, 1 a 3 líneas
  // que el operador corta con Enter).
  const p = layout.periodo;
  ctx.fillStyle='#fff';pill(ctx,p.x,p.y,p.w,p.h,p.r);ctx.fill();
  const lineasPeriodo=periodo.trim().split('\n').map(l=>l.trim()).filter(Boolean);
  const tamanoFuente=lineasPeriodo.length>1?36:44, lineHPeriodo=tamanoFuente*1.15;
  ctx.fillStyle='#171717';ctx.font=`bold ${tamanoFuente}px AlertaPlaca`;ctx.textAlign='center';ctx.textBaseline='middle';
  const cx=p.x+p.w/2, cy=p.y+p.h/2, offset=(lineasPeriodo.length-1)*lineHPeriodo/2;
  lineasPeriodo.forEach((linea,i)=>ctx.fillText(linea,cx,cy-offset+i*lineHPeriodo,p.w-140));
  ctx.textAlign='left';ctx.textBaseline='alphabetic';

  // Fenómenos elegidos: de cada fila nueva (icono + texto + franja gris de
  // referencia, todo en un lienzo de 2250x324) sólo se usa el ícono —
  // mismo recorte que usaban los 4 PNG viejos — y el texto/color se sigue
  // dibujando a mano, igual que antes.
  const catalogoIcono=new Map(iconos.map(i=>[i.id,i])), colorPorCategoria=new Map(categorias.map(c=>[c.nombre,c.color]));
  const ic = layout.iconos, iw=ic.iw, ih=Math.round(iw*324/350), fontSize=ic.fontSize, escalaFuente=fontSize/38;
  iconosElegidos.forEach((elegido,index)=> {
    const icon=catalogoIcono.get(elegido.id), color=colorPorCategoria.get(elegido.categoria);
    const y=ic.y0+index*ic.rowH;
    ctx.drawImage(symbols[icon.id],0,0,350,324,ic.x,y,iw,ih);
    const tx=ic.x+iw+ic.gap, baseline=y+ih/2+Math.round(13*escalaFuente);
    ctx.fillStyle='#fff';ctx.font=`bold ${fontSize}px AlertaPlaca`;ctx.fillText(icon.nombre,tx,baseline);
    const tw=ctx.measureText(icon.nombre).width;
    ctx.fillStyle=color;ctx.fillRect(tx,baseline+Math.round(12*escalaFuente),tw,Math.max(4,Math.round(7*escalaFuente)));
  });
  return canvas.toBuffer('image/png');
}
const MAX_RECOMENDACIONES = 2400;
const MAX_IMAGEN_BYTES = 5 * 1024 * 1024;
function errorDeRecomendaciones(texto, fondo, imagen = null, titulo = TITULO_PREDETERMINADO) {
  if (errorDeTitulo(titulo)) return errorDeTitulo(titulo);
  if (imagen !== null) {
    if (typeof imagen !== 'string' || imagen.length > Math.ceil(MAX_IMAGEN_BYTES / 3) * 4 + 40 ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imagen) ||
        Buffer.byteLength(imagen.slice(imagen.indexOf(',') + 1), 'base64') > MAX_IMAGEN_BYTES)
      return 'Elegí una imagen PNG, JPG o WebP de hasta 5 MB.';
  }
  if (typeof texto !== 'string' || !texto.trim() || texto.length > MAX_RECOMENDACIONES)
    return `Escribí las recomendaciones (hasta ${MAX_RECOMENDACIONES} caracteres).`;
  if (!Object.hasOwn(FONDOS, fondo)) return 'Elegí un fondo válido.';
  return null;
}

async function generateRecomendaciones({ texto, fondo = 'tormenta', tamano = 'feed', imagen = null, titulo = TITULO_PREDETERMINADO }) {
  const error = errorDeRecomendaciones(texto, fondo, imagen, titulo);
  if (error || !TAMANOS.includes(tamano)) throw Object.assign(new Error(error || 'Tamaño inválido.'), { status: 400 });
  const puppeteer = require('puppeteer-core');
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  } catch (cause) {
    throw Object.assign(new Error('No se pudo iniciar Chromium para generar la placa. Revisá la instalación del navegador en el backend.', { cause }), { status: 503 });
  }
  try {
    const page = await browser.newPage();
    const height = tamano === 'feed' ? 2813 : 4000;
    await page.setViewport({ width: 2250, height, deviceScaleFactor: 1 });
    const font = fs.readFileSync(path.join(DIR, 'OakSans-Regular.ttf')).toString('base64');
    let bg = fs.readFileSync(path.join(PLACAS_DIR, FONDOS[fondo][tamano])).toString('base64');
    if (titulo !== TITULO_PREDETERMINADO) {
      const fondoImg = await loadImage(Buffer.from(bg, 'base64'));
      const canvas = createCanvas(fondoImg.width, fondoImg.height), ctx = canvas.getContext('2d');
      ctx.drawImage(fondoImg, 0, 0);
      dibujarTitulo(ctx, titulo, tamano, canvas.width);
      bg = canvas.toBuffer('image/png').toString('base64');
    }
    const top = tamano === 'feed' ? 520 : 760;
    const bottom = tamano === 'feed' ? 2200 : 3200;
    await page.setContent(`<style>
      @font-face { font-family: OakPlaca; src: url(data:font/ttf;base64,${font}); }
      * { box-sizing: border-box; } html, body { margin: 0; width: 2250px; height: ${height}px; overflow: hidden; }
      body { background: url(data:image/png;base64,${bg}) center / 100% 100% no-repeat; }
      #area { position: absolute; left: 190px; right: 190px; top: ${top}px; height: ${bottom-top}px; display: flex; flex-direction: column; justify-content: center; gap: 60px; }
      #imagen { display: none; width: 100%; height: 42%; object-fit: contain; flex-shrink: 0; }
      #texto { width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; font: 88px/1.4 OakPlaca, "Noto Color Emoji", sans-serif; color: white; text-shadow: 0 3px 8px rgba(0,0,0,.85); }
      </style><div id="area"><img id="imagen" alt=""><div id="texto"></div></div>`);
    const fits = await page.evaluate(async ({ texto, imagen }) => {
      const img = document.getElementById('imagen');
      if (imagen) {
        img.src = imagen;
        try { await img.decode(); } catch { return 'imagen-invalida'; }
        if (img.naturalWidth * img.naturalHeight > 25000000) return 'imagen-grande';
        img.style.display = 'block';
      }
      const element = document.getElementById('texto');
      element.textContent = texto.trim();
      await document.fonts.ready;
      for (let size = 88; size >= 44; size -= 2) {
        element.style.fontSize = `${size}px`;
        if (element.getBoundingClientRect().height + (imagen ? img.getBoundingClientRect().height + 60 : 0) <= document.getElementById('area').clientHeight) return true;
      }
      return false;
    }, { texto, imagen });
    if (fits === 'imagen-invalida' || fits === 'imagen-grande') throw Object.assign(new Error('La imagen no se puede leer o supera los 25 megapíxeles. Elegí otra imagen.'), { status: 400 });
    if (!fits) throw Object.assign(new Error('El texto no entra en la placa. Acortalo o reducí los saltos de línea.'), { status: 400 });
    return Buffer.from(await page.screenshot({ type: 'png' }));
  } finally { await browser.close(); }
}

module.exports={generateAlertaMap,generateRecomendaciones,errorDeRecomendaciones,errorDeTitulo,TITULO_PREDETERMINADO,MAX_RECOMENDACIONES,TAMANOS};
