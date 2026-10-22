const JSZip = require("jszip");
const { errorDeInforme } = require("./informePronosticoPdf");
const { fijoDeZona, masGrave, condicionDeZona, ZONA_DE_CIUDAD } = require("./informeResumen");
const { solDeMunicipio } = require("./solar");
const { lunaDeMunicipio, faseDelDia } = require("./luna");
const { loadMunicipios } = require("./municipios");

/**
 * El informe de «Previsión del tiempo» (formato 2, el de los 5 botones) en el formato viejo de la DGAT: el .docx de siempre
 * («DATOS: TARDE-NOCHE…», datos generales, una sección por zona con su tabla de localidades, pronóstico extendido e informes de
 * cada día). Sale junto con el formato nuevo (ver informePronosticoDocx.js), en .docx y en .rtf, con lo que se carga en el formulario.
 *
 * Qué toma de cada lado:
 *  - Sol y luna: de las mismas fuentes que las tarjetas del embed (solar.js y luna.js), para Posadas.
 *  - El resto sale del formulario. El «RIESGO» del formato viejo no se carga en el formulario y no se escribe; la humedad, el viento
 *    y las alertas que el formulario tiene para toda la provincia se repiten en cada zona.
 *  - El primer día es el «DATOS»; los otros dos, el pronóstico extendido. Los tres van en «Informes de pronóstico».
 */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ZONAS = ["Norte", "Centro", "Sur"]; // el orden del formato viejo
const ZONAS_EXTENDIDO = ["Sur", "Centro", "Norte"];
const PERIODO = { A: "TARDE-NOCHE", B: "NOCHE", C: "MADRUGADA-MAÑANA" }; // por plantilla del informe
const ETIQUETA = { tmin: "MIN", tnoct: "NOCT", tmax: "MAX" };
const ORDEN_TEMPS = ["tmin", "tnoct", "tmax"];
const ABREVIADA = { "BERNARDO DE IRIGOYEN": "BDO. DE IRIGOYEN", "ARISTÓBULO DEL VALLE": "A. DEL VALLE", "LEANDRO ALEM": "L. N. ALEM" };
const CORTA = { "BERNARDO DE IRIGOYEN": "Bdo de Irigoyen", "ARISTÓBULO DEL VALLE": "A. del Valle", "LEANDRO ALEM": "Alem", "PUERTO IGUAZÚ": "Iguazú" };
const SIN_AVISOS = "SIN AVISOS ESPECIALES.";
const FUENTE = "Dirección General de Alerta Temprana – Subsecretaría de Ordenamiento Territorial - Ministerio de Ecología y RNR de la Provincia de Misiones.";
const ANCHO_TABLA = 10080;

const partes = (iso) => { const [a, m, d] = String(iso).split("-").map(Number); return { a, m, d, dia: DIAS[new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay()] }; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fechaDia = (iso) => { const f = partes(iso); return `${f.dia} ${f.d} de ${MESES[f.m - 1]}`; };
const fechaNumeros = (iso) => { const f = partes(iso); return `${f.d}/${f.m}/${f.a}`; };
const sumarDia = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const hora = (hhmm) => String(hhmm).replace(/^0(?=\d:)/, ""); // «09:38» → «9:38»
const num = (v) => { const s = String(v ?? "").trim().replace(",", "."); return s !== "" && Number.isFinite(Number(s)) ? Number(s) : null; };
const grados = (v) => { const s = String(v ?? "").trim(); return s === "" ? "—" : num(s) != null ? `${s}°C` : s; };
const gradosCortos = (v) => { const s = String(v ?? "").trim(); return s === "" ? "—" : num(s) != null ? `${s}°` : s; };
const minusculasCiudad = (c) => CORTA[c] || cap(c.toLowerCase().replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase()).replace(/ De /g, " de ").replace(/ Del /g, " del "));
function rangoTexto(r, u, sep = "-") {
  const d = String(r?.desde ?? "").trim(), h = String(r?.hasta ?? "").trim();
  if (!d) return "";
  return !h || num(h) === num(d) ? `${d} ${u}` : `${d} ${sep} ${h} ${u}`;
}

/** Posadas es la referencia de sol y luna (como el embed, que lo calcula por municipio). */
const MUNICIPIO_SOL_LUNA = "POSADAS";
async function solYLuna(fecha) {
  const m = loadMunicipios().find((x) => x.nombre.toUpperCase() === MUNICIPIO_SOL_LUNA);
  const sol = m ? await solDeMunicipio(m.id, fecha).catch(() => null) : null;
  const hoy = m ? lunaDeMunicipio(m.id, fecha) : null;
  const solTxt = sol ? `${hora(sol.amanecer)} - ${hora(sol.anochecer)}` : "sin datos";
  let lunaTxt = "sin datos";
  if (hoy) {
    // La luna que sale hoy suele ponerse después de medianoche: si no se pone antes de que termine el día, se busca en el siguiente.
    const sigue = hoy.sale && (!hoy.sePone || hoy.sePone < hoy.sale) && m ? lunaDeMunicipio(m.id, sumarDia(fecha)) : null;
    const sale = hoy.sale ? `Sale ${hora(hoy.sale)} ${fechaNumeros(fecha)}` : "";
    const sePone = hoy.sale ? (sigue?.sePone ? `Se oculta ${hora(sigue.sePone)} ${fechaNumeros(sumarDia(fecha))}` : hoy.sePone && hoy.sePone > hoy.sale ? `Se oculta ${hora(hoy.sePone)} ${fechaNumeros(fecha)}` : "")
      : hoy.sePone ? `Se oculta ${hora(hoy.sePone)} ${fechaNumeros(fecha)}` : "";
    lunaTxt = [sale, sePone].filter(Boolean).join(" - ") || "no sale ni se oculta este día";
  }
  return { sol: solTxt, luna: lunaTxt };
}

const ciudadesDe = (d, zona) => ZONA_DE_CIUDAD[zona].map((n) => d.ciudades.find((c) => String(c.ciudad).toUpperCase() === n)).filter(Boolean);

/** El aviso de una zona: lo que dicen las alertas de sus ciudades, o «sin avisos». */
function avisoDeZona(d, zona) {
  const con = ciudadesDe(d, zona).filter((c) => { const a = String(c.alerta ?? "").trim(); return a && !/^s\/?a$/i.test(a); });
  return con.length ? con.map((c) => `${String(c.ciudad).toUpperCase()} (${String(c.alerta).trim().toUpperCase()})`).join(", ") + "." : SIN_AVISOS;
}
function avisoGeneral(d) {
  const t = String(d.alertas ?? "").trim();
  if (t && !/^-+$/.test(t)) return t.toUpperCase().replace(/[.]?$/, ".");
  const con = ZONAS.filter((z) => avisoDeZona(d, z) !== SIN_AVISOS);
  return con.length ? `ALERTAS EN ZONA ${con.join(", ").toUpperCase()}.` : SIN_AVISOS;
}

/** Máxima y mínima de la provincia a partir de las ciudades: «máxima en la provincia estimada en 26°C para Posadas y la mínima sería de 10 °C en Bdo de Irigoyen.» */
function temperaturasDelDia(d) {
  const con = (t) => d.ciudades.map((c) => ({ c, v: num(c[t]) })).filter((x) => x.v != null);
  const maxs = con("tmax"), mins = con(d.temps.includes("tmin") ? "tmin" : "tnoct");
  const mayor = maxs.length ? maxs.reduce((a, b) => (b.v > a.v ? b : a)) : null, menor = mins.length ? mins.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  const partesT = [];
  if (mayor) partesT.push(`máxima en la provincia estimada en ${mayor.v}°C para ${minusculasCiudad(String(mayor.c.ciudad).toUpperCase())}`);
  if (menor) partesT.push(`${mayor ? "la " : ""}${d.temps.includes("tmin") ? "mínima" : "nocturna más baja"} ${mayor ? "sería de" : "estimada en"} ${menor.v}°C en ${minusculasCiudad(String(menor.c.ciudad).toUpperCase())}`);
  return partesT.length ? `Temperaturas: ${partesT.join(" y ")}.` : "";
}

/**
 * El informe como bloques neutros (párrafos y tablas) que después pintan el .docx y el .rtf.
 * párrafo: { p: [{ t, b?, color? }], antes?, despues?, derecha?, fondo? }   tabla: { tabla: [[celda]], anchos, alto }
 */
async function bloques(b) {
  const x = [];
  const par = (t, o = {}) => x.push({ p: [{ t, b: o.b, color: o.color }], despues: o.despues ?? 240, derecha: o.derecha, fondo: o.fondo });
  const blancos = (n, despues = 240) => { for (let i = 0; i < n; i++) x.push({ p: [], despues }); };
  const [d1, ...siguientes] = b.dias;
  const f1 = partes(d1.fecha);
  const { sol, luna } = await solYLuna(d1.fecha);
  const temps = ORDEN_TEMPS.filter((t) => d1.temps.includes(t));
  const humedad = rangoTexto(d1.humedad, "%"), presion = d1.presion ? rangoTexto(d1.presionRango, "HPA", "–") : "";
  const vientos = String(d1.vientos ?? "").trim();

  blancos(1);
  par(`DATOS: ${PERIODO[b.plantilla] || ""} ${f1.dia.toUpperCase()} ${f1.d} DE ${MESES[f1.m - 1].toUpperCase()} DE ${f1.a} `.replace("  ", " "), { b: true });
  blancos(1);
  par("DATOS GENERALES", { b: true });
  par(`SOL: ${sol}`);
  par(`LUNA: ${luna}`);
  if (vientos) par(`VIENTOS: ${vientos}`);
  if (humedad) par(`HUMEDAD: ${humedad}`);
  if (presion) par(`PRESIÓN: ${presion}`);
  par(`FASE LUNAR: ${faseDelDia(d1.fecha).nombre.toUpperCase()}.`);
  blancos(1);
  for (const z of ZONAS) {
    par(z.toUpperCase(), { b: true });
    par(`${temps.map((t) => ETIQUETA[t]).join(" – ")}      ${temps.map((t) => grados(fijoDeZona(d1.zonas[z][t], t))).join("      ")}   ${condicionDeZona(d1, z).toUpperCase()}`);
  }
  blancos(1);
  par(`AVISO DE ALERTA: ${avisoGeneral(d1)}`);
  blancos(2);

  const sepZonas = { Norte: 7, Centro: 5, Sur: 9 };
  for (const z of ZONAS) {
    par(`ZONA ${z.toUpperCase()}`, { b: true });
    par(`S.T. ${temps.map((t) => grados(fijoDeZona(d1.zonas[z][t], t))).join(" / ")}`);
    if (humedad) par(`HUMEDAD: ${humedad}`);
    if (vientos) par(`V: ${vientos}`);
    par(" ", { b: true });
    const aT = 1150, anchos = [3090, ...temps.map(() => aT), ANCHO_TABLA - 3090 - aT * temps.length];
    x.push({
      anchos, alto: 794, tabla: [
        [...["LOCALIDAD", ...temps.map((t) => ` ${ETIQUETA[t]}`), " CONDICIÓN ESPERADA"].map((t) => ({ t, b: true }))],
        ...ciudadesDe(d1, z).map((c) => [{ t: ABREVIADA[String(c.ciudad).toUpperCase()] || String(c.ciudad).toUpperCase(), centro: true }, ...temps.map((t) => ({ t: gradosCortos(c[t]), centro: true })), { t: masGrave(c.condicion).toUpperCase(), centro: true }]),
      ],
    });
    par(`AVISO DE ALERTA: ${avisoDeZona(d1, z)}`);
    blancos(sepZonas[z]);
  }

  if (siguientes.length) {
    par("PRONÓSTICO EXTENDIDO", { b: true });
    par(" ", { b: true });
    for (const z of ZONAS_EXTENDIDO) {
      par(`ZONA ${z.toUpperCase()}`, { b: true, despues: 140 });
      for (const d of siguientes) {
        const mn = d.temps.includes("tmin") ? "tmin" : "tnoct";
        const f = partes(d.fecha);
        const mx = d.temps.includes("tmax") ? grados(fijoDeZona(d.zonas[z].tmax, "tmax")) : "";
        par([`${f.dia.toUpperCase()} ${f.d} DE ${MESES[f.m - 1].toUpperCase()}`, grados(fijoDeZona(d.zonas[z][mn], mn)).replace("°C", " °C"), mx && mx.replace("°C", " °C"), condicionDeZona(d, z).toUpperCase()].filter(Boolean).join("  "), { despues: 140 });
      }
      blancos(1, 140);
    }
    blancos(8, 140);
  }

  par("INFORMES DE PRONÓSTICO", { b: true, despues: 140 });
  const gris = "222222", cuerpo = { color: gris, fondo: true, derecha: 279 };
  b.dias.forEach((d) => {
    blancos(1);
    par(cap(fechaDia(d.fecha)), { ...cuerpo, b: true });
    if (String(d.resumen ?? "").trim()) par(String(d.resumen).trim(), cuerpo);
    if (String(d.precipitaciones ?? "").trim()) par(`Precipitaciones: ${String(d.precipitaciones).trim().replace(/\.$/, "")}.`, cuerpo);
    if (String(d.vientos ?? "").trim()) par(`Vientos: ${String(d.vientos).trim().replace(/\.$/, "")}.`, cuerpo);
    const t = temperaturasDelDia(d);
    if (t) par(t, cuerpo);
  });
  blancos(1);
  x.push({ p: [{ t: "FUENTE: ", b: true }, { t: FUENTE }], despues: 240, derecha: 279 });
  return x;
}

// --- .docx -------------------------------------------------------------------------------------------------------
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const FUENTE_DOCX = '<w:rFonts w:ascii="Verdana" w:cs="Verdana" w:eastAsia="Verdana" w:hAnsi="Verdana"/>';
const rpr = (r) => `<w:rPr>${FUENTE_DOCX}${r.b ? '<w:b w:val="1"/><w:bCs w:val="1"/>' : ""}${r.color ? `<w:color w:val="${r.color}"/>` : ""}<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>`;
function parrafoDocx(bl, centro = false, bold = false) {
  const runs = bl.p.map((r) => `<w:r>${rpr({ ...r, b: r.b || bold })}<w:t xml:space="preserve">${esc(r.t)}</w:t></w:r>`).join("");
  const base = bl.p[0] || {};
  return `<w:p><w:pPr>${bl.fondo ? '<w:shd w:fill="ffffff" w:val="clear"/>' : ""}<w:spacing w:after="${bl.despues}" w:before="240" w:line="276" w:lineRule="auto"/>${bl.derecha ? `<w:ind w:right="${bl.derecha}"/>` : ""}<w:jc w:val="${centro ? "center" : "both"}"/>${rpr({ ...base, b: base.b || bold })}</w:pPr>${runs}</w:p>`;
}
function tablaDocx(bl) {
  const borde = (n, si) => `<w:${n} w:color="000000" w:space="0" w:sz="${si ? 5 : 0}" w:val="${si ? "single" : "nil"}"/>`;
  const filas = bl.tabla.map((fila, r) => `<w:tr><w:trPr><w:cantSplit w:val="0"/><w:trHeight w:val="${bl.alto}" w:hRule="atLeast"/><w:tblHeader w:val="0"/></w:trPr>${fila.map((c, i) =>
    `<w:tc><w:tcPr><w:tcW w:w="${bl.anchos[i]}" w:type="dxa"/><w:tcBorders>${borde("top", r === 0)}${borde("left", i === 0)}${borde("bottom", true)}${borde("right", true)}</w:tcBorders><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>` +
    parrafoDocx({ p: [{ t: c.t, b: c.b }], despues: 240 }, c.centro) + "</w:tc>").join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${ANCHO_TABLA}" w:type="dxa"/><w:tblInd w:w="15" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${bl.anchos.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${filas}</w:tbl>`;
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
function comprobar(b) {
  const error = errorDeInforme(b);
  if (error) throw Object.assign(new Error(error), { status: 400 });
  if (b.version !== 2) throw Object.assign(new Error("El formato viejo está disponible para los informes con el formato nuevo (los 5 botones)."), { status: 400 });
}

async function generarInformeViejoDocx(b) {
  comprobar(b);
  const cuerpo = (await bloques(b)).map((bl) => (bl.tabla ? tablaDocx(bl) : parrafoDocx(bl))).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="es-419"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl w:val="0"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="normal"/></w:style></w:styles>`);
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Pronóstico ${esc(fechaNumeros(b.fecha))} (formato viejo)</dc:title><dc:creator>Dirección General de Alerta Temprana</dc:creator></cp:coreProperties>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:background w:color="FFFFFF"/><w:body>${cuerpo}<w:sectPr><w:pgSz w:h="16838" w:w="11906" w:orient="portrait"/><w:pgMar w:bottom="1417" w:top="992" w:left="1134" w:right="565" w:header="0" w:footer="720"/><w:pgNumType w:start="1"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// --- .rtf --------------------------------------------------------------------------------------------------------
function escRtf(s) {
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
// Tabla de colores: 1 = gris del texto de los informes (222222).
const runRtf = (r) => `${r.color ? "\\cf1" : ""}${r.b ? "\\b" : ""}\\fs28 ${escRtf(r.t)}\\b0\\cf0 `;
function parrafoRtf(bl, centro = false) {
  const twips = (v) => Math.round(v);
  return `\\pard\\sb240\\sa${twips(bl.despues)}${bl.derecha ? `\\ri${twips(bl.derecha)}` : ""}${centro ? "\\qc" : "\\qj"}\\sl276\\slmult1 ${bl.p.map(runRtf).join("")}\\par\n`;
}
function tablaRtf(bl) {
  const borde = (n, si) => `\\clbrdr${n}${si ? "\\brdrs\\brdrw10" : "\\brdrnil"}`;
  return bl.tabla.map((fila, r) => `\\trowd\\trgaph100\\trleft15\\trrh${bl.alto}\\trcantsplit\n${fila.map((_, i) => `${borde("t", r === 0)}${borde("l", i === 0)}${borde("b", true)}${borde("r", true)}\\cellx${15 + bl.anchos.slice(0, i + 1).reduce((a, w) => a + w, 0)}`).join("")}\n` +
    fila.map((c) => `\\pard\\intbl\\sb240\\sa240${c.centro ? "\\qc" : "\\qj"}\\sl276\\slmult1 ${runRtf({ t: c.t, b: c.b })}\\cell\n`).join("") + "\\row\n").join("");
}
async function generarInformeViejoRtf(b) {
  comprobar(b);
  const cuerpo = (await bloques(b)).map((bl) => (bl.tabla ? tablaRtf(bl) : parrafoRtf(bl))).join("");
  const rtf = `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl{\\f0\\fswiss Verdana;}}{\\colortbl;\\red34\\green34\\blue34;}\\paperw11906\\paperh16838\\margl1134\\margr565\\margt992\\margb1417\\f0\\fs28\n${cuerpo}}`;
  return Buffer.from(rtf, "ascii");
}

module.exports = { generarInformeViejoDocx, generarInformeViejoRtf, bloques };
