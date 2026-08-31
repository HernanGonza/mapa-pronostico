const MONTHS = {
  1: "enero", 2: "febrero", 3: "marzo", 4: "abril", 5: "mayo", 6: "junio",
  7: "julio", 8: "agosto", 9: "septiembre", 10: "octubre", 11: "noviembre", 12: "diciembre",
};

// JS Date.getDay(): 0=Domingo ... 6=Sábado
const DAYS = {
  0: "Domingo", 1: "Lunes", 2: "Martes", 3: "Miércoles",
  4: "Jueves", 5: "Viernes", 6: "Sábado",
};

/**
 * Equivalente a formato_fecha() del notebook: arma el título del mapa
 * ("Viernes 28 de agosto") usando la fecha de MAÑANA relativa a `date`.
 * @param {Date} date - normalmente "ahora" ya ajustado a la zona horaria deseada
 */
function formatoFecha(date) {
  const tomorrowDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const day = String(tomorrowDate.getDate()).padStart(2, "0");
  const month = tomorrowDate.getMonth() + 1;

  const todayDow = date.getDay();
  const dayLabel = todayDow === 0 ? DAYS[1] : DAYS[(todayDow + 1) % 7];

  return `${dayLabel} ${day} de ${MONTHS[month]}`;
}

/**
 * Equivalente al ajuste de zona horaria del notebook (UTC-3, Argentina).
 */
function nowInArgentina() {
  const nowUtc = new Date();
  return new Date(nowUtc.getTime() - 3 * 60 * 60 * 1000);
}

module.exports = { formatoFecha, nowInArgentina };
