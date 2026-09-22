/**
 * Red SiNaRaMe (INA) en Misiones — Eldorado, San Antonio, San Vicente y
 * Urugua-í — vía el Sistema Nacional de Información Hídrica
 * (https://snih.hidricosargentina.gob.ar). Es la misma red que ECOSOTAT
 * intentaba bajar directo de un servidor de INA (correo.ina.gob.ar:9050)
 * con usuario/clave de 2017 que ya no responde; SNIH la expone con un
 * frontend moderno, sin key. Da temperatura, humedad, viento Y
 * precipitación de una sola estación — las 4 variables del FWI reales,
 * medidas en el lugar (a diferencia de Open-Meteo, que estima por satélite).
 */
const BASE = "https://snih.hidricosargentina.gob.ar";
const TIMEOUT_MS = 15000;

// Las 4 estaciones de Misiones de la red (Codigo de SNIH) — de un listado
// de 1434 en todo el país, filtradas por Red=22 ("Red Meteorológica
// SiNaRaMe") y ubicación. Mismos 4 nombres que ya usaba ECOSOTAT.
const ESTACIONES = {
  eldorado: { id: "220247", nombre: "Eldorado", lat: -26.3934, lng: -54.576 },
  sanAntonio: { id: "220248", nombre: "San Antonio", lat: -26.0495, lng: -53.7682 },
  sanVicente: { id: "220249", nombre: "San Vicente", lat: -26.9204, lng: -54.4223 },
  uruguai: { id: "220250", nombre: "Urugua-í", lat: -25.874, lng: -54.5513 },
};

// Códigos de medición de SNIH — no vienen documentados por nombre
// (leerListaParametros no los expone), se identificaron a mano mirando la
// respuesta de LeerDatosActuales de la estación de Eldorado.
const CODIGOS = { temperatura: 14, humedad: 18, viento: 4, precipitacion: 20 };
// Valores centinela de "sin dato" que usa SNIH (aparecen en vez de null).
const SIN_DATO = new Set([-999, -9999]);
// Límites de lo físicamente plausible en Misiones, por variable — no sólo
// los centinelas -999/-9999: una estación de otra red (INTA) reportó una
// vez 0% de humedad por un sensor roto, y ese único valor imposible
// bastó para distorsionar el FFMC varias semanas (el cálculo es
// recursivo). Mismo criterio de "mejor sin dato ese día que un dato roto"
// para las 4 variables de acá.
const LIMITES = {
  temperatura: (v) => v > -10 && v < 50,
  humedad: (v) => v >= 1 && v <= 100,
  viento: (v) => v >= 0 && v < 200,
  precipitacion: (v) => v >= 0 && v < 500,
};
function limpiar(v, variable) {
  if (typeof v !== "number" || !Number.isFinite(v) || SIN_DATO.has(v)) return null;
  return !variable || LIMITES[variable](v) ? v : null;
}

async function pedir(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE}/${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json; charset=UTF-8", "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`SNIH: HTTP ${r.status}.`);
    const data = await r.json();
    if (data?.d?.RespuestaOK === false) throw new Error(`SNIH: ${data.d.MsgErr || "respuesta no OK"}.`);
    return data.d;
  } catch (e) {
    throw e.name === "AbortError" ? new Error("SNIH: tiempo de espera agotado.") : e;
  } finally {
    clearTimeout(timer);
  }
}

/** Última lectura de cada variable de una estación — para el cron diario ("hoy"). */
async function climaActual(estacionId) {
  const { Mediciones } = await pedir("MuestraDatos.aspx/LeerDatosActuales", { estacion: estacionId });
  const porCodigo = new Map((Mediciones || []).map((m) => [m.Codigo, m.Valor]));
  return {
    temperatura: limpiar(porCodigo.get(CODIGOS.temperatura), "temperatura"),
    humedad: limpiar(porCodigo.get(CODIGOS.humedad), "humedad"),
    viento: limpiar(porCodigo.get(CODIGOS.viento), "viento"),
    precipitacion: limpiar(porCodigo.get(CODIGOS.precipitacion), "precipitacion"),
  };
}

/** Serie cruda de una sola variable entre dos fechas ("YYYY-MM-DD"), un
 * pedido HTTP para todo el rango — el formato de fecha que acepta este
 * webservice es "YYYY-MM-DD" (con "DD-MM-YYYY", que es lo que usa su
 * propio frontend, tira error 500; probablemente un bug de ese lado). */
async function serieHistorica(estacionId, codigo, variable, desdeISO, hastaISO) {
  const { Mediciones } = await pedir("MuestraDatos.aspx/LeerUltimosRegistros", {
    fechaDesde: desdeISO,
    fechaHasta: hastaISO,
    estacion: estacionId,
    codigo: String(codigo),
  });
  return (Mediciones || [])
    .map((m) => ({ ms: Number(/\d+/.exec(m.FechaHora)?.[0]), valor: limpiar(m.Mediciones?.[0]?.Valor, variable) }))
    .filter((r) => Number.isFinite(r.ms));
}

/**
 * Clima diario de una estación entre dos fechas — 4 pedidos HTTP en total
 * (uno por variable, cada uno trae todo el rango), agrupados por día:
 * temperatura/humedad/viento = la lectura más cercana a las 9h ART de ese
 * día (instantáneas, mismo criterio horario que el resto del proyecto);
 * precipitación = la suma de las lecturas entre las 09:00 ART de ayer y
 * las 09:00 ART de hoy (son incrementos de ~10 minutos).
 * Devuelve un Map fecha -> {temperatura,humedad,viento,precipitacion}, con
 * `null` en la variable que ese día no tuvo ninguna lectura válida.
 */
async function climaPorDia(estacionId, desdeISO, hastaISO) {
  const desdeLluvia = new Date(Date.parse(`${desdeISO}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const [temps, humedades, vientos, precips] = await Promise.all([
    serieHistorica(estacionId, CODIGOS.temperatura, "temperatura", desdeISO, hastaISO),
    serieHistorica(estacionId, CODIGOS.humedad, "humedad", desdeISO, hastaISO),
    serieHistorica(estacionId, CODIGOS.viento, "viento", desdeISO, hastaISO),
    serieHistorica(estacionId, CODIGOS.precipitacion, "precipitacion", desdeLluvia, hastaISO),
  ]);
  const porDia = new Map();
  const fechaDe = (ms) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  for (const serie of [temps, humedades, vientos, precips]) {
    for (const r of serie) {
      const f = fechaDe(r.ms);
      if (f >= desdeISO && f <= hastaISO && !porDia.has(f)) porDia.set(f, { temps: [], humedades: [], vientos: [], precips: [] });
    }
  }
  const asignar = (serie, clave) => {
    for (const r of serie) porDia.get(fechaDe(r.ms))?.[clave].push(r);
  };
  asignar(temps, "temps");
  asignar(humedades, "humedades");
  asignar(vientos, "vientos");
  asignar(precips, "precips");

  const cercanoA9 = (fecha, serie) => {
    if (!serie.length) return null;
    const objetivo = new Date(`${fecha}T09:00:00-03:00`).getTime();
    const validas = serie.filter((r) => r.valor != null);
    if (!validas.length) return null;
    return validas.reduce((a, b) => (Math.abs(b.ms - objetivo) < Math.abs(a.ms - objetivo) ? b : a)).valor;
  };
  const sumaDia = (fecha) => {
    const fin = Date.parse(`${fecha}T12:00:00Z`);
    const validas = precips.filter((r) => r.valor != null && r.ms > fin - 86400000 && r.ms <= fin);
    return validas.length ? validas.reduce((acc, r) => acc + r.valor, 0) : null;
  };

  const resultado = new Map();
  for (const [fecha, s] of porDia) {
    resultado.set(fecha, {
      temperatura: cercanoA9(fecha, s.temps),
      humedad: cercanoA9(fecha, s.humedades),
      viento: cercanoA9(fecha, s.vientos),
      precipitacion: sumaDia(fecha),
    });
  }
  return resultado;
}

async function climaDeUnDia(estacionId, fechaISO) {
  const serie = await climaPorDia(estacionId, fechaISO, fechaISO);
  return serie.get(fechaISO) || null;
}

module.exports = { ESTACIONES, CODIGOS, climaActual, climaPorDia, climaDeUnDia };
