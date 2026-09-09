const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');
const { categorias, iconos, errorDeZonas } = require('./alertasMeteorologicas');
const DIR = path.join(__dirname, '../../data/alertas');
const ZONAS = [[10,'4'],[20,'3'],[30,'1'],[40,'11'],[50,'5'],[60,'15'],[70,'14'],[80,'13'],[90,'2'],[100,'10'],[110,'17'],[120,'8'],[130,'12'],[140,'16'],[150,'6'],[160,'9'],[170,'7']];
const cache = new Map();
async function plantilla(nombre) {
  if (!cache.has(nombre)) cache.set(nombre, (async () => {
    registerFont(path.join(__dirname, '../../data/ecosotat/OakSans-Regular.ttf'), {family:'AlertaPlaca'});
    registerFont(path.join(__dirname, '../../data/ecosotat/OakSans-Bold.ttf'), {family:'AlertaPlaca',weight:'bold'});
    const image = await loadImage(path.join(DIR, `${nombre}.png`));
    const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d'); ctx.drawImage(image,0,0);
    const w=image.width, h=image.height, pixels=ctx.getImageData(0,0,w,h).data, visited=new Uint8Array(w*h), masks=new Map();
    const grayAt = i => { const j=i*4,r=pixels[j]; return r>=10&&r<=170&&r%10===0&&pixels[j+1]===r&&pixels[j+2]===r?r:-1; };
    // Sólo la región conexa mayor de cada gris dentro del mapa, nunca logos/fondo.
    const minX=Math.floor(w*.17), maxX=Math.ceil(w*.93), minY=Math.floor(h*.14), maxY=Math.ceil(h*.865);
    for(let y=minY;y<maxY;y++) for(let x=minX;x<maxX;x++) {
      const i=y*w+x; if(visited[i]) continue; visited[i]=1;
      const gray=grayAt(i); if(gray<0)continue; const region=[i];
      for(let k=0;k<region.length;k++) {
        const p=region[k],px=p%w,py=Math.floor(p/w);
        for(const n of [px>minX?p-1:-1,px<maxX-1?p+1:-1,py>minY?p-w:-1,py<maxY-1?p+w:-1]) {
          if(n<0||visited[n]||grayAt(n)!==gray)continue;visited[n]=1;region.push(n);
        }
      }
      if(region.length>(masks.get(gray)?.length||0))masks.set(gray,Uint32Array.from(region));
    }
    for(const [gray] of ZONAS)if((masks.get(gray)?.length||0)<1000)throw new Error(`No se encontró la zona ${gray} de la plantilla`);
    const labels=new Map();
    for(const [gray] of ZONAS){
      let left=w,top=h,right=0,bottom=0;for(const i of masks.get(gray)){const x=i%w,y=Math.floor(i/w);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
      const points=[];for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){const i=y*w+x,j=i*4;if(pixels[j]===gray+1&&pixels[j+1]===gray+1&&pixels[j+2]===gray+1)points.push(i);}labels.set(gray,Uint32Array.from(points));
    }
    const symbols = Object.fromEntries(await Promise.all(iconos.map(async i=>[i.id,await loadImage(path.join(DIR,`${i.id}.png`))])));
    return {image,masks,labels,symbols};
  })().catch(e=>{cache.delete(nombre);throw e;}));
  return cache.get(nombre);
}
async function generateAlertaMap({zonas,periodo='Próximas 24 horas',fondo='tormenta'}) {
  const error=errorDeZonas(zonas);if(error)throw new Error(error);
  if(!['tormenta','nubes'].includes(fondo)||typeof periodo!=='string'||!periodo.trim()||periodo.length>60)throw new Error('Período o fondo inválido.');
  const {image,masks,labels,symbols}=await plantilla(fondo), canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');
  ctx.drawImage(image,0,0);const frame=ctx.getImageData(0,0,canvas.width,canvas.height);
  const byId=new Map(zonas.map(z=>[String(z.id),z]));const colors=new Map(categorias.map(c=>[c.nombre,c.color]));
  for(const [gray,id] of ZONAS) {
    const hex=colors.get(byId.get(id).categoria), rgb=[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16));
    for(const i of masks.get(gray))frame.data.set(rgb,i*4);
    const ink=byId.get(id).categoria==='Rojo'?[255,255,255]:[20,35,29];
    for(const i of labels.get(gray))frame.data.set(ink,i*4);
  }
  ctx.putImageData(frame,0,0);
  // Coordenadas normalizadas a la plantilla original de 2250 × 2813.
  ctx.save();ctx.scale(canvas.width/2250,canvas.height/2813);
  // Caja blanca común a las dos variantes; tapa el texto "Próximas" de la primera.
  ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(165,305,875,169,80);ctx.fill();
  ctx.fillStyle='#171717';ctx.font='bold 44px AlertaPlaca';ctx.fillText(periodo.trim(),255,426,700);
  // La referencia original decía Bajo/Moderado/Alto/Muy Alto: se reemplaza por SAT.
  ctx.fillStyle='#33383c';ctx.beginPath();ctx.roundRect(150,1244,635,247,55);ctx.fill();
  ctx.fillStyle='#fff';ctx.font='bold 32px AlertaPlaca';ctx.fillText('NIVELES DE ALERTA',195,1293);
  categorias.forEach((c,i)=>{
    const y=1332+i*39;ctx.fillStyle=c.color;ctx.beginPath();ctx.arc(210,y-8,12,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='24px AlertaPlaca';ctx.fillText(`${c.nombre} · ${c.accion}`,237,y,510);
  });
  const used=iconos.filter(icon=>zonas.some(z=>(z.iconos||[]).includes(icon.id)));
  used.forEach((icon,index)=> {
    const y=1510+index*80;
    ctx.drawImage(symbols[icon.id],0,0,350,324,165,y,86,80);
    ctx.fillStyle='#fff';ctx.font='bold 24px AlertaPlaca';ctx.fillText(icon.nombre,270,y+27);
    const levels=categorias.filter(c=>zonas.some(z=>z.categoria===c.nombre&&(z.iconos||[]).includes(icon.id)));
    const width=280/Math.max(1,levels.length);
    levels.forEach((c,n)=>{ctx.fillStyle=c.color;ctx.fillRect(270+n*width,y+46,width-6,13);});
  });
  ctx.restore();return canvas.toBuffer('image/png');
}
module.exports={generateAlertaMap};
