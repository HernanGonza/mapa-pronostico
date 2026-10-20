const fs = require("fs");
const path = require("path");
const { ahoraPorDepartamento, FEMENINO } = require("./alertasDelDia");
const { normalize } = require("./normalizeText");

let _depDe = null;
/** id de municipio → id de departamento (de la propiedad `departamento` de municipios.geojson). */
function departamentoDe() {
  if (!_depDe) {
    const g = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "data", "municipios.geojson"), "utf8"));
    _depDe = new Map(g.features.map((f) => [f.properties.id, String(f.properties.departamento)]));
  }
  return _depDe;
}

/**
 * A cada municipio le suma `alerta`: la alerta meteorológica que rige ahora en su departamento ({ nivel, color, nombre, fenomenos, hasta })
 * o `null` si no tiene (así la tarjeta del mapa puede decir «sin alertas»). `vigentes`: lo que muestra el mapa público de alertas.
 */
function conAlertas(municipios, vigentes) {
  const porDep = ahoraPorDepartamento(vigentes), dep = departamentoDe();
  return municipios.map((m) => {
    const a = porDep.get(dep.get(m.id));
    return { ...m, alerta: a ? { ...a, nombre: `Alerta ${FEMENINO[a.nivel]}${a.fenomenos.length ? ` por ${a.fenomenos.join(" y ")}` : ""}` } : null };
  });
}

const { delDia } = require("./alertasDelDia");
const fechaAR = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const etiquetaDia = (fecha) => {
  const s = new Date(`${fecha}T12:00:00-03:00`).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "2-digit", month: "2-digit" });
  return (s.charAt(0).toUpperCase() + s.slice(1)).replace(/-/g, "/");
};

/**
 * A cada municipio le suma `alertasProximas`: los próximos días (mañana en adelante, hasta `dias`) en que su departamento tiene
 * alerta, con lo ya publicado, incluso lo que todavía no se ve en el mapa (programadas o en fila). `pubs`: vigentes + en fila.
 * [{ fecha, etiqueta, nivel, color, nombre, cuando }]; la más severa de cada día.
 */
function conAlertasProximas(municipios, pubs, departamentos, dias = 7, ahora = Date.now()) {
  const dep = departamentoDe(), nombres = new Map(departamentos.map((d) => [String(d.id), d.nombre]));
  const porDia = [];
  for (let i = 1; i < dias; i++) {
    const fecha = fechaAR(ahora + i * 864e5);
    const alertas = delDia(fecha, pubs, null, departamentos);
    if (alertas.length) porDia.push({ fecha, alertas });
  }
  return municipios.map((m) => {
    const nombre = nombres.get(dep.get(m.id));
    const proximas = [];
    for (const { fecha, alertas } of porDia) {
      const a = alertas.find((x) => x.departamentos.includes(nombre));
      if (a) proximas.push({ fecha, etiqueta: etiquetaDia(fecha), nivel: a.nivel, color: a.color, nombre: a.nombre, cuando: a.cuando.replace(/ h$/, "") });
    }
    return { ...m, alertasProximas: proximas };
  });
}

// Las 13 ciudades de los informes del pronóstico (mapa-frontend/src/lib/informePlantillas.js) → cómo se llama el municipio.
const CIUDADES = ["POSADAS", "LEANDRO ALEM", "APÓSTOLES", "SAN JAVIER", "OBERÁ", "JARDÍN AMÉRICA", "SAN VICENTE", "ARISTÓBULO DEL VALLE", "MONTECARLO", "PUERTO IGUAZÚ", "BERNARDO DE IRIGOYEN", "ELDORADO", "SAN PEDRO"];
const MUNICIPIO_DE = { "LEANDRO ALEM": "LEANDRO N. ALEM" };

/** { "POSADAS": "Capital", … }: el departamento de cada ciudad del informe (para saber qué alerta le toca). */
function ciudadesDepartamento() {
  const municipios = require("./municipios").loadMunicipios(), departamentos = require("./departamentos").loadDepartamentos();
  const dep = departamentoDe(), out = {};
  for (const c of CIUDADES) {
    const m = municipios.find((x) => normalize(x.nombre) === normalize(MUNICIPIO_DE[c] || c));
    const d = m && departamentos.find((x) => String(x.id) === dep.get(m.id));
    if (d) out[c] = d.nombre;
  }
  return out;
}

module.exports = { conAlertasProximas, conAlertas, departamentoDe, ciudadesDepartamento, CIUDADES };
