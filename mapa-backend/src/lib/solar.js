/**
 * Salida y puesta del sol por municipio y fecha, vía Sunrise-Sunset API
 * (https://sunrise-sunset.org/api — gratuita, sin key). Se consulta desde el
 * server y no desde el navegador: una sola consulta por municipio+fecha sin
 * importar cuántas personas miren el mapa (ni cuántos sitios lo embeban).
 */
const { loadMunicipios } = require("./municipios");

const TZ = "America/Argentina/Buenos_Aires";
const TIMEOUT_MS = 8000;
const FALLO_MS = 60 * 1000; // tras un error no se vuelve a pedir ese dato por un rato
const MAX_ENTRADAS = 2000;

const hora = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fechaHoyART = () => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());

const cache = new Map(); // "municipioId|fecha" → { datos, hasta } | { promesa }

/** ISO con huso → "HH:MM" en hora argentina (sin depender del offset que devuelva la API). */
function aHoraLocal(iso) {
  const d = new Date(iso);
  return typeof iso === "string" && !Number.isNaN(d.getTime()) ? hora.format(d) : null;
}

async function pedir(lat, lng, fecha) {
  const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${fecha}&formatted=0&tzid=${TZ}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json?.status !== "OK") throw new Error(`status ${json?.status}`);
  const amanecer = aHoraLocal(json.results?.sunrise);
  const anochecer = aHoraLocal(json.results?.sunset);
  if (!amanecer || !anochecer) throw new Error("respuesta incompleta");
  return { amanecer, anochecer };
}

/** { amanecer: "06:10", anochecer: "18:42" } o null si el municipio no existe o la API falla. */
async function solDeMunicipio(municipioId, fecha = fechaHoyART()) {
  const municipio = loadMunicipios().find((m) => m.id === municipioId);
  if (!municipio || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) return null;

  const clave = `${municipio.id}|${fecha}`;
  const guardado = cache.get(clave);
  if (guardado?.promesa) return guardado.promesa; // misma consulta en vuelo: no se duplica
  if (guardado && guardado.hasta > Date.now()) return guardado.datos;

  const promesa = pedir(municipio.lat, municipio.lng, fecha)
    .then((datos) => ({ datos, hasta: Infinity })) // los horarios de una fecha no cambian
    .catch((err) => {
      console.warn(`[solar] ${municipio.nombre} ${fecha}: ${err.message}`);
      return { datos: null, hasta: Date.now() + FALLO_MS };
    })
    .then((entrada) => {
      if (cache.size >= MAX_ENTRADAS) cache.clear();
      cache.set(clave, entrada);
      return entrada.datos;
    });
  cache.set(clave, { promesa });
  return promesa;
}

module.exports = { solDeMunicipio, aHoraLocal };
