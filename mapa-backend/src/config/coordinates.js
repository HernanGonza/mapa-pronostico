/**
 * Coordenadas de cada localidad sobre el mapa base.
 * Traducido 1:1 desde el diccionario `coordinates` del notebook original.
 *
 * X_loc/Y_loc   -> posición del nombre de la localidad
 * X_tmin/Y_tmin -> posición de la temperatura mínima
 * X_tmax/Y_tmax -> posición de la temperatura máxima
 * sep_cordx/y   -> posición del separador "|"
 * img_cordx/y   -> posición del ícono de la condición climática
 */

const LOCALIDADES = [
  "PUERTO IGUAZÚ", "BDO. DE IRIGOYEN", "ELDORADO", "SAN PEDRO",
  "MONTECARLO", "JARDÍN AMÉRICA", "SAN VICENTE", "A. DEL VALLE", "OBERÁ",
  "POSADAS", "L. N. ALEM", "APÓSTOLES", "SAN JAVIER",
];

const X_loc = [835, 1010, 815, 995, 765, 385, 885, 725, 645, 322, 565, 385, 630];
const Y_loc = [55, 335, 385, 486, 450, 655, 630, 675, 835, 790, 885, 1020, 1000];

const X_tmin = [642, 1042, 650, 997, 599, 430, 910, 640, 486, 180, 436, 240, 562];
const Y_tmin = [50, 292, 330, 520, 453, 695, 665, 700, 774, 792, 900, 1020, 1035];

const X_tmax = [725, 1112, 725, 1067, 664, 500, 981, 710, 556, 254, 510, 310, 631];
const Y_tmax = [50, 290, 330, 520, 453, 695, 665, 700, 774, 792, 900, 1020, 1035];

const sep_cordx = [703, 1090, 702, 1049, 648, 479, 960, 690, 536, 232, 487, 292, 612];
const sep_cordy = [53, 294, 332, 520, 455, 697, 668, 704, 776, 794, 903, 1022, 1037];

const img_cordx = [770, 1130, 768, 960, 665, 470, 870, 650, 590, 255, 450, 330, 515];
const img_cordy = [0, 270, 317, 416, 395, 585, 550, 600, 770, 726, 832, 950, 935];

const coordinates = LOCALIDADES.map((LOCALIDAD, i) => ({
  LOCALIDAD,
  X_loc: X_loc[i],
  Y_loc: Y_loc[i],
  X_tmin: X_tmin[i],
  Y_tmin: Y_tmin[i],
  X_tmax: X_tmax[i],
  Y_tmax: Y_tmax[i],
  sep: "|",
  sep_cordx: sep_cordx[i],
  sep_cordy: sep_cordy[i],
  img_cordx: img_cordx[i],
  img_cordy: img_cordy[i],
}));

module.exports = coordinates;
