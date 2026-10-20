const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PDFDocument = require("pdfkit");
const { partesCondicion, CATALOGO } = require("./condiciones");
const { fijoDeZona, masGrave, condicionDeZona, resultadoDeCiudades } = require("./informeResumen");
const { DIR_ICONOS } = require("./iconResolver");
const { faseDelDia } = require("./luna");

/**
 * Informe «PREVISIÓN DEL TIEMPO PARA LA PROVINCIA DE MISIONES» en PDF, armado desde lo que se carga en el panel
 * (ya no se usa Word). Sigue la estructura del informe de la DGAT (el .docx): primero el texto de cada día y después las tablas
 * (provincia, zonas, principales ciudades y pronóstico extendido por zona).
 *
 * Protección: el PDF sale cifrado (AES-256) con clave de propietario propia y permisos acotados (se puede abrir e
 * imprimir; no copiar, modificar ni anotar). La clave es `PDF_OWNER_PASSWORD` del entorno; sin ella se usa una al azar
 * por archivo (nadie la conoce: el documento queda sellado). Lleva marca de agua en cada página.
 *
 * El borrador (`b`) es el del asistente del panel (mapa-frontend/src/components/InformePronostico.jsx):
 * {
 *   fecha: "AAAA-MM-DD", emision: "09:00",
 *   generales: { vientos, humedad, presion, riesgo }, avisoGeneral,
 *   zonas: { Norte|Centro|Sur: { tmin, tmax, condicion, aviso, humedad, viento, riesgo } },
 *   localidades: [{ localidad, zona, tmin, tmax, condicion }],
 *   extendido: { Norte|Centro|Sur: [{ fecha, tmin, tmax, condicion }] },
 *   informes: [{ fecha, resumen, precipitaciones, vientos, temperaturas }],
 * }
 */
const DATA = path.join(__dirname, "..", "..", "data");
const FUENTE = { normal: path.join(DATA, "alertas", "OakSans-Regular.ttf"), bold: path.join(DATA, "alertas", "OakSans-Bold.ttf"), titulo: path.join(DATA, "alertas", "aviso-especial", "OakSans-ExtraBold.ttf") };
const LOGOS = { alerta: path.join(DATA, "brand", "alerta-temprana.png"), flor: path.join(DATA, "brand", "ecologia-flor.png") };

// Nombres completos (encabezado, pie y fuente del informe).
const DIRECCION = "Dirección General de Alerta Temprana";
const SUBSECRETARIA = "Subsecretaría de Ordenamiento Territorial";
const MINISTERIO = "Ministerio de Ecología y Recursos Naturales Renovables de la Provincia de Misiones";

const VERDE = "#3E6C51", VERDE_OSCURO = "#234131", CREMA = "#FAF4EB", GRIS = "#5d6f64", LINEA = "#cdd8d1", ROJO = "#B3262F", AZUL = "#1F5F9E";
const ZONAS = ["Norte", "Centro", "Sur"];
const M = 36, ANCHO = 595.28 - 2 * M, PIE = 36;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const fechaPartes = (iso) => { const [a, m, d] = String(iso).split("-").map(Number); const f = new Date(Date.UTC(a, m - 1, d, 12)); return { a, m, d, dia: DIAS[f.getUTCDay()] }; };
const fechaLarga = (iso) => { const f = fechaPartes(iso); return `${f.dia} ${f.d} de ${MESES[f.m - 1]} de ${f.a}`; };
const fechaDia = (iso) => { const f = fechaPartes(iso); return `${f.dia} ${f.d} de ${MESES[f.m - 1]}`; };
const fechaCorta = (iso) => { const f = fechaPartes(iso); return `${String(f.d).padStart(2, "0")}/${String(f.m).padStart(2, "0")}/${f.a}`; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const temp = (v) => { const s = String(v ?? "").trim(); return /^-?\d+([.,]\d+)?$/.test(s) ? `${s}°C` : s || "—"; };

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v, max = 1200) => typeof v === "string" && v.length <= max;

const TEMPS_V2 = ["tmax", "tmin", "tnoct"];
/** Formato con plantilla (`version: 2`, ver mapa-frontend/src/lib/informePlantillas.js): 3 días, cada uno con sus `temps`. */
function errorDeInformeV2(b) {
  if (!RE_FECHA.test(String(b.fecha || ""))) return "Falta la fecha del informe.";
  if (!b.vigencia || !/^\d{2}:\d{2}$/.test(String(b.vigencia.hasta || "")) || !RE_FECHA.test(String(b.vigencia.fecha || ""))) return "Falta la vigencia del informe.";
  if (!Array.isArray(b.dias) || b.dias.length !== 3) return "El informe tiene que tener tres días.";
  for (const d of b.dias) {
    if (!d || !RE_FECHA.test(String(d.fecha || ""))) return "Falta la fecha de un día.";
    if (!Array.isArray(d.temps) || !d.temps.length || d.temps.some((t) => !TEMPS_V2.includes(t))) return "Las temperaturas de un día no son válidas.";
    if (!d.zonas || ZONAS.some((z) => !d.zonas[z] || d.temps.some((t) => typeof d.zonas[z][t] !== "object" || !d.zonas[z][t]))) return "Faltan las tres zonas de un día.";
    if (!Array.isArray(d.ciudades) || d.ciudades.length > 40) return "Las ciudades de un día no son válidas.";
  }
  if (JSON.stringify(b).length > 200000 || b.dias.some((d) => [d.resumen, d.precipitaciones, d.vientos, d.alertas].some((t) => t != null && !texto(String(t), 2000)))) return "Hay un texto demasiado largo.";
  return null;
}

/** Valida la forma del borrador (los textos pueden venir vacíos: el PDF se puede bajar incompleto, como el borrador). */
function errorDeInforme(b) {
  if (!b || typeof b !== "object") return "Falta el informe.";
  if (b.version === 2) return errorDeInformeV2(b);
  if (!RE_FECHA.test(String(b.fecha || ""))) return "Falta la fecha del informe.";
  if (!b.zonas || ZONAS.some((z) => typeof b.zonas[z] !== "object" || !b.zonas[z])) return "Faltan las tres zonas.";
  if (!Array.isArray(b.localidades) || b.localidades.length > 40) return "Las localidades no son válidas.";
  if (!b.extendido || ZONAS.some((z) => !Array.isArray(b.extendido[z]) || b.extendido[z].length > 5)) return "El pronóstico extendido no es válido.";
  if (!Array.isArray(b.informes) || b.informes.length > 5) return "Los informes de los días no son válidos.";
  const campos = [...Object.values(b.generales || {}), b.avisoGeneral, ...ZONAS.flatMap((z) => Object.values(b.zonas[z])), ...b.localidades.flatMap((l) => Object.values(l)),
    ...ZONAS.flatMap((z) => b.extendido[z].flatMap((d) => Object.values(d))), ...b.informes.flatMap((i) => Object.values(i))];
  if (campos.some((c) => c != null && !texto(String(c), 2000))) return "Hay un texto demasiado largo.";
  return null;
}

// --- íconos: los PNG del SMN (data/iconos-smn), leídos una vez --------------------------------------------------
const cachePng = new Map();
const iconoPng = async (archivo) => {
  const nombre = path.basename(archivo); // «smn/3.png» → 3.png
  if (!cachePng.has(nombre)) cachePng.set(nombre, fs.readFileSync(path.join(DIR_ICONOS, nombre)));
  return cachePng.get(nombre);
};

/** Las condiciones de un texto con sus íconos de día ya cargados. */
async function condiciones(textoCond) {
  return Promise.all(partesCondicion(textoCond).map(async (c) => ({ nombre: c.nombre, dia: await iconoPng(c.dia), noche: await iconoPng(c.noche) })));
}

async function generarInformePdf(b, { claveDuenio = process.env.PDF_OWNER_PASSWORD } = {}) {
  const error = errorDeInforme(b);
  if (error) throw Object.assign(new Error(error), { status: 400 });

  // Los íconos se piden antes de dibujar (el dibujo es síncrono): una vez por texto de condición distinto.
  const v2 = b.version === 2;
  const textos = v2 ? new Set(b.dias.flatMap((d) => d.ciudades.map((c) => masGrave(c.condicion)))) : new Set([...ZONAS.map((z) => b.zonas[z].condicion), ...b.localidades.map((l) => l.condicion), ...ZONAS.flatMap((z) => b.extendido[z].map((d) => d.condicion))]);
  const iconos = new Map(await Promise.all([...textos].map(async (t) => [t, await condiciones(t)])));

  const chunks = [];
  const doc = new PDFDocument({
    size: "A4", margins: { top: M, bottom: PIE + 18, left: M, right: M }, bufferPages: true, pdfVersion: "1.7ext3",
    ownerPassword: claveDuenio || crypto.randomBytes(24).toString("hex"),
    permissions: { printing: "highResolution", modifying: false, copying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false },
    info: { Title: `Previsión del tiempo para la provincia de Misiones — ${fechaCorta(b.fecha)}`, Author: "Dirección General de Alerta Temprana — Ministerio de Ecología y RNR de Misiones", Subject: "Previsión del tiempo", Creator: "Sistema de Alerta Temprana" },
  });
  doc.on("data", (c) => chunks.push(c));
  const terminado = new Promise((ok, mal) => { doc.on("end", () => ok(Buffer.concat(chunks))); doc.on("error", mal); });
  doc.registerFont("Oak", FUENTE.normal); doc.registerFont("Oak-Bold", FUENTE.bold); doc.registerFont("Oak-Titulo", FUENTE.titulo);

  const limite = () => doc.page.height - doc.page.margins.bottom;
  /** Si lo que sigue no entra en lo que queda de la página, pasa a la siguiente. */
  const espacio = (alto) => { if (doc.y + alto > limite()) doc.addPage(); };

  function marcaDeAgua() {
    doc.save();
    doc.fillOpacity(0.055).fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(46);
    doc.rotate(-38, { origin: [doc.page.width / 2, doc.page.height / 2] });
    const t1 = "MINISTERIO DE ECOLOGÍA", t2 = "ALERTA TEMPRANA";
    doc.text(t1, 0, doc.page.height / 2 - 52, { width: doc.page.width, align: "center", lineBreak: false });
    doc.fontSize(34).text(t2, 0, doc.page.height / 2 + 4, { width: doc.page.width, align: "center", lineBreak: false });
    doc.restore();
  }
  let numero = 0;
  function encabezadoDePagina() {
    numero++;
    marcaDeAgua();
    if (numero === 1) return;
    doc.font("Oak-Bold").fontSize(8).fillColor(GRIS).text(`PREVISIÓN DEL TIEMPO · MISIONES · ${fechaCorta(b.fecha)}`, M, 18, { width: ANCHO, lineBreak: false });
    doc.y = M;
  }
  doc.on("pageAdded", encabezadoDePagina);
  encabezadoDePagina();

  // --- piezas ---------------------------------------------------------------------------------------------------
  const barra = (titulo, color = VERDE) => {
    espacio(30);
    const y = doc.y;
    doc.roundedRect(M, y, ANCHO, 20, 4).fill(color);
    doc.fillColor("#fff").font("Oak-Bold").fontSize(10.5).text(titulo.toUpperCase(), M + 10, y + 5.5, { width: ANCHO - 20, lineBreak: false });
    doc.y = y + 26;
  };
  /** Íconos de día (hasta `maxIconos`) y el texto de una condición, en una celda de `ancho`. */
  const celdaCondicion = (x, y, ancho, textoCond, alto, maxIconos = 4, centro = false) => {
    const lista = (iconos.get(textoCond) || []).slice(0, maxIconos);
    let cx = x;
    if (centro) { // íconos y texto juntos, centrados en la celda
      doc.font("Oak").fontSize(8.5);
      const tw = Math.min(ancho - lista.length * 21 - 3, doc.widthOfString(textoCond || "—"));
      cx = x + Math.max(0, (ancho - (lista.length * 21 + 3 + tw)) / 2);
    }
    for (const c of lista) { doc.image(c.dia, cx, y + (alto - 20) / 2, { width: 20, height: 20 }); cx += 21; }
    const ancho_t = x + ancho - cx - 3;
    doc.fillColor("#1b2a22").font("Oak").fontSize(8.5);
    const h = doc.heightOfString(textoCond || "—", { width: ancho_t });
    doc.text(textoCond || "—", cx + 3, y + Math.max(2, (alto - h) / 2), { width: ancho_t });
  };
  const maxIconosEn = (ancho) => Math.max(1, Math.floor((ancho - 70) / 21));
  /**
   * Tabla con título, encabezado de columnas y una fila por registro. Cada celda es un texto o un objeto
   * { t, color, bold } (texto con estilo) o { cond } (íconos + condición). `cols`: [{ t, w, centro }].
   */
  const tabla = (titulo, cols, filas, opc = {}) => {
    const xs = []; let acc = M; for (const c of cols) { xs.push(acc); acc += c.w; }
    // Una celda puede traer su propio ancho `w` (para juntar columnas en una fila): si no, usa el de su columna.
    const huecos = (fila) => { let x = M; return fila.map((cel, i) => { const w = (typeof cel === "object" && cel && cel.w) || cols[i].w; const h = { x, w }; x += w; return h; }); };
    const alturaFila = (fila) => Math.max(opc.minAlto || 28, ...fila.map((cel, i) => {
      const c = typeof cel === "object" && cel ? cel : { t: cel };
      const { w } = huecos(fila)[i], ancho = w - 8;
      if (c.cond !== undefined) { const n = Math.min((iconos.get(c.cond) || []).length, maxIconosEn(w)); doc.font("Oak").fontSize(8.5); return doc.heightOfString(c.cond || "—", { width: ancho - n * 21 }) + 7; }
      doc.font(c.bold ? "Oak-Bold" : "Oak").fontSize(c.size || 9); return doc.heightOfString(String(c.t ?? "") || "—", { width: ancho }) + 7;
    }));
    espacio((titulo ? 30 : 0) + 16 + 28); // el título, el encabezado y al menos una fila juntos
    if (titulo) barra(titulo);
    const encabezado = () => {
      if (cols.every((c) => !c.t)) return; // tabla de rótulo y valor: sin fila de encabezado
      const y = doc.y;
      doc.rect(M, y, ANCHO, 16).fill("#eaf2ee");
      doc.fillColor(VERDE_OSCURO).font("Oak-Bold").fontSize(7.5);
      cols.forEach((c, i) => doc.text(c.t, xs[i] + 4, y + 4.5, { width: c.w - 8, align: c.centro ? "center" : "left", lineBreak: false }));
      doc.y = y + 16;
    };
    encabezado();
    filas.forEach((fila, k) => {
      const alto = alturaFila(fila);
      // `reserva`: lo que va pegado debajo de la tabla (otra tabla): así la última fila no deja a esa otra sola en la página siguiente.
      const junto = k === filas.length - 1 ? alto + (opc.reserva || 0) : alto;
      if (doc.y + junto > limite()) { doc.addPage(); encabezado(); }
      const y = doc.y;
      const sitio = huecos(fila);
      fila.forEach((cel, i) => {
        const c = typeof cel === "object" && cel ? cel : { t: cel };
        const { x, w } = sitio[i], centro = c.centro ?? cols[i].centro;
        if (c.cond !== undefined) { celdaCondicion(x + 4, y, w - 8, c.cond, alto, maxIconosEn(w), centro); return; }
        const t = String(c.t ?? "").trim() || "—";
        doc.fillColor(c.color || "#1b2a22").font(c.bold ? "Oak-Bold" : "Oak").fontSize(c.size || 9);
        const h = doc.heightOfString(t, { width: w - 8, align: centro ? "center" : "left" });
        doc.text(t, x + 4, y + (alto - h) / 2, { width: w - 8, align: centro ? "center" : "left" });
      });
      doc.moveTo(M, y + alto).lineTo(M + ANCHO, y + alto).lineWidth(0.5).strokeColor(LINEA).stroke();
      doc.y = y + alto;
    });
    doc.y += opc.hueco ?? 12;
  };
  const titulo_ = (t) => t.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
  const ALERTA_VACIA = "—";
  const sinAviso = (v) => { const t = String(v ?? "").trim(); return t && !/^sin\s+avisos?\.?$/i.test(t) ? t : "S/A"; };

  // --- encabezado -----------------------------------------------------------------------------------------------
  doc.image(LOGOS.alerta, M - 6, M - 14, { width: 92 });
  doc.image(LOGOS.flor, M + ANCHO - 44, M - 2, { width: 44 });
  // El título va centrado en la página (los logos quedan a los costados, sin tocarlo).
  const centro = { x: M, width: ANCHO, align: "center", lineBreak: false };
  doc.fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(18).text("PREVISIÓN DEL TIEMPO", centro.x, M - 6, centro);
  doc.font("Oak-Bold").fontSize(11.5).fillColor(VERDE).text("PARA LA PROVINCIA DE MISIONES", centro.x, M + 16, centro);
  doc.font("Oak-Bold").fontSize(8.5).fillColor(VERDE_OSCURO).text(DIRECCION, centro.x, M + 33, centro);
  doc.font("Oak").fontSize(7.5).fillColor(GRIS).text(SUBSECRETARIA, centro.x, M + 44, centro);
  doc.text(MINISTERIO, centro.x, M + 54, centro);
  if (v2) doc.font("Oak-Bold").fontSize(10).fillColor(ROJO).text(`VIGENCIA: hasta las ${b.vigencia.hasta === "23:59" ? "23:59" : `${b.vigencia.hasta.slice(0, 2)} horas`} del ${fechaCorta(b.vigencia.fecha)}`, centro.x, M + 69, centro);
  else doc.font("Oak").fontSize(9).fillColor(GRIS).text(`Datos: ${cap(fechaLarga(b.fecha))}${b.emision ? ` · emisión ${b.emision} h` : ""}`, centro.x, M + 70, centro);
  doc.moveTo(M, M + 86).lineTo(M + ANCHO, M + 86).lineWidth(1.5).strokeColor(VERDE).stroke();
  doc.y = M + 98;

  /** Rango «20° C a 22° C» / «40% - 80%» / «1014 hPa a 1017 hPa» (un solo valor si no hay «hasta» o es igual). */
  const rangoV2 = (r, u) => {
    const d = String(r?.desde ?? "").trim(), h = String(r?.hasta ?? "").trim();
    if (!d) return "—";
    const f = (x) => (u === "%" ? `${x}%` : u === "°C" ? `${x}° C` : `${x} ${u}`);
    return !h || Number(h.replace(",", ".")) === Number(d.replace(",", ".")) ? f(d) : u === "%" ? `${d}% - ${h}%` : `${f(d)} a ${f(h)}`;
  };
  const ROTULO_V2 = { tmax: "TEMPERATURAS MÁXIMAS", tmin: "TEMPERATURAS MÍNIMAS", tnoct: "TEMPERATURAS NOCTURNAS" };
  const CABECERA_V2 = { tmax: "TEMP. MÁXIMA", tmin: "TEMP. MÍNIMA", tnoct: "TEMP. NOCTURNA" };
  const colorV2 = (t) => (t === "tmax" ? ROJO : AZUL);
  function contenidoV2() {
    const rot = (t) => ({ t, bold: true, color: VERDE_OSCURO });
    const POR_ZONA_V2 = ["Sur", "Centro", "Norte"];
    b.dias.forEach((d, i) => {
      if (i > 0) doc.addPage();
      doc.fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(13).text(cap(fechaLarga(d.fecha)), M + 2, doc.y, { width: ANCHO });
      doc.y += 4;
      if (String(d.resumen ?? "").trim()) { doc.fillColor("#1b2a22").font("Oak").fontSize(9.5).text(String(d.resumen).trim(), M + 2, doc.y, { width: ANCHO - 6, align: "justify" }); doc.y += 8; }
      tabla(`Condiciones promedio para la provincia ${d.hoy ? "en lo que resta del día" : "para el día"} (${fechaCorta(d.fecha)})`,
        [{ t: "", w: 150 }, ...POR_ZONA_V2.map((z) => ({ t: `ZONA ${z.toUpperCase()}`, w: (ANCHO - 150) / 3, centro: true }))],
        [...d.temps.map((t) => [rot(ROTULO_V2[t]), ...POR_ZONA_V2.map((z) => ({ t: rangoV2({ desde: fijoDeZona(d.zonas[z][t], t) }, "°C"), bold: true, color: colorV2(t) }))]),
          [rot("CONDICIÓN"), ...POR_ZONA_V2.map((z) => ({ t: condicionDeZona(d, z), centro: true }))]], { minAlto: 20, hueco: 0 });
      // Líneas generales de toda la provincia: ocupan el ancho de las tres zonas, centradas y con letra más grande.
      const general = (t, v) => [{ ...rot(t), size: 10 }, { t: v, size: 10, centro: true }];
      tabla(null, [{ t: "", w: 150 }, { t: "", w: ANCHO - 150 }], [
        general("HUMEDAD", rangoV2(d.humedad, "%")),
        general("PRECIPITACIONES", d.precipitaciones),
        ...(d.presion ? [general("PRESIÓN ATMOSFÉRICA", rangoV2(d.presionRango, "hPa"))] : []),
        general("VIENTOS", d.vientos),
        general("ALERTAS", String(d.alertas ?? "").trim() || "------"),
        general("FASE LUNAR", faseDelDia(d.fecha).nombre),
      ], { minAlto: 20, hueco: 6 });
      const anchoT = 78, anchoA = 54, anchoC = 120; // anchoT: que «TEMP. NOCTURNA» entre en una línea
      tabla(`Previsión por principales ciudades de la provincia de Misiones (${fechaCorta(d.fecha)})`, [
        { t: "CIUDAD", w: anchoC }, ...d.temps.map((t) => ({ t: CABECERA_V2[t], w: anchoT, centro: true })), { t: "ESTADO DEL TIEMPO", w: ANCHO - anchoC - anchoT * d.temps.length - anchoA }, { t: "ALERTA", w: anchoA },
      ], d.ciudades.map((c) => [rot(String(c.ciudad).toUpperCase()), ...d.temps.map((t) => ({ t: temp(c[t]), bold: true, color: colorV2(t) })), { cond: masGrave(c.condicion) }, String(c.alerta ?? "").trim() || "s/a"]), { minAlto: 20, hueco: 0, reserva: 46 });
      // Los rangos, en su propia tabla (no comparte encabezados con la de ciudades): ocupan todo el ancho a la derecha del rótulo.
      tabla(null, [{ t: "", w: anchoC }, ...d.temps.map((t) => ({ t: CABECERA_V2[t], w: (ANCHO - anchoC) / d.temps.length, centro: true }))], [
        [rot("RANGO DE TEMPERATURAS"), ...d.temps.map((t) => ({ t: rangoV2(resultadoDeCiudades(d, t), "°C"), bold: true, color: colorV2(t) }))],
      ], { minAlto: 30 });
    });
  }

  // El orden es el del informe de la DGAT: primero el texto de cada día y después las tablas.
  if (v2) contenidoV2(); else {
  // --- texto de los días ------------------------------------------------------------------------------------------
  for (const inf of b.informes) {
    espacio(70);
    doc.fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(11).text(cap(fechaDia(inf.fecha)), M + 2, doc.y, { width: ANCHO });
    doc.y += 4;
    const partes = [[null, inf.resumen], ["Precipitaciones", inf.precipitaciones], ["Vientos", inf.vientos], ["Temperaturas", inf.temperaturas], ["Recomendaciones", inf.recomendaciones]].filter(([, t]) => String(t ?? "").trim());
    for (const [rotulo, t] of partes) {
      doc.font("Oak").fontSize(9.5);
      const alto = doc.heightOfString(`${rotulo ? `${rotulo}: ` : ""}${t}`, { width: ANCHO - 6 }) + 5;
      espacio(alto);
      if (rotulo) doc.fillColor("#1b2a22").font("Oak-Bold").text(`${rotulo}: `, M + 2, doc.y, { width: ANCHO - 6, continued: true }).font("Oak").text(String(t).trim());
      else doc.fillColor("#1b2a22").font("Oak").text(String(t).trim(), M + 2, doc.y, { width: ANCHO - 6, align: "justify" });
      doc.y += 4;
    }
    doc.y += 8;
  }
  doc.y += 4;

  // --- previsión para la provincia --------------------------------------------------------------------------------
  const g = b.generales || {};
  const conTemp = b.localidades.filter((l) => l.tmin !== "" && l.tmin != null).map((l) => ({ n: Number(String(l.tmin).replace(",", ".")), l })).filter((x) => Number.isFinite(x.n));
  const conTempMax = b.localidades.map((l) => ({ n: Number(String(l.tmax).replace(",", ".")), l })).filter((x) => Number.isFinite(x.n) && String(x.l.tmax).trim() !== "");
  const extremo = (lista, cmp) => { if (!lista.length) return ""; const e = lista.reduce((a, x) => (cmp(x.n, a.n) ? x : a)); return `${temp(e.n)} en ${titulo_(e.l.localidad)}`; };
  const rotulo = (t) => ({ t, bold: true, color: VERDE_OSCURO });
  tabla("Previsión para la provincia de Misiones", [{ t: "", w: 130 }, { t: "", w: ANCHO - 130 }], [
    [rotulo("TEMP. MÍNIMA"), extremo(conTemp, (a, b2) => a < b2)],
    [rotulo("TEMP. MÁXIMA"), extremo(conTempMax, (a, b2) => a > b2)],
    [rotulo("HUMEDAD"), g.humedad],
    [rotulo("PRECIPITACIONES"), b.informes[0]?.precipitaciones],
    [rotulo("VIENTOS"), g.vientos],
  ]);

  // --- previsión por zonas (en el orden del informe: Sur, Centro, Norte) -------------------------------------------
  const POR_ZONA = ["Sur", "Centro", "Norte"];
  tabla("Previsión por zonas de la provincia de Misiones", [
    { t: "ZONA", w: 50 }, { t: "TEMP. MÍN", w: 42 }, { t: "TEMP. MÁX", w: 42 }, { t: "SENS. TÉRMICA", w: 56 },
    { t: "HUMEDAD REL.", w: 62 }, { t: "VIENTOS", w: 70 }, { t: "ESTADO DEL TIEMPO", w: 116 }, { t: "ALERTA", w: ANCHO - 438 },
  ], POR_ZONA.map((z) => { const d = b.zonas[z]; return [rotulo(z.toUpperCase()), { t: temp(d.tmin), bold: true, color: AZUL }, { t: temp(d.tmax), bold: true, color: ROJO }, d.sensacion, d.humedad, d.viento, { cond: d.condicion }, sinAviso(d.aviso)]; }));

  // --- previsión por principales ciudades -------------------------------------------------------------------------
  tabla("Previsión por principales ciudades de la provincia de Misiones", [
    { t: "CIUDAD", w: 120 }, { t: "TEMP. MÍN", w: 52 }, { t: "TEMP. MÁX", w: 52 }, { t: "ESTADO DEL TIEMPO", w: 190 }, { t: "ALERTA", w: ANCHO - 414 },
  ], b.localidades.map((l) => [rotulo(String(l.localidad).toUpperCase()), { t: temp(l.tmin), bold: true, color: AZUL }, { t: temp(l.tmax), bold: true, color: ROJO }, { cond: l.condicion }, sinAviso(b.zonas[l.zona]?.aviso)]));

  // --- previsión extendida ----------------------------------------------------------------------------------------
  doc.fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(12);
  espacio(30 + 16 + 28 * 2 + 20);
  doc.text("PREVISIÓN EXTENDIDA", M, doc.y, { width: ANCHO, align: "center", lineBreak: false });
  doc.y += 18;
  for (const z of POR_ZONA) {
    tabla(`Zona ${z}`, [
      { t: "FECHA", w: 90 }, { t: "TEMP. MÍN", w: 52 }, { t: "TEMP. MÁX", w: 52 }, { t: "ESTADO DEL TIEMPO", w: 190 }, { t: "ALERTA", w: ANCHO - 384 },
    ], b.extendido[z].map((d) => [rotulo(fechaCorta(d.fecha)), { t: temp(d.tmin), bold: true, color: AZUL }, { t: temp(d.tmax), bold: true, color: ROJO }, { cond: d.condicion }, d.aviso ? sinAviso(d.aviso) : ALERTA_VACIA]));
  }

  }

  espacio(40);
  doc.moveTo(M, doc.y).lineTo(M + ANCHO, doc.y).lineWidth(0.5).strokeColor(LINEA).stroke();
  doc.y += 6;
  doc.font("Oak-Bold").fontSize(8.5).fillColor(VERDE_OSCURO).text("INFORME ELABORADO POR", M, doc.y, { width: ANCHO });
  doc.font("Oak").fontSize(8.5).fillColor(GRIS).text(`${DIRECCION} – ${SUBSECRETARIA} – ${MINISTERIO}.`, M, doc.y, { width: ANCHO });
  doc.y += 4;
  doc.font("Oak").fontSize(8).fillColor(GRIS).text("FUENTES: SERVICIOS CLIMÁTICOS DEL SMN Y DE PORTALES QUE TRABAJAN CON MODELOS METEOROLÓGICOS WRF-GFS, NOAA, ECMWF, ICON, GEM.", M, doc.y, { width: ANCHO });

  // pie con el número de página, en todas (se escribe al final, cuando se sabe cuántas son)
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    doc.page.margins.bottom = 0; // para poder escribir en la franja del pie sin que pdfkit salte de página
    doc.moveTo(M, doc.page.height - 44).lineTo(M + ANCHO, doc.page.height - 44).lineWidth(0.5).strokeColor(LINEA).stroke();
    doc.font("Oak-Bold").fontSize(7.5).fillColor(VERDE_OSCURO).text(`${DIRECCION} · ${SUBSECRETARIA}`, M, doc.page.height - 38, { width: ANCHO, align: "center", lineBreak: false });
    doc.font("Oak").fontSize(7.5).fillColor(GRIS).text(MINISTERIO, M, doc.page.height - 28, { width: ANCHO, align: "center", lineBreak: false });
    doc.text(`Página ${i + 1} de ${paginas.count}`, M, doc.page.height - 18, { width: ANCHO, align: "center", lineBreak: false });
  }
  doc.end();
  return terminado;
}

module.exports = { generarInformePdf, errorDeInforme, ZONAS };

