const path = require('path');
const { registerFont } = require('canvas');

// Oak Sans (brandbook) para todas las placas que se dibujan con node-canvas.
// Se registra UNA sola vez y con su nombre real. node-canvas sólo respeta el
// ÚLTIMO nombre con que se registra una misma tipografía: cuando cada generador
// la registraba con un alias propio (AlertaPlaca, EcoReporte, AvisoCortoPlazoPlaca…),
// el que se cargaba después (ej. el mapa de riesgo, la primera vez que se generaba)
// dejaba a los demás con la letra de reemplazo — monoespaciada en el servidor, que
// se sale de los recuadros. Probarlo: registrar el mismo .ttf con dos alias y medir
// un texto con el primero.
//
// Un solo par de archivos (data/alertas, versión 1.0): data/ecosotat trae la 2.0,
// que con el mismo nombre de familia volvería a competir con esta.
const DIR = path.join(__dirname, '../../data/alertas');
registerFont(path.join(DIR, 'OakSans-Regular.ttf'), { family: 'Oak Sans' });
registerFont(path.join(DIR, 'OakSans-Bold.ttf'), { family: 'Oak Sans', weight: 'bold' });
// La ExtraBold, para títulos: otro archivo, así que lleva familia propia sin pisar a la de arriba.
registerFont(path.join(DIR, 'aviso-especial', 'OakSans-ExtraBold.ttf'), { family: 'Oak Sans Titulo', weight: 'bold' });

/** Para armar `ctx.font`, ej. `bold 38px ${OAK_SANS}`. */
const OAK_SANS = '"Oak Sans"';
/** Títulos de placa (Oak Sans ExtraBold), siempre con `bold`: `bold 120px ${OAK_SANS_TITULO}`. */
const OAK_SANS_TITULO = '"Oak Sans Titulo"';

module.exports = { OAK_SANS, OAK_SANS_TITULO };
