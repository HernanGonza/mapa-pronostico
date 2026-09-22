/**
 * A qué estación real le toca representar a cada uno de los 17
 * departamentos, para el clima del índice de riesgo de incendios (FWI) —
 * no hay una estación en cada departamento, así que se usa la más cercana
 * al centroide (calculada una vez, por distancia real; todas quedaron a
 * menos de 55 km del departamento que representan). Cuando la estación
 * asignada no tiene dato ese día, climaPorDepartamento.js cae a Open-Meteo
 * en el centroide exacto — nunca se deja un departamento sin clima.
 */
const { ESTACIONES: SINARAME } = require("./sinarame");
const { ESTACIONES: INTA } = require("./sigaInta");

// id de departamento (data/departamentos.json) -> { fuente, estacion }.
const ASIGNACION = {
  "1": { fuente: "inta", estacion: INTA.cerroAzul }, // Apóstoles
  "2": { fuente: "sinarame", estacion: SINARAME.sanVicente }, // Cainguás
  "3": { fuente: "inta", estacion: INTA.alem }, // Candelaria
  "4": { fuente: "inta", estacion: INTA.lanus }, // Capital
  "5": { fuente: "inta", estacion: INTA.cerroAzul }, // Concepción
  "6": { fuente: "sinarame", estacion: SINARAME.eldorado }, // Eldorado
  "7": { fuente: "sinarame", estacion: SINARAME.sanAntonio }, // General Manuel Belgrano
  "8": { fuente: "inta", estacion: INTA.sanVicente }, // Guaraní
  "9": { fuente: "sinarame", estacion: SINARAME.uruguai }, // Iguazú
  "10": { fuente: "inta", estacion: INTA.montecarlo }, // Libertador General San Martín
  "11": { fuente: "inta", estacion: INTA.alem }, // Leandro N. Alem
  "12": { fuente: "inta", estacion: INTA.montecarlo }, // Montecarlo
  "13": { fuente: "inta", estacion: INTA.alem }, // Oberá
  "14": { fuente: "inta", estacion: INTA.alem }, // San Ignacio
  "15": { fuente: "inta", estacion: INTA.alem }, // San Javier
  "16": { fuente: "inta", estacion: INTA.irigoyen }, // San Pedro
  "17": { fuente: "sinarame", estacion: SINARAME.sanVicente }, // 25 de Mayo
};

function asignacionDe(departamentoId) {
  const a = ASIGNACION[String(departamentoId)];
  if (!a) throw new Error(`No hay estación asignada al departamento ${departamentoId}.`);
  return a;
}

module.exports = { ASIGNACION, asignacionDe };
