/**
 * Las 13 localidades que reporta Alerta Temprana en el .docx usan
 * abreviaturas ("BDO. DE IRIGOYEN", "L. N. ALEM", "A. DEL VALLE") que no
 * coinciden textualmente con el nombre completo en el dataset de
 * municipios (data/municipios.json). Este mapa resuelve esa diferencia.
 *
 * Las claves están tal cual aparecen en el .docx; se comparan
 * normalizadas (sin tildes, mayúsculas) — ver src/lib/normalizeText.js.
 */
const ALIAS_ESTACION_A_MUNICIPIO = {
  "PUERTO IGUAZÚ": "PUERTO IGUAZU",
  "BDO. DE IRIGOYEN": "BERNARDO DE IRIGOYEN",
  "ELDORADO": "ELDORADO",
  "SAN PEDRO": "SAN PEDRO",
  "MONTECARLO": "MONTECARLO",
  "JARDÍN AMÉRICA": "JARDÍN AMERICA",
  "SAN VICENTE": "SAN VICENTE",
  "A. DEL VALLE": "ARISTOBULO DEL VALLE",
  "OBERÁ": "OBERA",
  "POSADAS": "POSADAS",
  "L. N. ALEM": "LEANDRO N. ALEM",
  "APÓSTOLES": "APOSTOLES",
  "SAN JAVIER": "SAN JAVIER",
};

module.exports = { ALIAS_ESTACION_A_MUNICIPIO };
