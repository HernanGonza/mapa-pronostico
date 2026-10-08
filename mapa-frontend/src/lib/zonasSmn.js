/**
 * Zonas de Misiones según el SMN (de norte a sur), para agrupar los departamentos en los selectores de
 * colores. Guaraní es mitad centro y mitad norte: está en las dos listas (así «pintar la zona» lo toma
 * en cualquiera de las dos) pero su fila sólo se muestra en la primera zona donde aparece.
 */
export const ZONAS_SMN = [
  { nombre: "Norte", departamentos: ["Montecarlo", "Eldorado", "Iguazú", "General Manuel Belgrano", "San Pedro", "Guaraní"] },
  { nombre: "Centro", departamentos: ["San Ignacio", "Libertador General San Martín", "Oberá", "Cainguás", "25 de Mayo", "Guaraní"] },
  { nombre: "Sur", departamentos: ["Capital", "Candelaria", "Apóstoles", "Concepción", "San Javier", "Leandro N. Alem"] },
];
export const NOTA_ZONA = { Guaraní: "norte y centro" };

const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Agrupa `departamentos` ([{id, nombre}]) en las zonas: [{ nombre, miembros: [índices en `departamentos`],
 * propios: [índices que se muestran acá] }]. Lo que no figure en ninguna zona va a «Otros».
 */
export function agruparPorZona(departamentos) {
  const indice = new Map(departamentos.map((d, i) => [norm(d.nombre), i]));
  const mostrados = new Set();
  const zonas = ZONAS_SMN.map((z) => {
    const miembros = z.departamentos.map((n) => indice.get(norm(n))).filter((i) => i != null);
    const propios = miembros.filter((i) => !mostrados.has(i));
    propios.forEach((i) => mostrados.add(i));
    return { nombre: z.nombre, miembros, propios };
  });
  const otros = departamentos.map((_, i) => i).filter((i) => !mostrados.has(i));
  if (otros.length) zonas.push({ nombre: "Otros", miembros: otros, propios: otros, sinPintar: true });
  return zonas;
}
