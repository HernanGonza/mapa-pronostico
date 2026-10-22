const express = require("express");

/**
 * Sólo en desarrollo (`npm run dev` define INFORME_MUESTRA=1): GET /api/dev/informe-muestra.pdf (también .docx y .rtf) arma el informe del informe del pronóstico
 * con un borrador de muestra ya cargado, cada vez que se pide, para ver los cambios del PDF sin cargar un informe a mano.
 */
const CIUDADES = [
  ["POSADAS", 14, 24, "Nublado"], ["LEANDRO ALEM", 13, 23, "Parcialmente nublado"], ["APÓSTOLES", 13, 24, "Mayormente nublado + Chaparrones"], ["SAN JAVIER", 14, 25, "Algo nublado"],
  ["OBERÁ", 12, 22, "Nublado + Lluvias"], ["JARDÍN AMÉRICA", 13, 22, "Mayormente nublado + Tormentas"], ["SAN VICENTE", 11, 21, "Nublado + Lluvias"], ["ARISTÓBULO DEL VALLE", 12, 22, "Nublado + Chaparrones"],
  ["MONTECARLO", 13, 23, "Mayormente nublado + Tormentas"], ["PUERTO IGUAZÚ", 15, 26, "Parcialmente nublado + Tormentas aisladas"], ["BERNARDO DE IRIGOYEN", 11, 20, "Nublado + Lluvias"], ["ELDORADO", 14, 25, "Nublado + Chaparrones"], ["SAN PEDRO", 11, 21, "Nublado"],
];
const dia = (fecha, temps, { hoy = false, presion = true } = {}) => ({
  fecha, temps, presion, hoy,
  resumen: "Un sistema de alta presión permite el ingreso de aire frío y húmedo desde el sur, con cielo mayormente nublado y probabilidad de lluvias y tormentas aisladas durante la tarde. Se espera un leve descenso de las temperaturas respecto del día anterior.",
  zonas: {
    Sur: { tmin: { desde: "13", hasta: "15" }, tmax: { desde: "22", hasta: "25" }, tnoct: { desde: "15", hasta: "17" } },
    Centro: { tmin: { desde: "11", hasta: "14" }, tmax: { desde: "21", hasta: "24" }, tnoct: { desde: "14", hasta: "16" } },
    Norte: { tmin: { desde: "11", hasta: "16" }, tmax: { desde: "20", hasta: "27" }, tnoct: { desde: "16", hasta: "18" } },
  },
  humedad: { desde: "45", hasta: "95" }, presionRango: { desde: "1012", hasta: "1016" },
  precipitaciones: "Probabilidad de lluvias y tormentas aisladas, con acumulados de 5 a 20 mm en el norte y centro de la provincia",
  vientos: "10 a 25 km/h, del sector sur, con ráfagas de hasta 45 km/h",
  alertas: "Alerta amarilla por tormentas, granizo y lluvias intensas para la zona Norte, de las 12:00 a 18:00 h",
  ciudades: CIUDADES.map(([ciudad, tmin, tmax, condicion]) => ({ ciudad, tmin: String(tmin), tmax: String(tmax), tnoct: String(tmin + 2), condicion, alerta: /Tormentas/.test(condicion) ? "Amarilla" : "s/a" })),
});

const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const sumar = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
function borrador() {
  const f = hoy();
  return { version: 2, boton: "ls1", plantilla: "A", fecha: f, emision: "12:00", vigencia: { hasta: "18:00", fecha: f },
    dias: [dia(f, ["tmax", "tnoct"], { hoy: true, presion: false }), dia(sumar(f, 1), ["tmin", "tmax"]), dia(sumar(f, 2), ["tmin", "tmax"])] };
}

const router = express.Router();
/** Los generadores se vuelven a leer del disco en cada pedido: los cambios se ven al recargar, sin reiniciar el servidor. */
function generadores() {
  for (const m of ["informeResumen", "informePronosticoPdf", "informePronosticoDocx", "informePronosticoRtf", "informePronosticoViejo", "condiciones", "luna"]) delete require.cache[require.resolve(`../lib/${m}`)];
  return { pdf: require("../lib/informePronosticoPdf").generarInformePdf, docx: require("../lib/informePronosticoDocx").generarInformeDocx, rtf: require("../lib/informePronosticoRtf").generarInformeRtf, "viejo-docx": require("../lib/informePronosticoViejo").generarInformeViejoDocx, "viejo-rtf": require("../lib/informePronosticoViejo").generarInformeViejoRtf };
}
const TIPOS = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", rtf: "application/rtf" };
router.get("/dev/informe-muestra.:formato(pdf|docx|rtf|viejo-docx|viejo-rtf)", async (req, res) => {
  const f = req.params.formato, ext = f.replace("viejo-", "");
  try { res.set({ "Content-Type": TIPOS[ext], "Content-Disposition": `${f === "pdf" ? "inline" : "attachment"}; filename="informe-muestra${f.startsWith("viejo") ? " (formato viejo)" : ""}.${ext}"`, "Cache-Control": "no-store" }).send(await generadores()[f](borrador())); }
  catch (e) { console.error("[informe-muestra]", e); res.status(500).send(e.message); }
});
module.exports = router;
