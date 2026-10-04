const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { loadDepartamentos, DEPARTAMENTOS_GEOJSON_PATH } = require('../lib/departamentos');
const { categorias, iconos, errorDeZonas, normalizarZonas, errorDeIconos, normalizarIconos } = require('../lib/alertasMeteorologicas');
const s = require('../lib/alertasMeteorologicasStore');
const placas = require('../lib/placasMeteoStore');
const placasAlerta = require('../lib/placasAlertaStore');
const router = express.Router();
router.get('/alertas-meteorologicas/catalogo', (req,res)=>{
  const { TAMANO_PERIODO_PREDETERMINADO, TAMANO_PERIODO_MIN, TAMANO_PERIODO_MAX, MAX_PERIODO } = require('../lib/generateAlertaMap');
  res.json({departamentos:loadDepartamentos(),categorias,iconos,tamanoPeriodo:{predeterminado:TAMANO_PERIODO_PREDETERMINADO,min:TAMANO_PERIODO_MIN,max:TAMANO_PERIODO_MAX},maxPeriodo:MAX_PERIODO});
});
router.get('/alertas-meteorologicas/geojson',(req,res)=>{res.set('Cache-Control','public,max-age=604800');res.sendFile(DEPARTAMENTOS_GEOJSON_PATH);});
router.get('/alertas-meteorologicas/actual',async(req,res)=>{
  try {res.set('Cache-Control','no-store').json(await s.actual()||{});}catch(e){console.error(e);res.status(503).json({error:'No se pudo leer la publicación.'});}
});
// Publica el mapa en el embebido, para `periodo` (para cuándo es) y hasta
// `vigenteHasta` (ISO; después se saca solo). `reemplazar`: ids de publicaciones
// vigentes que ésta reemplaza. `enFilaDe`: id de una vigente (o en fila); ésta
// aparece recién cuando aquélla vence o se despublica.
router.post('/alertas-meteorologicas/publicar',requireAuth,express.json(),async(req,res)=>{
  const {zonas,iconos:iconosElegidos=[],vigenteHasta,periodo,reemplazar=[],enFilaDe=null}=req.body||{};
  const error=errorDeZonas(zonas)||errorDeIconos(iconosElegidos)||s.errorDePublicacion({vigenteHasta,periodo,reemplazar,enFilaDe});if(error)return res.status(400).json({error});
  try{res.json(await s.publicar(normalizarZonas(zonas),normalizarIconos(iconosElegidos),req.usuario.usuarioId,{vigenteHasta,periodo,reemplazar,enFilaDe}));}catch(e){if(e.status===409)return res.status(409).json({error:e.message});console.error(e);res.status(500).json({error:'No se pudo publicar.'});}
});
// Público: las publicaciones vigentes (lo que muestra el embebido). [] = ninguna.
router.get('/alertas-meteorologicas/vigentes',async(req,res)=>{
  try{res.set('Cache-Control','no-store').json({publicaciones:await s.vigentes()});}catch(e){console.error(e);res.status(503).json({error:'No se pudieron leer las alertas vigentes.'});}
});
// Panel: las vigentes y las que esperan en fila.
router.get('/alertas-meteorologicas/pendientes',requireAuth,async(req,res)=>{
  try{
    const {vigentes,enFila}=await s.pendientes();
    // Cada una con sus placas (actualización de vigencia, recomendaciones, aviso de alerta).
    const placasDe=await placasAlerta.dePublicaciones([...vigentes,...enFila].map(x=>x.id)).catch(e=>{console.error(e);return {};});
    const conPlacas=x=>({...x,placas:placasDe[x.id]||[]});
    res.set('Cache-Control','no-store').json({vigentes:vigentes.map(conPlacas),enFila:enFila.map(conPlacas)});
  }catch(e){console.error(e);res.status(503).json({error:'No se pudieron leer las alertas publicadas.'});}
});
// Fija una publicada (o en fila) en el embebido: se ve sólo ésa mientras esté vigente. id null = automático.
router.post('/alertas-meteorologicas/fijada',requireAuth,express.json(),async(req,res)=>{
  const id=req.body?.id;
  if(id!==null&&(!Number.isInteger(id)||id<=0))return res.status(400).json({error:'Id inválido.'});
  try{await s.fijar(id,req.usuario.usuarioId);res.json({ok:true});}
  catch(e){if(!e.status)console.error(e);const st=[404,503].includes(e.status)?e.status:500;res.status(st).json({error:st===500?'No se pudo cambiar lo que se ve en el mapa público.':e.message});}
});
// Cambia hasta cuándo se ve una publicada (o en fila); su mapa no cambia. Las de detrás en la fila se corren igual.
router.post('/alertas-meteorologicas/publicaciones/:id/vigencia',requireAuth,express.json(),async(req,res)=>{
  const id=Number(req.params.id);
  if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:'Id inválido.'});
  try{await s.cambiarVigencia(id,req.body?.vigenteHasta,req.usuario.usuarioId);res.json({ok:true});}
  catch(e){if(!e.status)console.error(e);const st=[400,404].includes(e.status)?e.status:500;res.status(st).json({error:st===500?'No se pudo cambiar la vigencia.':e.message});}
});
// Placas de una alerta publicada: actualización de vigencia, recomendaciones o aviso de alerta
// (ver generatePlacasAlerta). Mismo flujo que las demás placas: vista previa y después confirmar.
router.post('/alertas-meteorologicas/publicaciones/:id/placas',requireAuth,express.json({limit:'4mb'}),async(req,res)=>{
  const id=Number(req.params.id);
  if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:'Id inválido.'});
  const {generarPlacaAlertaAmbos,errorDePlacaAlerta,normalizarPlacaAlerta}=require('../lib/generatePlacasAlerta');
  // `reemplaza`: id de una placa de esta alerta que se está editando (se reemplaza al confirmar).
  const {tipo,nivel,datos,reemplaza=null}=req.body||{};
  const error=(tipo==='mapa'?errorDePlacaMapa(datos):errorDePlacaAlerta({tipo,nivel,datos}))||(reemplaza!==null&&(!Number.isInteger(reemplaza)||reemplaza<=0)?'Placa a editar inválida.':null);
  if(error)return res.status(400).json({error});
  try{
    const {vigentes,enFila}=await s.pendientes();
    if(![...vigentes,...enFila].some(x=>x.id===id))return res.status(404).json({error:'Esa alerta ya no está publicada.'});
    const placa=tipo==='mapa'?normalizarPlacaMapa(datos):normalizarPlacaAlerta({tipo,nivel,datos});
    await require('../lib/placasPendientes').resolver(req,res,{
      generar:()=>tipo==='mapa'?generarPlacaMapa(placa.datos):generarPlacaAlertaAmbos(placa),
      guardar:(pngs)=>reemplaza
        ?placasAlerta.reemplazar({id:reemplaza,publicacionId:id,...placa,usuarioId:req.usuario.usuarioId,...pngs})
        :placasAlerta.crear({publicacionId:id,...placa,usuarioId:req.usuario.usuarioId,...pngs}),
    });
  }catch(e){if(!e.status)console.error(e);const st=[400,404,503].includes(e.status)?e.status:500;res.status(st).json({error:st===500?'No se pudo generar la placa.':e.message});}
});
// Historial de una alerta (cambios de vigencia, fijar, despublicar, placas): para el histórico.
router.get('/alertas-meteorologicas/publicaciones/:id/eventos',requireAuth,async(req,res)=>{
  const id=Number(req.params.id);
  if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:'Id inválido.'});
  try{res.set('Cache-Control','no-store').json({eventos:await s.eventos(id)});}catch(e){console.error(e);res.status(500).json({error:'No se pudo leer el historial.'});}
});
// «Crear placa para redes» de una alerta: la placa del mapa (generateAlertaMap), guardada como una
// placa más de la tarjeta (tipo 'mapa'). `datos`: { zonas, iconos, periodo, fondo, tamanoPeriodo } (el título es fijo).
function errorDePlacaMapa(d){
  const { errorDeTamanoPeriodo, TAMANO_PERIODO_PREDETERMINADO, MAX_PERIODO } = require('../lib/generateAlertaMap');
  if(!d||typeof d!=='object')return 'Faltan los datos de la placa.';
  return errorDeZonas(d.zonas)||errorDeIconos(d.iconos||[])
    ||errorDeTamanoPeriodo(d.tamanoPeriodo===undefined?TAMANO_PERIODO_PREDETERMINADO:d.tamanoPeriodo)
    ||(typeof d.periodo!=='string'||!d.periodo.trim()||d.periodo.length>MAX_PERIODO||!['tormenta','nubes'].includes(d.fondo)?'Revisá período y fondo.':null);
}
const ORDEN_NIVEL={Verde:0,Amarillo:1,Naranja:2,Rojo:3};
function normalizarPlacaMapa(d){
  const { TAMANO_PERIODO_PREDETERMINADO } = require('../lib/generateAlertaMap');
  const zonas=normalizarZonas(d.zonas),iconos=normalizarIconos(d.iconos||[]);
  // El nivel de la placa (para su color en la tarjeta): el más alto de los departamentos.
  const nivel=zonas.map(z=>z.categoria).reduce((a,b)=>(ORDEN_NIVEL[b]||0)>(ORDEN_NIVEL[a]||0)?b:a,'Verde');
  return {tipo:'mapa',nivel,datos:{zonas,iconos,periodo:d.periodo,fondo:d.fondo,tamanoPeriodo:d.tamanoPeriodo===undefined?TAMANO_PERIODO_PREDETERMINADO:d.tamanoPeriodo}};
}
async function generarPlacaMapa(d){
  const {generateAlertaMap}=require('../lib/generateAlertaMap');
  const [feedPng,historiasPng]=await Promise.all(['feed','historias'].map(tamano=>generateAlertaMap({...d,tamano})));
  return {feedPng,historiasPng};
}
// Saca una placa de la tarjeta de su alerta (queda en la base). No la borra de las redes.
router.delete('/alertas-meteorologicas/placas/:id',requireAuth,async(req,res)=>{
  const id=Number(req.params.id);
  if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:'Id inválido.'});
  try{await placasAlerta.eliminar(id,req.usuario.usuarioId);res.json({ok:true});}
  catch(e){if(!e.status)console.error(e);const st=[404,503].includes(e.status)?e.status:500;res.status(st).json({error:st===500?'No se pudo eliminar la placa.':e.message});}
});
// Con qué arrancar cada placa: lo último que se usó (o las recomendaciones de siempre) y los íconos dibujados.
router.get('/alertas-meteorologicas/placas/ultimos',requireAuth,async(req,res)=>{
  const {RECOMENDACIONES_PREDETERMINADAS,ICONOS,LIMITES}=require('../lib/generatePlacasAlerta');
  const ultimos=await placasAlerta.ultimosDatos().catch(e=>{console.error(e);return {};});
  res.set('Cache-Control','no-store').json({ultimos,recomendaciones:RECOMENDACIONES_PREDETERMINADAS,iconos:ICONOS,limites:LIMITES});
});
// Íconos dibujados, como PNG, para elegirlos en el panel.
router.get('/alertas-meteorologicas/placas/iconos/:nombre.png',(req,res)=>{
  const {ICONOS}=require('../lib/generatePlacasAlerta');
  if(!ICONOS.includes(req.params.nombre))return res.status(404).end();
  const {createCanvas}=require('canvas');const {dibujarIcono}=require('../lib/iconosPlaca');
  const c=createCanvas(160,160),ctx=c.getContext('2d');ctx.fillStyle='#24324a';ctx.fillRect(0,0,160,160);
  dibujarIcono(ctx,req.params.nombre,20,20,120,'#fff');
  res.set('Cache-Control','public,max-age=3600').type('png').send(c.toBuffer('image/png'));
});
router.post('/alertas-meteorologicas/publicaciones/:id/despublicar',requireAuth,async(req,res)=>{
  const id=Number(req.params.id);
  if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:'Id inválido.'});
  try{await s.despublicar(id,req.usuario.usuarioId);res.json({ok:true});}catch(e){if(!e.status)console.error(e);res.status(e.status===404?404:500).json({error:e.status===404?e.message:'No se pudo despublicar.'});}
});
// Genera feed + historias en una sola llamada (antes eran dos POST, uno
// por tamaño — eso hacía imposible agrupar ambas imágenes bajo un mismo
// registro de "se generó una placa"). Sube las dos al bucket de Storage
// y graba quién/cuándo/con qué parámetros en alertas_meteo_placas.
router.post('/alertas-meteorologicas/placa',requireAuth,express.json(),async(req,res)=>{
  const {zonas,periodo,fondo,iconos:iconosElegidos=[],tamanoPeriodo}=req.body||{};
  const { errorDeTamanoPeriodo, TAMANO_PERIODO_PREDETERMINADO, MAX_PERIODO } = require('../lib/generateAlertaMap');
  const tamanoPeriodoFinal = tamanoPeriodo === undefined ? TAMANO_PERIODO_PREDETERMINADO : tamanoPeriodo;
  const error=errorDeZonas(zonas)||errorDeIconos(iconosElegidos)||errorDeTamanoPeriodo(tamanoPeriodoFinal);
  if(error||typeof periodo!=='string'||!periodo.trim()||periodo.length>MAX_PERIODO||!['tormenta','nubes'].includes(fondo))return res.status(400).json({error:error||'Revisá período y fondo.'});
  try {
    const {generateAlertaMap}=require('../lib/generateAlertaMap');
    const zonasNorm=normalizarZonas(zonas),iconosNorm=normalizarIconos(iconosElegidos);
    await require('../lib/placasPendientes').resolver(req,res,{
      generar:async()=>{const [feedPng,historiasPng]=await Promise.all([
        generateAlertaMap({zonas:zonasNorm,periodo,fondo,tamano:'feed',iconos:iconosNorm,tamanoPeriodo:tamanoPeriodoFinal}),
        generateAlertaMap({zonas:zonasNorm,periodo,fondo,tamano:'historias',iconos:iconosNorm,tamanoPeriodo:tamanoPeriodoFinal}),
      ]);return {feedPng,historiasPng};},
      guardar:(pngs)=>placas.crear({zonas:zonasNorm,iconos:iconosNorm,periodo,fondo,usuarioId:req.usuario.usuarioId,...pngs}),
    });
  }catch(e){console.error(e);res.status(500).json({error:'No se pudo generar la placa.'});}
});
router.post('/alertas-meteorologicas/recomendaciones',requireAuth,express.json({limit:'8mb'}),async(req,res)=>{
  const { texto, fondo, imagen } = req.body || {};
  const { generateRecomendaciones, errorDeRecomendaciones } = require('../lib/generateAlertaMap');
  const error = errorDeRecomendaciones(texto, fondo, imagen);
  if (error) return res.status(400).json({ error });
  try {
    await require('../lib/placasPendientes').resolver(req,res,{
      generar:async()=>({feedPng:await generateRecomendaciones({ texto, fondo, imagen, tamano: 'feed' }),historiasPng:await generateRecomendaciones({ texto, fondo, imagen, tamano: 'historias' })}),
      guardar:(pngs)=>placas.crearRecomendaciones({ ...pngs, fondo }),
    });
  } catch (e) {
    console.error(e);
    res.status([400,503].includes(e.status) ? e.status : 500).json({ error: [400,503].includes(e.status) ? e.message : 'No se pudieron generar o guardar las recomendaciones. Revisá el registro del backend.' });
  }
});
router.use((err,req,res,next)=>{
  if(err.type==='entity.too.large')return res.status(413).json({error:'La imagen es demasiado grande. El máximo es 5 MB.'});
  if(err.type==='entity.parse.failed')return res.status(400).json({error:'El contenido enviado no es válido.'});
  next(err);
});
module.exports=router;
