const { masSevera, masGraveDe } = require("./condiciones");

/**
 * Lo que el .pdf, el .docx y el .rtf del informe (formato 2) calculan igual a partir del borrador: la temperatura fija de cada
 * zona, la condición de cada zona y de cada ciudad (una sola, la más grave) y el rango de la tabla de ciudades.
 */
const ZONA_DE_CIUDAD = {
  Norte: ["MONTECARLO", "ELDORADO", "SAN PEDRO", "BERNARDO DE IRIGOYEN", "PUERTO IGUAZÚ"],
  Centro: ["OBERÁ", "JARDÍN AMÉRICA", "ARISTÓBULO DEL VALLE", "SAN VICENTE"],
  Sur: ["POSADAS", "LEANDRO ALEM", "APÓSTOLES", "SAN JAVIER"],
};

/** El valor fijo de una zona a partir de su rango cargado: la mínima más baja (mínimas y nocturnas) o la máxima más alta (máximas). */
const fijoDeZona = (r, t) => (t === "tmax" ? String(r?.hasta ?? "").trim() || r?.desde : r?.desde);

/** De un texto con varias condiciones («Nublado + Chaparrones + Tormentas») deja sólo la más grave («Tormentas»); si no reconoce ninguna, el texto como está. */
const masGrave = (texto) => masSevera(texto)?.nombre ?? String(texto ?? "").trim();

/** La condición de una zona: la más grave de las de sus ciudades (el catálogo va de menor a mayor gravedad, ver condiciones.js). */
const condicionDeZona = (d, zona) => masGraveDe(d.ciudades.filter((c) => ZONA_DE_CIUDAD[zona].includes(String(c.ciudad).toUpperCase())).map((c) => masGrave(c.condicion)).filter(Boolean));

/** El rango de una columna de la tabla de ciudades: { desde, hasta } con el valor más bajo y el más alto, o null si no hay números. */
function resultadoDeCiudades(d, t) {
  const v = d.ciudades.filter((c) => String(c[t] ?? "").trim() !== "").map((c) => Number(String(c[t]).replace(",", "."))).filter(Number.isFinite);
  return v.length ? { desde: String(Math.min(...v)), hasta: String(Math.max(...v)) } : null;
}

module.exports = { ZONA_DE_CIUDAD, fijoDeZona, masGrave, condicionDeZona, resultadoDeCiudades };
