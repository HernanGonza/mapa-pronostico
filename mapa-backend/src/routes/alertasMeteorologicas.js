const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { loadDepartamentos, DEPARTAMENTOS_GEOJSON_PATH } = require('../lib/departamentos');
const { categorias, iconos, errorDeZonas, normalizarZonas, errorDeIconos, normalizarIconos } = require('../lib/alertasMeteorologicas');
const s = require('../lib/alertasMeteorologicasStore');
const placas = require('../lib/placasMeteoStore');
const router = express.Router();
router.get('/alertas-meteorologicas/catalogo', (req,res)=>res.json({departamentos:loadDepartamentos(),categorias,iconos}));
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
  const {zonas,periodo,fondo,iconos:iconosElegidos=[]}=req.body||{};
  const error=errorDeZonas(zonas)||errorDeIconos(iconosElegidos);
  if(error||typeof periodo!=='string'||!periodo.trim()||periodo.length>140||!['tormenta','nubes'].includes(fondo))return res.status(400).json({error:error||'Revisá período y fondo.'});
  try {
    const {generateAlertaMap}=require('../lib/generateAlertaMap');
    const zonasNorm=normalizarZonas(zonas),iconosNorm=normalizarIconos(iconosElegidos);
    const [feedPng,historiasPng]=await Promise.all([
      generateAlertaMap({zonas:zonasNorm,periodo,fondo,tamano:'feed',iconos:iconosNorm}),
      generateAlertaMap({zonas:zonasNorm,periodo,fondo,tamano:'historias',iconos:iconosNorm}),
    ]);
    const placa=await placas.crear({zonas:zonasNorm,iconos:iconosNorm,periodo,fondo,usuarioId:req.usuario.usuarioId,feedPng,historiasPng});
    res.set('Cache-Control','no-store').json(placa);
  }catch(e){console.error(e);res.status(500).json({error:'No se pudo generar la placa.'});}
});
router.post('/alertas-meteorologicas/recomendaciones',requireAuth,express.json(),async(req,res)=>{
  const { texto, fondo } = req.body || {};
  const { generateRecomendaciones, errorDeRecomendaciones } = require('../lib/generateAlertaMap');
  const error = errorDeRecomendaciones(texto, fondo);
  if (error) return res.status(400).json({ error });
  try {
    const feedPng = await generateRecomendaciones({ texto, fondo, tamano: 'feed' });
    const historiasPng = await generateRecomendaciones({ texto, fondo, tamano: 'historias' });
    res.set('Cache-Control','no-store').json(await placas.crearRecomendaciones({ feedPng, historiasPng, fondo }));
  } catch (e) {
    console.error(e);
    res.status(e.status === 400 ? 400 : 500).json({ error: e.status === 400 ? e.message : 'No se pudieron generar las recomendaciones.' });
  }
});
module.exports=router;
