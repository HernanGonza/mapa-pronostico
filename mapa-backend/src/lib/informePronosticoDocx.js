const JSZip = require("jszip");
const { errorDeInforme } = require("./informePronosticoPdf");

/**
 * El informe de «Previsión del tiempo» (formato con plantilla, `version: 2`) como .docx, para que los medios copien y
 * reescriban los textos. A diferencia del PDF, no lleva cifrado ni marca de agua: es texto y tablas comunes de Word, sin íconos.
 * El .docx se arma a mano (un zip con cuatro partes XML) para no sumar una dependencia.
 */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ZONAS = ["Sur", "Centro", "Norte"];
const ROTULO = { tmax: "TEMPERATURAS MÁXIMAS", tmin: "TEMPERATURAS MÍNIMAS", tnoct: "TEMPERATURAS NOCTURNAS" };
const CABECERA = { tmax: "TEMP. MÁXIMA", tmin: "TEMP. MÍNIMA", tnoct: "TEMP. NOCTURNA" };
const VERDE = "234131", ROJO = "B3262F", AZUL = "1F5F9E";

const partes = (iso) => { const [a, m, d] = String(iso).split("-").map(Number); return { a, m, d, dia: DIAS[new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay()] }; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fechaLarga = (iso) => { const f = partes(iso); return cap(`${f.dia} ${f.d} de ${MESES[f.m - 1]} de ${f.a}`); };
const fechaCorta = (iso) => { const f = partes(iso); return `${String(f.d).padStart(2, "0")}/${String(f.m).padStart(2, "0")}/${f.a}`; };
const temp = (v) => { const s = String(v ?? "").trim(); return /^-?\d+([.,]\d+)?$/.test(s) ? `${s}° C` : s || "—"; };
function rango(r, u) {
  const d = String(r?.desde ?? "").trim(), h = String(r?.hasta ?? "").trim();
  if (!d) return "—";
  const f = (x) => (u === "%" ? `${x}%` : u === "°C" ? `${x}° C` : `${x} ${u}`);
  return !h || Number(h.replace(",", ".")) === Number(d.replace(",", ".")) ? f(d) : u === "%" ? `${d}% - ${h}%` : `${f(d)} a ${f(h)}`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
/** Un párrafo: `t` es el texto (los saltos de línea se respetan), con estilo opcional. */
function p(t, { bold, size = 20, color, centro, antes = 0, despues = 80, justificado } = {}) {
  const lineas = String(t ?? "").split(/\r?\n/);
  const runs = lineas.map((l, i) => `${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${esc(l)}</w:t>`).join("");
  return `<w:p><w:pPr><w:spacing w:before="${antes}" w:after="${despues}"/>${centro ? '<w:jc w:val="center"/>' : justificado ? '<w:jc w:val="both"/>' : ""}</w:pPr>` +
    `<w:r><w:rPr>${bold ? "<w:b/>" : ""}${color ? `<w:color w:val="${color}"/>` : ""}<w:sz w:val="${size}"/></w:rPr>${runs}</w:r></w:p>`;
}
/** Tabla con borde fino; `filas` es una lista de listas de celdas ({ t, bold, color, fondo } o texto). `anchos` en veinteavos de punto. */
function tabla(anchos, filas) {
  const borde = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="BFCBC4"/>`;
  const celda = (c, i) => {
    const o = typeof c === "object" && c ? c : { t: c };
    return `<w:tc><w:tcPr><w:tcW w:w="${anchos[i]}" w:type="dxa"/>${o.fondo ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fondo}"/>` : ""}<w:vAlign w:val="center"/></w:tcPr>` +
      p(String(o.t ?? "").trim() || "—", { bold: o.bold, color: o.color, size: 18, despues: 20, antes: 20, centro: o.centro }) + "</w:tc>";
  };
  return `<w:tbl><w:tblPr><w:tblW w:w="${anchos.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(borde).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${anchos.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
    filas.map((f) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${f.map(celda).join("")}</w:tr>`).join("") + "</w:tbl>" + p("", { despues: 120, size: 8 });
}

function cuerpo(b) {
  const x = [];
  x.push(p("PREVISIÓN DEL TIEMPO", { bold: true, size: 36, color: VERDE, centro: true, despues: 0 }));
  x.push(p("PARA LA PROVINCIA DE MISIONES", { bold: true, size: 24, color: "3E6C51", centro: true, despues: 0 }));
  x.push(p("Dirección General de Alerta Temprana · Subsecretaría de Ordenamiento Territorial", { size: 16, color: "5D6F64", centro: true, despues: 0 }));
  x.push(p("Ministerio de Ecología y Recursos Naturales Renovables de la Provincia de Misiones", { size: 16, color: "5D6F64", centro: true, despues: 60 }));
  x.push(p(`VIGENCIA: hasta las ${b.vigencia.hasta === "23:59" ? "23:59" : `${b.vigencia.hasta.slice(0, 2)} horas`} del ${fechaCorta(b.vigencia.fecha)}`, { bold: true, size: 20, color: ROJO, centro: true, despues: 200 }));
  const W = 10000, color = (t) => (t === "tmax" ? ROJO : AZUL);
  b.dias.forEach((d, i) => {
    x.push(p(fechaLarga(d.fecha), { bold: true, size: 28, color: VERDE, antes: i ? 300 : 0 }));
    if (String(d.resumen ?? "").trim()) x.push(p(String(d.resumen).trim(), { justificado: true, despues: 140 }));
    x.push(p(`Condiciones promedio para la provincia ${d.hoy ? "en lo que resta del día" : "para el día"} (${fechaCorta(d.fecha)})`, { bold: true, size: 20, color: "3E6C51", despues: 60 }));
    const aZ = Math.floor((W - 2800) / 3);
    x.push(tabla([2800, aZ, aZ, aZ], [
      [{ t: "", fondo: "EAF2EE" }, ...ZONAS.map((z) => ({ t: `ZONA ${z.toUpperCase()}`, bold: true, centro: true, fondo: "EAF2EE", color: VERDE }))],
      ...d.temps.map((t) => [{ t: ROTULO[t], bold: true, color: VERDE }, ...ZONAS.map((z) => ({ t: rango(d.zonas[z][t], "°C"), bold: true, centro: true, color: color(t) }))]),
    ]));
    const rot = (t) => ({ t, bold: true, color: VERDE });
    x.push(tabla([2800, W - 2800], [
      [rot("HUMEDAD"), rango(d.humedad, "%")],
      [rot("PRECIPITACIONES"), d.precipitaciones],
      ...(d.presion ? [[rot("PRESIÓN ATMOSFÉRICA"), rango(d.presionRango, "hPa")]] : []),
      [rot("VIENTOS"), d.vientos],
      [rot("ALERTAS"), String(d.alertas ?? "").trim() || "------"],
    ]));
    x.push(p(`Previsión por principales ciudades de la provincia de Misiones (${fechaCorta(d.fecha)})`, { bold: true, size: 20, color: "3E6C51", despues: 60 }));
    const aT = 1500, aA = 1000, aC = 2500, aE = W - aC - aT * d.temps.length - aA;
    const enc = (t) => ({ t, bold: true, fondo: "EAF2EE", color: VERDE });
    x.push(tabla([aC, ...d.temps.map(() => aT), aE, aA], [
      [enc("CIUDAD"), ...d.temps.map((t) => ({ ...enc(CABECERA[t]), centro: true })), enc("ESTADO DEL TIEMPO"), enc("ALERTA")],
      ...d.ciudades.map((c) => [rot(String(c.ciudad).toUpperCase()), ...d.temps.map((t) => ({ t: temp(c[t]), bold: true, centro: true, color: color(t) })), c.condicion, String(c.alerta ?? "").trim() || "s/a"]),
    ]));
  });
  x.push(p("Fuente: Dirección General de Alerta Temprana — Ministerio de Ecología y RNR de Misiones.", { size: 16, color: "5D6F64", antes: 120 }));
  return x.join("");
}

/** Marca de agua en cada página: el texto en diagonal, translúcido, en el encabezado (el WordArt que usa Word para «Marca de agua»). */
const ENCABEZADO_MARCA = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word"><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:pict>` +
  `<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>` +
  `<v:shape id="PowerPlusWaterMarkObject1" o:spid="_x0000_s2049" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:470pt;height:60pt;rotation:315;z-index:-251658752;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="#234131" stroked="f"><v:fill opacity=".1"/><v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="MINISTERIO DE ECOLOGÍA · ALERTA TEMPRANA"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r></w:p></w:hdr>`;

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
async function generarInformeDocx(b) {
  const error = errorDeInforme(b);
  if (error) throw Object.assign(new Error(error), { status: 400 });
  if (b.version !== 2) throw Object.assign(new Error("El .docx está disponible para los informes con el formato nuevo (los 5 botones)."), { status: 400 });
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>');
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:lang w:val="es-AR"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`);
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Previsión del tiempo para la provincia de Misiones — ${fechaCorta(b.fecha)}</dc:title><dc:creator>Dirección General de Alerta Temprana</dc:creator></cp:coreProperties>`);
  zip.file("word/header1.xml", ENCABEZADO_MARCA);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${cuerpo(b)}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

module.exports = { generarInformeDocx, formato: { ZONAS, ROTULO, CABECERA, fechaLarga, fechaCorta, temp, rango } };
