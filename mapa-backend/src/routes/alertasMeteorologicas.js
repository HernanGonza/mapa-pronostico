const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { loadDepartamentos, DEPARTAMENTOS_GEOJSON_PATH } = require('../lib/departamentos');
const { categorias, iconos, errorDeZonas, normalizarZonas } = require('../lib/alertasMeteorologicas');
const s = require('../lib/alertasMeteorologicasStore');
const router = express.Router();
router.get('/alertas-meteorologicas/catalogo', (req,res)=>res.json({departamentos:loadDepartamentos(),categorias,iconos}));
router.get('/alertas-meteorologicas/geojson',(req,res)=>{res.set('Cache-Control','public,max-age=604800');res.sendFile(DEPARTAMENTOS_GEOJSON_PATH);});
router.get('/alertas-meteorologicas/actual',async(req,res)=>{
  try {res.set('Cache-Control','no-store').json(await s.actual()||{});}catch(e){console.error(e);res.status(503).json({error:'No se pudo leer la publicación.'});}
});
router.post('/alertas-meteorologicas/publicar',requireAuth,express.json(),async(req,res)=>{
  const error=errorDeZonas(req.body?.zonas);if(error)return res.status(400).json({error});
  try{res.json(await s.publicar(normalizarZonas(req.body.zonas)));}catch(e){console.error(e);res.status(500).json({error:'No se pudo publicar.'});}
});
router.post('/alertas-meteorologicas/render-png',requireAuth,express.json(),async(req,res)=>{
  const {zonas,periodo,fondo}=req.body||{};const error=errorDeZonas(zonas);
  if(error||typeof periodo!=='string'||!periodo.trim()||periodo.length>60||!['tormenta','nubes'].includes(fondo))return res.status(400).json({error:error||'Revisá período y fondo.'});
  try {const {generateAlertaMap}=require('../lib/generateAlertaMap');const png=await generateAlertaMap({zonas:normalizarZonas(zonas),periodo,fondo});
    res.set('Cache-Control','no-store').set('Content-Disposition','attachment; filename="alerta-meteorologica.png"').type('png').send(png);
  }catch(e){console.error(e);res.status(500).json({error:'No se pudo generar la placa.'});}
});
module.exports=router;
