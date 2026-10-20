const { errorDeInforme } = require("./informePronosticoPdf");
const { fijoDeZona, masGrave, condicionDeZona, resultadoDeCiudades } = require("./informeResumen");
const { faseDelDia } = require("./luna");
const { formato: { ZONAS, ROTULO, CABECERA, fechaLarga, fechaCorta, temp, rango } } = require("./informePronosticoDocx");

/**
 * El mismo informe que el .docx (ver informePronosticoDocx.js), en RTF: texto y tablas editables en cualquier procesador de texto.
 * Los medios reciben los dos (el correo sale con .docx y .rtf).
 */
// Colores de la tabla de colores (\cfN): 1 verde oscuro, 2 verde, 3 gris, 4 rojo, 5 azul.
const C = { verde: 1, verde2: 2, gris: 3, rojo: 4, azul: 5 };

/** Texto a RTF: escapa los controles y pasa todo lo que no es ASCII a \uN? (sirve para cualquier idioma, sin depender de la página de códigos). */
function esc(s) {
  let r = "";
  for (const ch of String(s ?? "").replace(/\r?\n/g, "\n")) {
    const n = ch.codePointAt(0);
    if (ch === "\\" || ch === "{" || ch === "}") r += `\\${ch}`;
    else if (ch === "\n") r += "\\line ";
    else if (n < 32) r += "";
    else if (n < 128) r += ch;
    else for (const u of ch.length > 1 ? [ch.charCodeAt(0), ch.charCodeAt(1)] : [n]) r += `\\u${u > 32767 ? u - 65536 : u}?`;
  }
  return r;
}
function p(t, { bold, size = 20, color, centro, antes = 0, despues = 80, justificado } = {}) {
  return `\\pard\\sb${antes}\\sa${despues}${centro ? "\\qc" : justificado ? "\\qj" : "\\ql"}${color ? `\\cf${color}` : ""}${bold ? "\\b" : ""}\\fs${size} ${esc(t)}\\b0\\cf0\\par\n`;
}
function tabla(anchos, filas) {
  const borde = ["t", "l", "b", "r"].map((l) => `\\clbrdr${l}\\brdrs\\brdrw10\\brdrcf3`).join("");
  return filas.map((f) => `\\trowd\\trgaph70\\trleft0\\trcantsplit\n${f.map((c, i) => {
    const o = typeof c === "object" && c ? c : { t: c };
    return `${borde}${o.fondo ? "\\clcbpat6" : ""}\\cellx${anchos.slice(0, i + 1).reduce((a, b) => a + b, 0)}`;
  }).join("")}\n${f.map((c) => {
    const o = typeof c === "object" && c ? c : { t: c };
    return `\\pard\\intbl${o.centro ? "\\qc" : "\\ql"}${o.color ? `\\cf${o.color}` : ""}${o.bold ? "\\b" : ""}\\fs${o.size || 18} ${esc(String(o.t ?? "").trim() || (o.vacia ? "" : "—"))}\\b0\\cf0\\cell\n`;
  }).join("")}\\row\n`).join("") + p("", { despues: 120, size: 8 });
}

function cuerpo(b) {
  const x = [];
  x.push(p("PREVISIÓN DEL TIEMPO", { bold: true, size: 36, color: C.verde, centro: true, despues: 0 }));
  x.push(p("PARA LA PROVINCIA DE MISIONES", { bold: true, size: 24, color: C.verde2, centro: true, despues: 0 }));
  x.push(p("Dirección General de Alerta Temprana · Subsecretaría de Ordenamiento Territorial", { size: 16, color: C.gris, centro: true, despues: 0 }));
  x.push(p("Ministerio de Ecología y Recursos Naturales Renovables de la Provincia de Misiones", { size: 16, color: C.gris, centro: true, despues: 60 }));
  x.push(p(`VIGENCIA: hasta las ${b.vigencia.hasta === "23:59" ? "23:59" : `${b.vigencia.hasta.slice(0, 2)} horas`} del ${fechaCorta(b.vigencia.fecha)}`, { bold: true, color: C.rojo, centro: true, despues: 200 }));
  const W = 10000, color = (t) => (t === "tmax" ? C.rojo : C.azul), rot = (t) => ({ t, bold: true, color: C.verde });
  b.dias.forEach((d, i) => {
    x.push(p(fechaLarga(d.fecha), { bold: true, size: 28, color: C.verde, antes: i ? 300 : 0 }));
    if (String(d.resumen ?? "").trim()) x.push(p(String(d.resumen).trim(), { justificado: true, despues: 140 }));
    x.push(p(`Condiciones promedio para la provincia ${d.hoy ? "en lo que resta del día" : "para el día"} (${fechaCorta(d.fecha)})`, { bold: true, color: C.verde2, despues: 60 }));
    const aZ = Math.floor((W - 2800) / 3);
    x.push(tabla([2800, aZ, aZ, aZ], [
      [{ t: "", vacia: true, fondo: 1 }, ...ZONAS.map((z) => ({ t: `ZONA ${z.toUpperCase()}`, bold: true, centro: true, fondo: 1, color: C.verde }))],
      ...d.temps.map((t) => [rot(ROTULO[t]), ...ZONAS.map((z) => ({ t: temp(fijoDeZona(d.zonas[z][t], t)), bold: true, centro: true, color: color(t) }))]),
      [rot("CONDICIÓN"), ...ZONAS.map((z) => ({ t: condicionDeZona(d, z), centro: true }))],
    ]));
    // Líneas generales de toda la provincia: centradas y con letra más grande.
    const general = (t, v) => [{ ...rot(t), size: 20 }, { t: v, size: 20, centro: true }];
    x.push(tabla([2800, W - 2800], [
      general("HUMEDAD", rango(d.humedad, "%")),
      general("PRECIPITACIONES", d.precipitaciones),
      ...(d.presion ? [general("PRESIÓN ATMOSFÉRICA", rango(d.presionRango, "hPa"))] : []),
      general("VIENTOS", d.vientos),
      general("ALERTAS", String(d.alertas ?? "").trim() || "------"),
      general("FASE LUNAR", faseDelDia(d.fecha).nombre),
    ]));
    x.push(p(`Previsión por principales ciudades de la provincia de Misiones (${fechaCorta(d.fecha)})`, { bold: true, color: C.verde2, despues: 60 }));
    const aT = 1500, aA = 1000, aC = 2500, aE = W - aC - aT * d.temps.length - aA, enc = (t) => ({ t, bold: true, fondo: 1, color: C.verde });
    x.push(tabla([aC, ...d.temps.map(() => aT), aE, aA], [
      [enc("CIUDAD"), ...d.temps.map((t) => ({ ...enc(CABECERA[t]), centro: true })), enc("ESTADO DEL TIEMPO"), enc("ALERTA")],
      ...d.ciudades.map((c) => [rot(String(c.ciudad).toUpperCase()), ...d.temps.map((t) => ({ t: temp(c[t]), bold: true, centro: true, color: color(t) })), masGrave(c.condicion), String(c.alerta ?? "").trim() || "s/a"]),
    ]));
    // Los rangos, en su propia tabla (con su propio encabezado): ocupan todo el ancho a la derecha del rótulo.
    const aR = Math.floor((W - aC) / d.temps.length);
    x.push(tabla([aC, ...d.temps.map(() => aR)], [
      [{ ...enc(""), vacia: true }, ...d.temps.map((t) => ({ ...enc(CABECERA[t]), centro: true }))],
      [rot("RANGO DE TEMPERATURAS"), ...d.temps.map((t) => ({ t: rango(resultadoDeCiudades(d, t), "°C"), bold: true, centro: true, color: color(t) }))],
    ]));
  });
  x.push(p("Fuente: Dirección General de Alerta Temprana — Ministerio de Ecología y RNR de Misiones.", { size: 16, color: C.gris, antes: 120 }));
  return x.join("");
}

/** El informe como RTF (Buffer). */
async function generarInformeRtf(b) {
  const error = errorDeInforme(b);
  if (error) throw Object.assign(new Error(error), { status: 400 });
  if (b.version !== 2) throw Object.assign(new Error("El .rtf está disponible para los informes con el formato nuevo (los 5 botones)."), { status: 400 });
  const rtf = `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl{\\f0\\fswiss Calibri;}}{\\colortbl;\\red35\\green65\\blue49;\\red62\\green108\\blue81;\\red93\\green111\\blue100;\\red179\\green38\\blue47;\\red31\\green95\\blue158;\\red234\\green242\\blue238;}\\paperw11906\\paperh16838\\margl900\\margr900\\margt900\\margb900\\f0\\fs20\n{\\header\\pard\\plain\\sa0{\\shp{\\*\\shpinst\\shpleft1453\\shptop7919\\shpright10453\\shpbottom8719\\shpbxpage\\shpbypage\\shpwr3\\shpwrk0\\shpfblwtxt1\\shpfhdr1\\shplid2049{\\sp{\\sn shapeType}{\\sv 136}}{\\sp{\\sn fFlipH}{\\sv 0}}{\\sp{\\sn gtextUNICODE}{\\sv MINISTERIO DE ECOLOG\\'cdA \\'b7 ALERTA TEMPRANA}}{\\sp{\\sn gtextFont}{\\sv Calibri}}{\\sp{\\sn fGtext}{\\sv 1}}{\\sp{\\sn fillColor}{\\sv 3227939}}{\\sp{\\sn fillOpacity}{\\sv 6554}}{\\sp{\\sn fLine}{\\sv 0}}{\\sp{\\sn rotation}{\\sv -2490368}}}{\\shprslt{}}}\\par}\n${cuerpo(b)}}`;
  return Buffer.from(rtf, "ascii");
}

module.exports = { generarInformeRtf };
