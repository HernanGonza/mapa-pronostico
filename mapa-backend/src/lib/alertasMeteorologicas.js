const { loadDepartamentos } = require('./departamentos');
// Colores calcados de "NIVELES DE ALERTA.svg" (Placas-Alertas-Separadas/) —
// tienen que ser EXACTAMENTE estos, así el mapa (departamentos) coincide
// pixel a pixel con el cuadro de referencias de la placa.
const categorias = [
  {nombre:'Verde',color:'#7AD5B0',accion:'Tranquilidad',descripcion:'No se esperan fenómenos meteorológicos que impliquen riesgos.'},
  {nombre:'Amarillo',color:'#F7DC8A',accion:'Informate',descripcion:'Posibles fenómenos meteorológicos con capacidad de daño y riesgo de interrupción momentánea de actividades cotidianas.'},
  {nombre:'Naranja',color:'#F4953D',accion:'Preparate',descripcion:'Se esperan fenómenos meteorológicos peligrosos para la sociedad, la vida, los bienes y el medio ambiente.'},
  {nombre:'Rojo',color:'#DB5461',accion:'Seguí instrucciones oficiales',descripcion:'Se esperan fenómenos meteorológicos excepcionales con potencial de provocar emergencias o desastres.'},
];
// ids = nombre de archivo en data/alertas/ (sin extensión).
const iconos = [{id:'tormentas-severas',nombre:'Tormentas severas'},{id:'vientos-fuertes',nombre:'Vientos fuertes'},{id:'granizo',nombre:'Granizo'},{id:'inundacion',nombre:'Inundación'},{id:'lluvias-intensas',nombre:'Lluvias intensas'}];
function errorDeZonas(zonas) {
  const ids = new Set(loadDepartamentos().map(d => String(d.id)));
  if (!Array.isArray(zonas) || zonas.length !== ids.size || new Set(zonas.map(z => String(z?.id))).size !== ids.size) return 'Completá los 17 departamentos, sin repetir zonas.';
  for (const z of zonas) {
    if (!z || !ids.has(String(z.id)) || !categorias.some(c => c.nombre === z.categoria)) return 'Departamento o color inválido.';
  }
  return null;
}
const normalizarZonas = zonas => zonas.map(z => ({id:String(z.id),categoria:z.categoria}));
// Selección global de fenómenos para la placa (no por departamento): cada
// uno con el color (uno de los 4 niveles) que se usa para el subrayado.
function errorDeIconos(iconos_) {
  if (!Array.isArray(iconos_) || iconos_.length > iconos.length || new Set(iconos_.map(i => i?.id)).size !== iconos_.length) return 'Los iconos seleccionados no son válidos.';
  for (const i of iconos_) {
    if (!i || !iconos.some(c => c.id === i.id) || !categorias.some(c => c.nombre === i.categoria)) return 'Icono o color inválido.';
  }
  return null;
}
const normalizarIconos = iconos_ => iconos_.map(i => ({id:i.id,categoria:i.categoria}));
module.exports = { categorias, iconos, errorDeZonas, normalizarZonas, errorDeIconos, normalizarIconos };
