const { loadDepartamentos } = require("./departamentos");

// Paleta de ECOSOTAT: GeneradorDeImagen.java. Catálogo compartido por API
// para que validación, editor, leyenda y exportación usen las mismas categorías.
const categorias = [
  { nombre: "BAJO", color: "#00a551" },
  { nombre: "MODERADO", color: "#2d3192" },
  { nombre: "ALTO", color: "#fff100" },
  { nombre: "MUY ALTO", color: "#f38321" },
  { nombre: "EXTREMO", color: "#ec1f24" },
];
function errorDeZonas(zonas) {
  const departamentos = loadDepartamentos();
  if (!Array.isArray(zonas) || zonas.length !== departamentos.length) return "Elegí una categoría para cada uno de los 17 departamentos.";
  const ids = new Set(departamentos.map(d => String(d.id)));
  const vistos = new Set();
  for (const z of zonas) {
    if (!z || !["string", "number"].includes(typeof z.id) || !ids.has(String(z.id))) return "Departamento inválido.";
    if (vistos.has(String(z.id))) return "Hay departamentos repetidos.";
    vistos.add(String(z.id));
    if (!categorias.some(c => c.nombre === z.categoria)) return "Categoría de riesgo inválida.";
  }
  return null;
}
function normalizarZonas(zonas) {
  const porId = new Map(zonas.map(z => [String(z.id), z.categoria]));
  return loadDepartamentos().map(d => ({ id: String(d.id), categoria: porId.get(String(d.id)) }));
}
module.exports = { categorias, errorDeZonas, normalizarZonas };
