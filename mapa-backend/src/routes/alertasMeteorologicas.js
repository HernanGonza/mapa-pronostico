const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { loadDepartamentos, DEPARTAMENTOS_GEOJSON_PATH } = require('../lib/departamentos');
const { categorias, iconos, errorDeZonas, normalizarZonas, errorDeIconos, normalizarIconos } = require('../lib/alertasMeteorologicas');
const s = require('../lib/alertasMeteorologicasStore');
const placas = require('../lib/placasMeteoStore');
const router = express.Router();
router.get('/alertas-meteorologicas/catalogo', (req,res)=>{
  const { TAMANO_PERIODO_PREDETERMINADO, TAMANO_PERIODO_MIN, TAMANO_PERIODO_MAX, MAX_PERIODO } = require('../lib/generateAlertaMap');
  res.json({departamentos:loadDepartamentos(),categorias,iconos,tamanoPeriodo:{predeterminado:TAMANO_PERIODO_PREDETERMINADO,min:TAMANO_PERIODO_MIN,max:TAMANO_PERIODO_MAX},maxPeriodo:MAX_PERIODO});
});
router.get('/alertas-meteorologicas/geojson',(req,res)=>{res.set('Cache-Control','public,max-age=604800');res.sendFile(DEPARTAMENTOS_GEOJSON_PATH);});
router.get('/alertas-meteorologicas/actual',async(req,res)=>{
  try {res.set('Cache-Control','no-store').json(await s.actual()||{});}catch(e){console.error(e);res.status(503).json({error:'No se pudo leer la publicación.'});}
});
router.post('/alertas-meteorologicas/publicar',requireAuth,express.json(),async(req,res)=>{
  const {zonas,iconos:iconosElegidos=[]}=req.body||{};
  const error=errorDeZonas(zonas)||errorDeIconos(iconosElegidos);if(error)return res.status(400).json({error});
  try{res.json(await s.publicar(normalizarZonas(zonas),normalizarIconos(iconosElegidos),req.usuario.usuarioId));}catch(e){console.error(e);res.status(500).json({error:'No se pudo publicar.'});}
});
// Genera feed + historias en una sola llamada (antes eran dos POST, uno
// por tamaño — eso hacía imposible agrupar ambas imágenes bajo un mismo
// registro de "se generó una placa"). Sube las dos al bucket de Storage
// y graba quién/cuándo/con qué parámetros en alertas_meteo_placas.
router.post('/alertas-meteorologicas/placa',requireAuth,express.json(),async(req,res)=>{
  const {zonas,periodo,fondo,titulo,iconos:iconosElegidos=[],tamanoPeriodo}=req.body||{};
  const { errorDeTitulo, TITULO_PREDETERMINADO, errorDeTamanoPeriodo, TAMANO_PERIODO_PREDETERMINADO, MAX_PERIODO } = require('../lib/generateAlertaMap');
  const tamanoPeriodoFinal = tamanoPeriodo === undefined ? TAMANO_PERIODO_PREDETERMINADO : tamanoPeriodo;
  const error=errorDeZonas(zonas)||errorDeIconos(iconosElegidos)||errorDeTitulo(titulo === undefined ? TITULO_PREDETERMINADO : titulo)||errorDeTamanoPeriodo(tamanoPeriodoFinal);
  if(error||typeof periodo!=='string'||!periodo.trim()||periodo.length>MAX_PERIODO||!['tormenta','nubes'].includes(fondo))return res.status(400).json({error:error||'Revisá período y fondo.'});
  try {
    const {generateAlertaMap}=require('../lib/generateAlertaMap');
    const zonasNorm=normalizarZonas(zonas),iconosNorm=normalizarIconos(iconosElegidos);
    const [feedPng,historiasPng]=await Promise.all([
      generateAlertaMap({zonas:zonasNorm,periodo,fondo,titulo,tamano:'feed',iconos:iconosNorm,tamanoPeriodo:tamanoPeriodoFinal}),
      generateAlertaMap({zonas:zonasNorm,periodo,fondo,titulo,tamano:'historias',iconos:iconosNorm,tamanoPeriodo:tamanoPeriodoFinal}),
    ]);
    const placa=await placas.crear({zonas:zonasNorm,iconos:iconosNorm,periodo,fondo,usuarioId:req.usuario.usuarioId,feedPng,historiasPng});
    res.set('Cache-Control','no-store').json(placa);
  }catch(e){console.error(e);res.status(500).json({error:'No se pudo generar la placa.'});}
});
router.post('/alertas-meteorologicas/recomendaciones',requireAuth,express.json({limit:'8mb'}),async(req,res)=>{
  const { texto, fondo, imagen, titulo } = req.body || {};
  const { generateRecomendaciones, errorDeRecomendaciones } = require('../lib/generateAlertaMap');
  const error = errorDeRecomendaciones(texto, fondo, imagen, titulo);
  if (error) return res.status(400).json({ error });
  try {
    const feedPng = await generateRecomendaciones({ texto, fondo, imagen, titulo, tamano: 'feed' });
    const historiasPng = await generateRecomendaciones({ texto, fondo, imagen, titulo, tamano: 'historias' });
    res.set('Cache-Control','no-store').json(await placas.crearRecomendaciones({ feedPng, historiasPng, fondo }));
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
