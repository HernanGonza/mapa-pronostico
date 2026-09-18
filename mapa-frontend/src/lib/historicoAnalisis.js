const DIA = 86400000;
const COBERTURA_MINIMA = 0.9;
const media = valores => valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
const redondear = valor => valor == null ? null : Math.round(valor * 10) / 10;
const diasEntre = (a, b) => Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA) + 1;

export function escalaParaRango(desde, hasta) {
  const dias = diasEntre(desde, hasta);
  return dias <= 120 ? 'dia' : dias <= 1096 ? 'mes' : 'anio';
}

function longitudPeriodo(clave, escala) {
  if (escala === 'dia') return 1;
  if (escala === 'mes') return new Date(Date.UTC(Number(clave.slice(0, 4)), Number(clave.slice(5, 7)), 0)).getUTCDate();
  return diasEntre(`${clave}-01-01`, `${clave}-12-31`);
}

function clavePeriodo(fecha, escala) {
  return escala === 'dia' ? fecha : escala === 'mes' ? fecha.slice(0, 7) : fecha.slice(0, 4);
}

function resumenPeriodo(filas, clave, escala) {
  const valores = campo => filas.map(f => f[campo]).filter(Number.isFinite);
  const tmax = valores('temperatura_maxima');
  const tmin = valores('temperatura_minima');
  const tmedia = valores('temperatura_media');
  const lluvia = valores('precipitacion');
  const dtr = filas.filter(f => Number.isFinite(f.temperatura_maxima) && Number.isFinite(f.temperatura_minima))
    .map(f => f.temperatura_maxima - f.temperatura_minima);
  const coberturaTemp = Math.min(tmax.length, tmin.length) / longitudPeriodo(clave, escala);
  const coberturaLluvia = lluvia.length / longitudPeriodo(clave, escala);
  const suficienteMax = tmax.length / longitudPeriodo(clave, escala) >= COBERTURA_MINIMA;
  const suficienteMin = tmin.length / longitudPeriodo(clave, escala) >= COBERTURA_MINIMA;
  const suficienteLluvia = coberturaLluvia >= COBERTURA_MINIMA;
  let seca = 0; let humeda = 0; let maxSeca = 0; let maxHumeda = 0;
  let fechaAnterior = null;
  for (const f of filas) {
    const consecutiva = fechaAnterior && diasEntre(fechaAnterior, f.fecha) === 2;
    if (!consecutiva || !Number.isFinite(f.precipitacion)) { seca = 0; humeda = 0; }
    if (Number.isFinite(f.precipitacion)) {
      seca = f.precipitacion < 1 ? seca + 1 : 0;
      humeda = f.precipitacion >= 1 ? humeda + 1 : 0;
      maxSeca = Math.max(maxSeca, seca); maxHumeda = Math.max(maxHumeda, humeda);
    }
    fechaAnterior = f.fecha;
  }
  const diasLluvia = lluvia.filter(v => v >= 1).length;
  return {
    clave, fecha: escala === 'dia' ? clave : escala === 'mes' ? `${clave}-01` : `${clave}-01-01`,
    dias: filas.length, esperados: longitudPeriodo(clave, escala),
    coberturaTemp: redondear(coberturaTemp * 100), coberturaLluvia: redondear(coberturaLluvia * 100),
    tmax: suficienteMax ? redondear(media(tmax)) : null,
    tmin: suficienteMin ? redondear(media(tmin)) : null,
    tmedia: tmedia.length / longitudPeriodo(clave, escala) >= COBERTURA_MINIMA ? redondear(media(tmedia)) : null,
    lluvia: suficienteLluvia ? redondear(lluvia.reduce((a, b) => a + b, 0)) : null,
    diasLluvia: suficienteLluvia ? diasLluvia : null,
    r10: suficienteLluvia ? lluvia.filter(v => v >= 10).length : null,
    r20: suficienteLluvia ? lluvia.filter(v => v >= 20).length : null,
    intensidad: suficienteLluvia && diasLluvia ? redondear(lluvia.filter(v => v >= 1).reduce((a, b) => a + b, 0) / diasLluvia) : null,
    rx1: suficienteLluvia && lluvia.length ? redondear(Math.max(...lluvia)) : null,
    cdd: suficienteLluvia ? maxSeca : null,
    cwd: suficienteLluvia ? maxHumeda : null,
    diasCalurosos: suficienteMax ? tmax.filter(v => v >= 35).length : null,
    nochesTropicales: suficienteMin ? tmin.filter(v => v > 20).length : null,
    dtr: dtr.length / longitudPeriodo(clave, escala) >= COBERTURA_MINIMA ? redondear(media(dtr)) : null,
    humedad: valores('humedad_relativa').length / longitudPeriodo(clave, escala) >= COBERTURA_MINIMA ? redondear(media(valores('humedad_relativa'))) : null,
    heliofania: valores('heliofania').length / longitudPeriodo(clave, escala) >= COBERTURA_MINIMA ? redondear(media(valores('heliofania'))) : null,
    nubosidad: valores('nubosidad').length / longitudPeriodo(clave, escala) >= COBERTURA_MINIMA ? redondear(media(valores('nubosidad'))) : null,
    presion: valores('presion_estacion').length / longitudPeriodo(clave, escala) >= COBERTURA_MINIMA ? redondear(media(valores('presion_estacion'))) : null,
    viento: valores('viento_medio_intensidad').length / longitudPeriodo(clave, escala) >= COBERTURA_MINIMA ? redondear(media(valores('viento_medio_intensidad'))) : null,
  };
}

export function analizarHistorico(filas, desde, hasta) {
  if (!desde || !hasta || desde > hasta) return { escala: 'dia', periodos: [], anuales: [] };
  const escala = escalaParaRango(desde, hasta);
  const agrupar = tipo => {
    const grupos = new Map();
    for (const fila of filas) {
      const clave = clavePeriodo(fila.fecha, tipo);
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(fila);
    }
    return [...grupos].map(([clave, grupo]) => resumenPeriodo(grupo, clave, tipo));
  };
  const mensuales = agrupar('mes');
  const ciclo = Array.from({ length: 12 }, (_, i) => {
    const mes = String(i + 1).padStart(2, '0');
    const grupo = mensuales.filter(p => p.clave.endsWith(`-${mes}`));
    return {
      clave: mes, fecha: `2000-${mes}-01`,
      tmedia: redondear(media(grupo.map(p => p.tmedia).filter(Number.isFinite))),
      lluvia: redondear(media(grupo.map(p => p.lluvia).filter(Number.isFinite))),
      mesesTemp: grupo.filter(p => Number.isFinite(p.tmedia)).length,
      mesesLluvia: grupo.filter(p => Number.isFinite(p.lluvia)).length,
    };
  });
  return { escala, periodos: agrupar(escala), anuales: agrupar('anio'), ciclo };
}

export const coberturaMinima = COBERTURA_MINIMA;
