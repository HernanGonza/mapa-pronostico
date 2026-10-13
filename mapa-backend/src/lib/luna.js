/**
 * La luna por municipio y fecha: a qué hora sale y a qué hora se pone (hora argentina) y en qué fase está.
 * Se calcula en el server con SunCalc (astronomía, sin red): no depende de ninguna API ni puede fallar por
 * eso. Es el complemento de solar.js (amanecer/anochecer), que sí consulta a Sunrise-Sunset.
 */
const SunCalc = require("suncalc");
const { loadMunicipios } = require("./municipios");

const TZ = "America/Argentina/Buenos_Aires";
const OFFSET = "-03:00"; // Argentina no usa horario de verano.
const RAD = Math.PI / 180;
const UMBRAL = 0.133 * RAD; // la luna «sale» cuando su borde superior toca el horizonte (paralaje + semidiámetro)
const hora = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fechaHoyART = () => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());

// Las ocho fases, en orden de 0 a 1 del ciclo lunar. `icono`: archivo de /iconos del front.
const FASES = [
  { id: "nueva", nombre: "Luna nueva", icono: "moon-new" },
  { id: "creciente", nombre: "Luna creciente", icono: "moon-waxing-crescent" },
  { id: "cuarto-creciente", nombre: "Cuarto creciente", icono: "moon-first-quarter" },
  { id: "gibosa-creciente", nombre: "Gibosa creciente", icono: "moon-waxing-gibbous" },
  { id: "llena", nombre: "Luna llena", icono: "moon-full" },
  { id: "gibosa-menguante", nombre: "Gibosa menguante", icono: "moon-waning-gibbous" },
  { id: "cuarto-menguante", nombre: "Cuarto menguante", icono: "moon-last-quarter" },
  { id: "menguante", nombre: "Luna menguante", icono: "moon-waning-crescent" },
];
/** `ciclo`: 0 = nueva, 0,25 = cuarto creciente, 0,5 = llena, 0,75 = cuarto menguante. */
const faseDe = (ciclo) => FASES[Math.floor(((ciclo % 1) + 1) % 1 * 8 + 0.5) % 8];

/** Primera salida y primera puesta de la luna dentro del día `fecha` (de 00:00 a 24:00 hora argentina). */
function salidaYPuesta(lat, lng, fecha) {
  const inicio = Date.parse(`${fecha}T00:00:00${OFFSET}`);
  const altura = (min) => SunCalc.getMoonPosition(new Date(inicio + min * 60000), lat, lng).altitude - UMBRAL;
  let sale = null, sePone = null, previa = altura(0);
  for (let min = 1; min <= 1440 && (!sale || !sePone); min++) {
    const actual = altura(min);
    if (previa < 0 && actual >= 0 && !sale) sale = new Date(inicio + min * 60000);
    if (previa >= 0 && actual < 0 && !sePone) sePone = new Date(inicio + min * 60000);
    previa = actual;
  }
  // El instante del cruce se redondea al minuto; el día termina a las 24:00 y cuenta el minuto 1440 como del día siguiente.
  const aTexto = (d) => (d && d.getTime() < inicio + 1440 * 60000 ? hora.format(d) : null);
  return { sale: aTexto(sale), sePone: aTexto(sePone) };
}

const cache = new Map(); // "municipioId|fecha" → datos (no cambian: es astronomía)
const MAX_ENTRADAS = 2000;

/**
 * { sale: "22:10"|null, sePone: "11:05"|null, fase: "Cuarto creciente", faseId, icono, iluminacion: 52 }
 * o null si el municipio o la fecha no existen. `sale`/`sePone` son null si ese día la luna no cruza el horizonte.
 */
function lunaDeMunicipio(municipioId, fecha = fechaHoyART()) {
  fecha = String(fecha).slice(0, 10);
  const municipio = loadMunicipios().find((m) => m.id === municipioId);
  if (!municipio || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) return null;
  const clave = `${municipio.id}|${fecha}`;
  if (cache.has(clave)) return cache.get(clave);

  const mediodia = new Date(`${fecha}T12:00:00${OFFSET}`); // la fase del día se toma al mediodía
  const { fraction, phase } = SunCalc.getMoonIllumination(mediodia);
  const fase = faseDe(phase);
  const datos = { ...salidaYPuesta(municipio.lat, municipio.lng, fecha), fase: fase.nombre, faseId: fase.id, icono: fase.icono, iluminacion: Math.round(fraction * 100) };
  if (cache.size >= MAX_ENTRADAS) cache.clear();
  cache.set(clave, datos);
  return datos;
}

module.exports = { lunaDeMunicipio, faseDe, FASES };
