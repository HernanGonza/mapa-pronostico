const { loadDepartamentos } = require('./departamentos');
const categorias = [
  {nombre:'Verde',color:'#07BE83',accion:'Tranquilidad',descripcion:'No se esperan fenómenos meteorológicos que impliquen riesgos.'},
  {nombre:'Amarillo',color:'#FFCC35',accion:'Informate',descripcion:'Posibles fenómenos meteorológicos con capacidad de daño y riesgo de interrupción momentánea de actividades cotidianas.'},
  {nombre:'Naranja',color:'#F67F15',accion:'Preparate',descripcion:'Se esperan fenómenos meteorológicos peligrosos para la sociedad, la vida, los bienes y el medio ambiente.'},
  {nombre:'Rojo',color:'#D62E42',accion:'Seguí instrucciones oficiales',descripcion:'Se esperan fenómenos meteorológicos excepcionales con potencial de provocar emergencias o desastres.'},
];
const iconos = [{id:'tormentas',nombre:'Tormentas'},{id:'vientos',nombre:'Vientos'},{id:'lluvias',nombre:'Lluvias'},{id:'inundaciones',nombre:'Inundaciones'}];
function errorDeZonas(zonas) {
  const ids = new Set(loadDepartamentos().map(d => String(d.id)));
  if (!Array.isArray(zonas) || zonas.length !== ids.size || new Set(zonas.map(z => String(z?.id))).size !== ids.size) return 'Completá los 17 departamentos, sin repetir zonas.';
  for (const z of zonas) {
    if (!z || !ids.has(String(z.id)) || !categorias.some(c => c.nombre === z.categoria)) return 'Departamento o color inválido.';
    if (z.iconos !== undefined && (!Array.isArray(z.iconos) || z.iconos.length > iconos.length || new Set(z.iconos).size !== z.iconos.length || z.iconos.some(i => !iconos.some(c => c.id === i)))) return 'Los iconos seleccionados no son válidos.';
  }
  return null;
}
const normalizarZonas = zonas => zonas.map(z => ({id:String(z.id),categoria:z.categoria,iconos:z.iconos || []}));
module.exports = { categorias, iconos, errorDeZonas, normalizarZonas };
