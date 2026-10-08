/** "Amarillo" → "Amarilla", "Rojo" → "Roja" (para «alerta amarilla»); Naranja y Verde quedan igual. */
export const enFemenino = (nivel = "") => String(nivel).replace(/o$/i, (o) => (o === "O" ? "A" : "a"));
