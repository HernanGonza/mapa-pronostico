const path = require("path");
const crypto = require("crypto");
const PDFDocument = require("pdfkit");
const { errorDeInformeMensual, normalizarInformeMensual, MESES } = require("./informeMensual");

/**
 * «BALANCE HIDROMETEOROLÓGICO DEL MES DE …» en PDF, con el mismo aspecto que el informe de «Previsión del tiempo»
 * (informePronosticoPdf.js): encabezado con los logos y la dirección, barras verdes por sección, tablas con líneas finas, marca de agua,
 * cifrado con permisos acotados y pie con el número de página. El contenido sigue el modelo de la DGAT (ver informeMensual.js).
 */
const DATA = path.join(__dirname, "..", "..", "data");
const FUENTE = { normal: path.join(DATA, "alertas", "OakSans-Regular.ttf"), bold: path.join(DATA, "alertas", "OakSans-Bold.ttf"), titulo: path.join(DATA, "alertas", "aviso-especial", "OakSans-ExtraBold.ttf") };
const LOGOS = { alerta: path.join(DATA, "brand", "alerta-temprana.png"), flor: path.join(DATA, "brand", "ecologia-flor.png") };
const DIRECCION = "Dirección General de Alerta Temprana";
const SUBSECRETARIA = "Subsecretaría de Ordenamiento Territorial";
const MINISTERIO = "Ministerio de Ecología y Recursos Naturales Renovables de la Provincia de Misiones";

const VERDE = "#3E6C51", VERDE_OSCURO = "#234131", GRIS = "#5d6f64", LINEA = "#cdd8d1", ROJO = "#B3262F", AZUL = "#1F5F9E", TEXTO = "#1b2a22";
const M = 36, ANCHO = 595.28 - 2 * M, PIE = 36;
const REFERENCIAS = "° C  Grados Celsius      N°  Número de eventos      mm  Milímetros de precipitación";

const dato = (v, sufijo = "") => (String(v ?? "").trim() ? `${String(v).trim()}${sufijo}` : "—");
const dataUrl = (s) => (s ? Buffer.from(s.slice(s.indexOf(",") + 1), "base64") : null);

async function generarInformeMensualPdf(entrada, { claveDuenio = process.env.PDF_OWNER_PASSWORD } = {}) {
  const error = errorDeInformeMensual(entrada);
  if (error) throw Object.assign(new Error(error), { status: 400 });
  const b = normalizarInformeMensual(entrada);
  const mesAnio = `${MESES[b.mes - 1]} de ${b.anio}`;

  const chunks = [];
  const doc = new PDFDocument({
    size: "A4", margins: { top: M, bottom: PIE + 18, left: M, right: M }, bufferPages: true, pdfVersion: "1.7ext3",
    ownerPassword: claveDuenio || crypto.randomBytes(24).toString("hex"),
    permissions: { printing: "highResolution", modifying: false, copying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false },
    info: { Title: `Balance hidrometeorológico del mes de ${mesAnio}`, Author: "Dirección General de Alerta Temprana — Ministerio de Ecología y RNR de Misiones", Subject: "Informe mensual", Creator: "Sistema de Alerta Temprana" },
  });
  doc.on("data", (c) => chunks.push(c));
  const terminado = new Promise((ok, mal) => { doc.on("end", () => ok(Buffer.concat(chunks))); doc.on("error", mal); });
  doc.registerFont("Oak", FUENTE.normal); doc.registerFont("Oak-Bold", FUENTE.bold); doc.registerFont("Oak-Titulo", FUENTE.titulo);

  const limite = () => doc.page.height - doc.page.margins.bottom;
  const espacio = (alto) => { if (doc.y + alto > limite()) doc.addPage(); };

  function marcaDeAgua() {
    doc.save();
    doc.fillOpacity(0.055).fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(46);
    doc.rotate(-38, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.text("MINISTERIO DE ECOLOGÍA", 0, doc.page.height / 2 - 52, { width: doc.page.width, align: "center", lineBreak: false });
    doc.fontSize(34).text("ALERTA TEMPRANA", 0, doc.page.height / 2 + 4, { width: doc.page.width, align: "center", lineBreak: false });
    doc.restore();
  }
  let numero = 0;
  doc.on("pageAdded", () => {
    numero++;
    marcaDeAgua();
    if (numero === 1) return;
    doc.font("Oak-Bold").fontSize(8).fillColor(GRIS).text(`BALANCE HIDROMETEOROLÓGICO · ${mesAnio.toUpperCase()}`, M, 18, { width: ANCHO, lineBreak: false });
    doc.y = M;
  });
  numero++; marcaDeAgua();

  /** `reserva`: lo que tiene que entrar debajo de la barra (la imagen): si no entra todo junto, la barra pasa a la página siguiente. */
  const barra = (titulo, reserva = 40) => {
    espacio(28 + reserva);
    const y = doc.y;
    doc.roundedRect(M, y, ANCHO, 20, 4).fill(VERDE);
    doc.fillColor("#fff").font("Oak-Bold").fontSize(10.5).text(titulo.toUpperCase(), M + 10, y + 5.5, { width: ANCHO - 20, lineBreak: false });
    doc.y = y + 28;
  };
  /** Texto libre: un párrafo por renglón en blanco o salto de línea, justificado. */
  const parrafos = (texto) => {
    for (const p of String(texto || "").split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
      doc.font("Oak").fontSize(9.5);
      espacio(Math.min(doc.heightOfString(p, { width: ANCHO - 6 }), 60) + 6);
      doc.fillColor(TEXTO).text(p, M + 2, doc.y, { width: ANCHO - 6, align: "justify" });
      doc.y += 5;
    }
  };
  /**
   * Las imágenes de una sección, EN LÍNEA: todas con el mismo alto, que se calcula para que juntas ocupen el ancho de la hoja
   * (menos imágenes o más angostas → más grandes; más imágenes o más anchas → más chicas), sin pasar de `altoMax`. Si quedan
   * más chicas que `altoMin` (muchas imágenes muy anchas), se parten en dos filas.
   */
  const SEPARACION = 8;
  const medidasFila = (items, altoMax) => {
    const razon = items.reduce((n, i) => n + i.width / i.height, 0);
    const h = Math.min(altoMax, (ANCHO - SEPARACION * (items.length - 1)) / razon);
    return { h, items: items.map((i) => ({ ...i, w: (i.width / i.height) * h })) };
  };
  const filasDeImagenes = (lista, altoMax) => {
    const items = lista.map((u) => { const buf = dataUrl(u), { width, height } = doc.openImage(buf); return { buf, width, height }; });
    if (!items.length) return [];
    const una = medidasFila(items, altoMax);
    if (items.length < 3 || una.h >= 90) return [una];
    const mitad = Math.ceil(items.length / 2);
    return [medidasFila(items.slice(0, mitad), altoMax), medidasFila(items.slice(mitad), altoMax)];
  };
  const alturaImagenes = (filas) => filas.reduce((n, f) => n + f.h + 6, 0);
  const dibujarImagenes = (filas) => {
    for (const f of filas) {
      espacio(f.h + 8);
      const total = f.items.reduce((n, i) => n + i.w, 0) + SEPARACION * (f.items.length - 1);
      let x = M + (ANCHO - total) / 2;
      for (const i of f.items) { doc.image(i.buf, x, doc.y, { width: i.w, height: f.h }); x += i.w + SEPARACION; }
      doc.y += f.h + 8;
    }
  };

  // --- encabezado (igual al de la previsión del tiempo) -----------------------------------------------------------
  doc.image(LOGOS.alerta, M - 6, M - 14, { width: 92 });
  doc.image(LOGOS.flor, M + ANCHO - 44, M - 2, { width: 44 });
  const centro = { width: ANCHO, align: "center", lineBreak: false };
  doc.fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(17).text("BALANCE HIDROMETEOROLÓGICO", M, M - 6, centro);
  doc.font("Oak-Bold").fontSize(11.5).fillColor(VERDE).text(`DEL MES DE ${MESES[b.mes - 1].toUpperCase()} DE ${b.anio}`, M, M + 16, centro);
  doc.font("Oak-Bold").fontSize(8.5).fillColor(VERDE_OSCURO).text(DIRECCION, M, M + 33, centro);
  doc.font("Oak").fontSize(7.5).fillColor(GRIS).text(SUBSECRETARIA, M, M + 44, centro);
  doc.text(MINISTERIO, M, M + 54, centro);
  doc.moveTo(M, M + 70).lineTo(M + ANCHO, M + 70).lineWidth(1.5).strokeColor(VERDE).stroke();
  doc.y = M + 84;

  // --- 1. valores medios del mes ----------------------------------------------------------------------------------
  barra("Valores medios del mes");
  const cols = [
    { t: "ESTACIÓN", w: 118 }, { t: "TEMPERATURA MEDIA (°C)", w: 80, centro: true, color: TEXTO }, { t: "TEMPERATURA MÍNIMA MEDIA (°C)", w: 82, centro: true, color: AZUL },
    { t: "TEMPERATURA MÁXIMA MEDIA (°C)", w: 82, centro: true, color: ROJO }, { t: "EVENTOS HIDROMETEOROLÓGICOS (N°)", w: 86, centro: true },
  ];
  cols.push({ t: "PRECIPITACIÓN ACUMULADA (mm)", w: ANCHO - cols.reduce((s, c) => s + c.w, 0), centro: true });
  const xs = []; { let x = M; for (const c of cols) { xs.push(x); x += c.w; } }
  doc.font("Oak-Bold").fontSize(7.5);
  const altoCab = Math.max(...cols.map((c) => doc.heightOfString(c.t, { width: c.w - 8, align: c.centro ? "center" : "left" }))) + 10;
  const cabecera = () => {
    const y = doc.y;
    doc.rect(M, y, ANCHO, altoCab).fill("#eaf2ee");
    doc.fillColor(VERDE_OSCURO).font("Oak-Bold").fontSize(7.5);
    cols.forEach((c, i) => doc.text(c.t, xs[i] + 4, y + 5, { width: c.w - 8, align: c.centro ? "center" : "left" }));
    doc.y = y + altoCab;
  };
  espacio(altoCab + 26);
  cabecera();
  const filas = b.estaciones.length ? b.estaciones : [];
  for (const e of filas) {
    if (doc.y + 26 > limite()) { doc.addPage(); cabecera(); }
    const y = doc.y, valores = [dato(e.estacion).toUpperCase(), dato(e.tmedia), dato(e.tmin), dato(e.tmax), dato(e.eventos), dato(e.precipitacion)];
    cols.forEach((c, i) => {
      doc.fillColor(i === 0 ? VERDE_OSCURO : c.color || TEXTO).font(i === 0 ? "Oak-Bold" : "Oak-Bold").fontSize(9.5);
      doc.text(valores[i], xs[i] + 4, y + 8, { width: c.w - 8, align: c.centro ? "center" : "left", lineBreak: false });
    });
    doc.moveTo(M, y + 26).lineTo(M + ANCHO, y + 26).lineWidth(0.5).strokeColor(LINEA).stroke();
    doc.y = y + 26;
  }
  if (!filas.length) { doc.fillColor(GRIS).font("Oak").fontSize(9).text("Sin estaciones cargadas.", M + 4, doc.y + 6); doc.y += 24; }
  doc.y += 6;
  doc.font("Oak").fontSize(8).fillColor(GRIS).text(REFERENCIAS, M, doc.y, { width: ANCHO, align: "center" });
  doc.y += 14;

  // --- 2. resumen meteorológico del mes ---------------------------------------------------------------------------
  barra("Resumen meteorológico del mes");
  parrafos(b.resumen);
  doc.y += 6;

  // --- 3. pronóstico climático trimestral -------------------------------------------------------------------------
  const ALTO_TRIM = 255, ALTO_NINO = 230;
  const filasTrim = filasDeImagenes(b.trimestral.imagenes, ALTO_TRIM);
  barra("Pronóstico climático trimestral", alturaImagenes(filasTrim) + 40);
  dibujarImagenes(filasTrim);
  parrafos(b.trimestral.texto);
  doc.y += 6;

  // --- 4. estado actual y proyección del fenómeno del Niño --------------------------------------------------------
  const filasNino = filasDeImagenes(b.nino.imagenes, ALTO_NINO);
  barra("Estado actual y proyección del fenómeno del Niño", alturaImagenes(filasNino) + 40);
  dibujarImagenes(filasNino);
  parrafos(b.nino.texto);

  espacio(40);
  doc.moveTo(M, doc.y).lineTo(M + ANCHO, doc.y).lineWidth(0.5).strokeColor(LINEA).stroke();
  doc.y += 6;
  doc.font("Oak-Bold").fontSize(8.5).fillColor(VERDE_OSCURO).text("INFORME ELABORADO POR", M, doc.y, { width: ANCHO });
  doc.font("Oak").fontSize(8.5).fillColor(GRIS).text(`${DIRECCION} – ${SUBSECRETARIA} – ${MINISTERIO}.`, M, doc.y, { width: ANCHO });

  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    doc.page.margins.bottom = 0;
    doc.moveTo(M, doc.page.height - 44).lineTo(M + ANCHO, doc.page.height - 44).lineWidth(0.5).strokeColor(LINEA).stroke();
    doc.font("Oak-Bold").fontSize(7.5).fillColor(VERDE_OSCURO).text(`${DIRECCION} · ${SUBSECRETARIA}`, M, doc.page.height - 38, { width: ANCHO, align: "center", lineBreak: false });
    doc.font("Oak").fontSize(7.5).fillColor(GRIS).text(MINISTERIO, M, doc.page.height - 28, { width: ANCHO, align: "center", lineBreak: false });
    doc.text(`Página ${i + 1} de ${paginas.count}`, M, doc.page.height - 18, { width: ANCHO, align: "center", lineBreak: false });
  }
  doc.end();
  return terminado;
}

module.exports = { generarInformeMensualPdf };
