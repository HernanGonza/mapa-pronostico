/**
 * Umbrales de clasificación del FWI por departamento — copiados literales
 * del `configuracion.properties` real de ECOSOTAT (Subsecretaría de
 * Ordenamiento Territorial, archivo con fecha 10/09/2021, ZONA_1..ZONA_17).
 * Cada ZONA_N de ese archivo está nombrada como el departamento homónimo
 * (ej. ZONA_1=Posadas, que es el departamento Capital) — se mapea acá por
 * id de `data/departamentos.json`. Si alguna vez cambia el criterio en la
 * fuente original, se actualiza acá (es la única copia).
 */
const CRITERIOS_ESTANDAR = "[-100,1];(1,3];(3,9];(9,16];(16,100]";
// Eldorado e Iguazú usan una escala más sensible (umbrales más bajos) en
// el archivo original — se respeta tal cual, no es un error de tipeo.
const CRITERIOS_ELDORADO_IGUAZU = "[-100,1);[1,2];(2,6];(6,13);[13,100]";

// id de departamento (data/departamentos.json) -> criterio de clasificación.
const CRITERIOS_POR_DEPARTAMENTO = {
  "1": CRITERIOS_ESTANDAR, // Apóstoles (ZONA_3)
  "2": CRITERIOS_ESTANDAR, // Cainguás (ZONA_9)
  "3": CRITERIOS_ESTANDAR, // Candelaria (ZONA_2)
  "4": CRITERIOS_ESTANDAR, // Capital / Posadas (ZONA_1)
  "5": CRITERIOS_ESTANDAR, // Concepción (ZONA_5)
  "6": CRITERIOS_ELDORADO_IGUAZU, // Eldorado (ZONA_15)
  "7": CRITERIOS_ESTANDAR, // General Manuel Belgrano (ZONA_17)
  "8": CRITERIOS_ESTANDAR, // Guaraní (ZONA_12)
  "9": CRITERIOS_ELDORADO_IGUAZU, // Iguazú (ZONA_16)
  "10": CRITERIOS_ESTANDAR, // Libertador General San Martín (ZONA_10)
  "11": CRITERIOS_ESTANDAR, // Leandro N. Alem (ZONA_4)
  "12": CRITERIOS_ESTANDAR, // Montecarlo (ZONA_13)
  "13": CRITERIOS_ESTANDAR, // Oberá (ZONA_8)
  "14": CRITERIOS_ESTANDAR, // San Ignacio (ZONA_7)
  "15": CRITERIOS_ESTANDAR, // San Javier (ZONA_6)
  "16": CRITERIOS_ESTANDAR, // San Pedro (ZONA_14)
  "17": CRITERIOS_ESTANDAR, // 25 de Mayo (ZONA_11)
};

function criterioDe(departamentoId) {
  const criterio = CRITERIOS_POR_DEPARTAMENTO[String(departamentoId)];
  if (!criterio) throw new Error(`No hay criterio de clasificación configurado para el departamento ${departamentoId}.`);
  return criterio;
}

module.exports = { CRITERIOS_ESTANDAR, CRITERIOS_ELDORADO_IGUAZU, CRITERIOS_POR_DEPARTAMENTO, criterioDe };
