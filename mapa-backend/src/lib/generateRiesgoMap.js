const path = require("path");
const { createCanvas, loadImage, registerFont } = require("canvas");
const { categorias, errorDeZonas } = require("./riesgoIncendios");
const DIR = path.join(__dirname, "../../data/ecosotat");

// Correspondencia explícita: ZONA_n del Java NO coincide con el id geográfico.
// Gris de la plantilla e id del departamento. Los rótulos usan gris + 1.
const ZONAS = [
  [10,"4"], [20,"3"], [30,"1"], [40,"11"], [50,"5"], [60,"15"],
  [70,"14"], [80,"13"], [90,"2"], [100,"10"], [110,"17"], [120,"8"],
  [130,"12"], [140,"16"], [150,"6"], [160,"9"], [170,"7"],
];
// Franja reservada para la fecha en la plantilla actual (recuadro difuminado
// debajo del título). Si se cambia `misiones.png`, reubicar acá.
const CAJA_FECHA = { x: 77, y: 800, w: 847, h: 135 };
let plantilla;
async function cargarPlantilla() {
  if (plantilla) return plantilla;
  plantilla = (async () => {
    registerFont(path.join(DIR, "OakSans-Regular.ttf"), { family: "EcoReporte", weight: "normal" });
    registerFont(path.join(DIR, "OakSans-Bold.ttf"), { family: "EcoReporte", weight: "bold" });
    const image = await loadImage(path.join(DIR, "misiones.png"));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    const w = image.width, h = image.height;
    const visited = new Uint8Array(w*h);
    const masks = new Map();
    const grayAt = i => {
      const j=i*4; const r=pixels[j];
      return r>=10 && r<=170 && r%10===0 && pixels[j+1]===r && pixels[j+2]===r ? r : -1;
    };
    // Solo el componente territorial mayor de cada gris: los logos, textos
    // y la escala pueden contener grises iguales y deben quedar intactos.
    for(let i=0;i<w*h;i++) {
      if(visited[i]) continue;
      visited[i]=1;
      const gray=grayAt(i); if(gray<0) continue;
      const region=[i];
      for(let k=0;k<region.length;k++) {
        const p=region[k], x=p%w;
        for(const n of [x>0?p-1:-1,x<w-1?p+1:-1,p-w,p+w]) {
          if(n<0 || n>=w*h || visited[n] || grayAt(n)!==gray) continue;
          visited[n]=1;region.push(n);
        }
      }
      if(region.length>(masks.get(gray)?.length||0)) masks.set(gray,region);
    }
    for(const [gray] of ZONAS) if((masks.get(gray)?.length||0)<1000) throw new Error(`Falta la máscara ECOSOTAT ${gray}`);
    const labels = new Map();
    for (const [gray] of ZONAS) {
      let minX=w, minY=h, maxX=0, maxY=0;
      for (const i of masks.get(gray)) { const x=i%w, y=Math.floor(i/w); minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y); }
      const indices=[];
      for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++) {
        const i=y*w+x, j=i*4;
        if(pixels[j]===gray+1 && pixels[j+1]===gray+1 && pixels[j+2]===gray+1) indices.push(i);
      }
      labels.set(gray,indices);
    }
    return { image, masks, labels };
  })().catch(e=>{plantilla=null;throw e;});
  return plantilla;
}
function fechaValida(fecha) {
  return typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(Date.parse(fecha)) && new Date(fecha).toISOString().slice(0,10)===fecha;
}
async function generateRiesgoMap({ zonas, fecha }) {
  const error = errorDeZonas(zonas);
  if(error) throw new Error(error);
  if(!fechaValida(fecha)) throw new Error("Fecha de informe inválida.");
  const { image, masks, labels } = await cargarPlantilla();
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d"); ctx.drawImage(image,0,0);
  const frame=ctx.getImageData(0,0,image.width,image.height);
  const byId=new Map(zonas.map(z=>[String(z.id),z.categoria]));
  const colors=new Map(categorias.map(c=>[c.nombre,c.color]));
  for(const [gray,id] of ZONAS) {
    const color=colors.get(byId.get(id));
    const rgb=[1,3,5].map(n=>parseInt(color.slice(n,n+2),16));
    for(const i of masks.get(gray)) frame.data.set(rgb,i*4);
    const text = byId.get(id)==="MODERADO" ? [255,255,255] : [0,0,0];
    for(const i of labels.get(gray)) frame.data.set(text,i*4);
  }
  ctx.putImageData(frame,0,0);
  const date=new Date(`${fecha}T12:00:00Z`);
  const day=new Intl.DateTimeFormat("es-AR",{weekday:"long",timeZone:"America/Argentina/Buenos_Aires"}).format(date);
  const [year,month,num]=fecha.split("-");
  const texto = `${day[0].toUpperCase()+day.slice(1)} ${num}/${month}/${year}`;
  ctx.fillStyle="#1a1a1a";ctx.textAlign="center";ctx.textBaseline="middle";
  let tamano=90;
  do {
    ctx.font=`bold ${tamano}px "EcoReporte"`;
    if(ctx.measureText(texto).width<=CAJA_FECHA.w-40 || tamano<=24) break;
    tamano-=2;
  } while(true);
  ctx.fillText(texto,CAJA_FECHA.x+CAJA_FECHA.w/2,CAJA_FECHA.y+CAJA_FECHA.h/2);
  return canvas.toBuffer("image/png");
}
module.exports={generateRiesgoMap,fechaValida,ZONAS,cargarPlantilla,CAJA_FECHA};
