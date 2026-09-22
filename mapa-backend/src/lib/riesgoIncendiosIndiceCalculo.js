const { loadDepartamentos, loadCentroides } = require("./departamentos");
const climaPorDepartamento = require("./climaPorDepartamento");
const fwi = require("./fwi");
const indiceStore = require("./riesgoIncendiosIndiceStore");
const { criterioDe } = require("./riesgoIncendiosCriterios");

/**
 * Semilla de arranque cuando no hay un día anterior calculado (primer día
 * de la serie de un departamento). Son los valores de arranque de
 * primavera que recomienda el sistema canadiense (FFMC=85, DMC=6, DC=15):
 * el índice tarda unos días en estabilizarse desde acá, como pasa siempre
 * que se prende este tipo de sistema. `backfill-riesgo-incendios.js` evita
 * depender de esto en producción, reconstruyendo antes la serie con
 * clima histórico real.
 */
const SEMILLA = { ffmc: 85, dmc: 6, dc: 15 };

// Las estaciones diarias (INTA) publican con 1-2 días de rezago: si el
// cron sólo calculara "hoy", el dato real de esas estaciones nunca
// llegaría a usarse (siempre estaría pidiendo un día que la estación
// todavía no publicó, y caería a Open-Meteo — ver climaPorDepartamento.js).
// Por eso, además de hoy, se reconcilian los últimos
// VENTANA_RECONCILIACION_DIAS días: si para alguno ya hay dato real
// disponible, se recalcula desde ahí hasta hoy (la fórmula es recursiva,
// una corrección se propaga en cadena hacia los días siguientes).
const VENTANA_RECONCILIACION_DIAS = 3;

const mesDe = (fechaISO) => Number(fechaISO.slice(5, 7));
const fechaISODe = (d) => d.toISOString().slice(0, 10);

/**
 * Calcula y persiste el índice de un departamento para `fechaISO`
 * ("YYYY-MM-DD"), a partir del día anterior guardado (o la semilla, si es
 * el primer día) y el clima de ese día
 * ({temperatura,humedad,viento,precipitacion,fuente,estacionNombre} — ver
 * climaPorDepartamento.js, que combina la estación real más cercana con
 * Open-Meteo).
 */
async function calcularDepartamento(departamentoId, fechaISO, clima) {
  for (const campo of ["temperatura", "humedad", "viento", "precipitacion"]) {
    if (!Number.isFinite(clima[campo])) throw new Error(`Clima incompleto o inválido para ${fechaISO}: ${campo}.`);
  }
  const ayer = await indiceStore.obtenerUltimo(departamentoId, fechaISO);
  const { FFMC, DMC, DC, ISI, BUI, FWI } = fwi.calcularDia({
    F0: ayer ? ayer.ffmc : SEMILLA.ffmc,
    DMC0: ayer ? ayer.dmc : SEMILLA.dmc,
    DC0: ayer ? ayer.dc : SEMILLA.dc,
    r0: clima.precipitacion,
    H: clima.humedad,
    T: clima.temperatura,
    W: clima.viento,
    mes: mesDe(fechaISO),
  });
  const categoria = fwi.clasificar(FWI, criterioDe(departamentoId));
  const datos = {
    temperatura: clima.temperatura, humedad: clima.humedad, viento: clima.viento, precipitacion: clima.precipitacion,
    ffmc: FFMC, dmc: DMC, dc: DC, isi: ISI, bui: BUI, fwi: FWI, categoria,
    fuente: clima.fuente, estacionNombre: clima.estacionNombre,
  };
  await indiceStore.guardar(departamentoId, fechaISO, datos);
  return { departamentoId: String(departamentoId), fecha: fechaISO, ...datos };
}

/**
 * Calcula los 17 departamentos para hoy — con reconciliación de los
 * últimos VENTANA_RECONCILIACION_DIAS días primero (ver comentario arriba)
 * — pensado para el cron diario (riesgoIncendiosIndiceService.js). Un
 * departamento que falle (todas sus fuentes caídas, etc.) no frena a los
 * demás; se reporta en `errores` y ese departamento simplemente no se
 * actualiza.
 */
async function calcularHoy() {
  const departamentos = loadDepartamentos();
  const centroides = loadCentroides();
  const resultados = [];
  const errores = [];
  const desde = new Date(); desde.setDate(desde.getDate() - VENTANA_RECONCILIACION_DIAS);
  const hasta = new Date(); hasta.setDate(hasta.getDate() - 1);
  const desdeISO = fechaISODe(desde), hastaISO = fechaISODe(hasta);

  for (const d of departamentos) {
    const id = String(d.id);
    try {
      const centroide = centroides.get(id);
      if (!centroide) throw new Error(`Sin centroide calculado para el departamento ${id}.`);

      const reconciliar = await climaPorDepartamento.climaHistoricoPorDepartamento(id, centroide, desdeISO, hastaISO);
      for (const fecha of [...reconciliar.keys()].sort()) {
        await calcularDepartamento(id, fecha, reconciliar.get(fecha));
      }

      const clima = await climaPorDepartamento.climaDeHoy(id, centroide);
      resultados.push(await calcularDepartamento(id, clima.fecha, clima));
    } catch (e) {
      errores.push({ departamentoId: id, nombre: d.nombre, error: e.message });
    }
  }
  return { resultados, errores };
}

module.exports = { calcularDepartamento, calcularHoy, mesDe, SEMILLA };
