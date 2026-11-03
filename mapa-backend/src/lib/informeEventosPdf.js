const path = require("path");
const crypto = require("crypto");
const PDFDocument = require("pdfkit");

/**
 * «Resumen de eventos» en PDF (ver informeEventos.js), con el mismo aspecto que el informe mensual: encabezado con logos y dirección, barras
 * verdes por sección, tablas con líneas finas, marca de agua, cifrado con permisos acotados y pie con el número de página.
 */
const DATA = path.join(__dirname, "..", "..", "data");
const FUENTE = { normal: path.join(DATA, "alertas", "OakSans-Regular.ttf"), bold: path.join(DATA, "alertas", "OakSans-Bold.ttf"), titulo: path.join(DATA, "alertas", "aviso-especial", "OakSans-ExtraBold.ttf") };
const LOGOS = { alerta: path.join(DATA, "brand", "alerta-temprana.png"), flor: path.join(DATA, "brand", "ecologia-flor.png") };
const DIRECCION = "Dirección General de Alerta Temprana";
const SUBSECRETARIA = "Subsecretaría de Ordenamiento Territorial";
const MINISTERIO = "Ministerio de Ecología y Recursos Naturales Renovables de la Provincia de Misiones";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const VERDE = "#3E6C51", VERDE_OSCURO = "#234131", GRIS = "#5d6f64", LINEA = "#cdd8d1", TEXTO = "#1b2a22";
const NIVEL_FONDO = { Amarillo: "#FFF2B3", Naranja: "#FFD3A6", Rojo: "#F5B5BD" };
const M = 36, ANCHO = 595.28 - 2 * M, PIE = 36;

const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const hora = (iso) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", "") : "—");
const horaCompleta = (iso) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", "") : "—");
const finRedondo = (iso) => (iso && new Date(iso).getUTCSeconds() === 59 ? new Date(Date.parse(iso) + 1000).toISOString() : iso);
const lista = (xs) => (xs.length ? xs.join(", ") : "—");

/** Una de las dos formas del período: «DEL MES DE OCTUBRE DE 2026» (el mes entero) o «DEL 26/10 AL 01/11 DE 2026». */
function subtituloDe(desde, hasta) {
  const [a, m] = [desde.slice(0, 4), Number(desde.slice(5, 7))];
  const ultimo = new Date(Date.UTC(Number(a), m, 0)).getUTCDate();
  if (desde.slice(0, 7) === hasta.slice(0, 7) && desde.endsWith("-01") && Number(hasta.slice(8, 10)) === ultimo) return `DEL MES DE ${MESES[m - 1].toUpperCase()} DE ${a}`;
  return `DEL ${dm(desde)} AL ${dm(hasta)} DE ${hasta.slice(0, 4)}`;
}

async function generarInformeEventosPdf(datos, { claveDuenio = process.env.PDF_OWNER_PASSWORD } = {}) {
  const { desde, hasta, resumen: r } = datos;
  const sub = subtituloDe(desde, hasta);
  const chunks = [];
  const doc = new PDFDocument({
    size: "A4", margins: { top: M, bottom: PIE + 18, left: M, right: M }, bufferPages: true, pdfVersion: "1.7ext3",
    ownerPassword: claveDuenio || crypto.randomBytes(24).toString("hex"),
    permissions: { printing: "highResolution", modifying: false, copying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false },
    info: { Title: `Resumen de eventos ${sub.toLowerCase()}`, Author: "Dirección General de Alerta Temprana — Ministerio de Ecología y RNR de Misiones", Subject: "Resumen de eventos", Creator: "Sistema de Alerta Temprana" },
  });
  doc.on("data", (c) => chunks.push(c));
  const terminado = new Promise((ok, mal) => { doc.on("end", () => ok(Buffer.concat(chunks))); doc.on("error", mal); });
  doc.registerFont("Oak", FUENTE.normal); doc.registerFont("Oak-Bold", FUENTE.bold); doc.registerFont("Oak-Titulo", FUENTE.titulo);
  const limite = () => doc.page.height - doc.page.margins.bottom;
  const espacio = (alto) => { if (doc.y + alto > limite()) doc.addPage(); };

  const marcaDeAgua = () => {
    doc.save();
    doc.fillOpacity(0.055).fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(46);
    doc.rotate(-38, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.text("MINISTERIO DE ECOLOGÍA", 0, doc.page.height / 2 - 52, { width: doc.page.width, align: "center", lineBreak: false });
    doc.fontSize(34).text("ALERTA TEMPRANA", 0, doc.page.height / 2 + 4, { width: doc.page.width, align: "center", lineBreak: false });
    doc.restore();
  };
  let numero = 0;
  doc.on("pageAdded", () => {
    numero++; marcaDeAgua();
    if (numero === 1) return;
    doc.font("Oak-Bold").fontSize(8).fillColor(GRIS).text(`RESUMEN DE EVENTOS · ${sub}`, M, 18, { width: ANCHO, lineBreak: false });
    doc.y = M;
  });
  numero++; marcaDeAgua();

  const barra = (titulo, reserva = 60) => {
    espacio(28 + reserva);
    const y = doc.y;
    doc.roundedRect(M, y, ANCHO, 20, 4).fill(VERDE);
    doc.fillColor("#fff").font("Oak-Bold").fontSize(10.5).text(titulo.toUpperCase(), M + 10, y + 5.5, { width: ANCHO - 20, lineBreak: false });
    doc.y = y + 28;
  };
  const nota = (texto) => { doc.font("Oak").fontSize(8.5).fillColor(GRIS); espacio(doc.heightOfString(texto, { width: ANCHO }) + 6); doc.text(texto, M, doc.y, { width: ANCHO }); doc.y += 6; };
  /** Tabla con la cabecera repetida en cada página y filas de alto variable. `cols`: [{ t, w (peso), centro, nivel }]. */
  const tabla = (cols, filas, vacio = "Sin registros en este período.") => {
    if (!filas.length) { doc.font("Oak").fontSize(9).fillColor(GRIS).text(vacio, M + 4, doc.y, { width: ANCHO }); doc.y += 16; return; }
    const total = cols.reduce((n, c) => n + c.w, 0), ws = cols.map((c) => (c.w / total) * ANCHO), xs = [];
    { let x = M; for (const w of ws) { xs.push(x); x += w; } }
    const cabecera = () => {
      doc.font("Oak-Bold").fontSize(7.5);
      const alto = Math.max(...cols.map((c, i) => doc.heightOfString(c.t, { width: ws[i] - 8 }))) + 9, y = doc.y;
      doc.rect(M, y, ANCHO, alto).fill("#eaf2ee");
      doc.fillColor(VERDE_OSCURO); cols.forEach((c, i) => doc.text(c.t, xs[i] + 4, y + 4.5, { width: ws[i] - 8, align: c.centro ? "center" : "left" }));
      doc.y = y + alto;
    };
    espacio(60); cabecera();
    for (const f of filas) {
      doc.font("Oak").fontSize(8.5);
      const alto = Math.max(...f.map((v, i) => doc.heightOfString(String(v ?? "—"), { width: ws[i] - 8 }))) + 8;
      if (doc.y + alto > limite()) { doc.addPage(); cabecera(); }
      const y = doc.y;
      f.forEach((v, i) => {
        const texto = String(v ?? "—");
        if (cols[i].nivel && NIVEL_FONDO[texto]) doc.rect(xs[i] + 1, y + 1, ws[i] - 2, alto - 2).fill(NIVEL_FONDO[texto]);
        doc.fillColor(TEXTO).font(cols[i].negrita ? "Oak-Bold" : "Oak").fontSize(8.5).text(texto, xs[i] + 4, y + 4, { width: ws[i] - 8, align: cols[i].centro ? "center" : "left" });
      });
      doc.moveTo(M, y + alto).lineTo(M + ANCHO, y + alto).lineWidth(0.5).strokeColor(LINEA).stroke();
      doc.y = y + alto;
    }
    doc.y += 10;
  };
  const conteo = (lista_) => lista_.map((x) => [x.nombre, x.cantidad]);

  // --- encabezado ---------------------------------------------------------------------------------------------------
  doc.image(LOGOS.alerta, M - 6, M - 14, { width: 92 });
  doc.image(LOGOS.flor, M + ANCHO - 44, M - 2, { width: 44 });
  const centro = { width: ANCHO, align: "center", lineBreak: false };
  doc.fillColor(VERDE_OSCURO).font("Oak-Titulo").fontSize(17).text("RESUMEN DE EVENTOS", M, M - 6, centro);
  doc.font("Oak-Bold").fontSize(11.5).fillColor(VERDE).text(sub, M, M + 16, centro);
  doc.font("Oak-Bold").fontSize(8.5).fillColor(VERDE_OSCURO).text(DIRECCION, M, M + 33, centro);
  doc.font("Oak").fontSize(7.5).fillColor(GRIS).text(SUBSECRETARIA, M, M + 44, centro);
  doc.text(MINISTERIO, M, M + 54, centro);
  doc.moveTo(M, M + 70).lineTo(M + ANCHO, M + 70).lineWidth(1.5).strokeColor(VERDE).stroke();
  doc.y = M + 84;

  // --- 1. resumen -----------------------------------------------------------------------------------------------------
  barra("Resumen del período");
  tabla([{ t: "CONCEPTO", w: 4 }, { t: "CANTIDAD", w: 1, centro: true, negrita: true }], [
    ["Avisos a muy corto plazo (ACP) del SMN", r.acp], ["Alertas del SMN para Misiones (por emisión)", r.alertasSmn], ["Alertas meteorológicas publicadas por el Ministerio", r.alertasPublicadas],
    ["Avisos a muy corto plazo publicados por el Ministerio", r.avisosPropios], ["Avisos especiales", r.avisosEspeciales], ...(r.eventos ? [["Eventos climáticos registrados", r.eventos]] : []),
  ]);
  if (!datos.conBase) nota("Sin conexión a la base de datos: solo se muestra lo que no depende de ella.");

  // --- 2. ACP -------------------------------------------------------------------------------------------------------
  barra("Avisos a muy corto plazo (ACP) del SMN");
  tabla([{ t: "N°", w: 0.5, centro: true }, { t: "INICIO", w: 1.3 }, { t: "FIN", w: 1.3 }, { t: "NIVEL", w: 1.1, nivel: true, centro: true }, { t: "EVENTO", w: 1.9 }, { t: "DEPARTAMENTOS", w: 4.4 }],
    datos.acp.map((a, i) => [i + 1, hora(a.inicio), hora(a.fin), a.nivel, a.evento, lista(a.departamentos)]));
  if (datos.acp.length) {
    doc.font("Oak-Bold").fontSize(9).fillColor(VERDE_OSCURO); espacio(60); doc.text("Por evento y por departamento", M, doc.y); doc.y += 4;
    tabla([{ t: "EVENTO", w: 3 }, { t: "AVISOS", w: 1, centro: true, negrita: true }], conteo(r.acpPorEvento));
    tabla([{ t: "DEPARTAMENTO (avisos que lo incluyen)", w: 3 }, { t: "AVISOS", w: 1, centro: true, negrita: true }], conteo(r.acpPorDepartamento));
  }

  // --- 3. alertas del SMN --------------------------------------------------------------------------------------------
  barra("Alertas del SMN para Misiones");
  nota("Cada fila es una emisión del SMN: el nivel más alto, los fenómenos, el rango completo y todos los departamentos que nombra.");
  tabla([{ t: "N°", w: 0.5, centro: true }, { t: "EMITIDA", w: 1.3 }, { t: "NIVEL", w: 1.1, nivel: true, centro: true }, { t: "FENÓMENOS", w: 2 }, { t: "DESDE", w: 1.2 }, { t: "HASTA", w: 1.2 }, { t: "DEPARTAMENTOS", w: 3.2 }],
    datos.alertasSmn.map((a, i) => [i + 1, hora(a.emitidoEn), a.nivel, lista(a.fenomenos), hora(a.inicio), hora(a.fin), a.departamentos.length === 17 ? "Toda la provincia (17)" : lista(a.departamentos)]));

  // --- 4. alertas publicadas ------------------------------------------------------------------------------------------
  barra("Alertas meteorológicas publicadas por el Ministerio");
  tabla([{ t: "N°", w: 0.5, centro: true }, { t: "PUBLICADA", w: 1.3 }, { t: "NIVEL", w: 1.1, nivel: true, centro: true }, { t: "FENÓMENOS", w: 2 }, { t: "PERÍODO", w: 2.2 }, { t: "ORIGEN", w: 0.9, centro: true }, { t: "DEPARTAMENTOS", w: 2.8 }],
    datos.alertasPublicadas.map((a) => [a.id, hora(a.publicadoEn), a.nivel, lista(a.fenomenos), a.periodo || "—", a.origen, a.departamentos.length === 17 ? "Toda la provincia (17)" : lista(a.departamentos)]));

  // --- 5. avisos del Ministerio ---------------------------------------------------------------------------------------
  barra("Avisos a muy corto plazo publicados por el Ministerio");
  tabla([{ t: "N°", w: 0.5, centro: true }, { t: "FECHA", w: 1.3 }, { t: "VÁLIDO HASTA", w: 1.3 }, { t: "AVISO", w: 5.5 }],
    datos.avisosPropios.map((a) => [a.id, hora(a.fecha), hora(a.vigenteHasta), String(a.texto || a.titulo || "").replace(/\n{2,}/g, "\n").split("\n").slice(0, 4).join(" · ")]));
  if (datos.avisosEspeciales.length) {
    barra("Avisos especiales");
    tabla([{ t: "FECHA", w: 1.3 }, { t: "TÍTULO", w: 2 }, { t: "TEXTO", w: 4.6 }], datos.avisosEspeciales.map((a) => [hora(a.fecha), a.titulo || "—", String(a.texto || "").replace(/\s*\n+\s*/g, " ")]));
  }
  if (datos.eventos.length) {
    barra("Eventos climáticos registrados");
    tabla([{ t: "DESDE", w: 1 }, { t: "HASTA", w: 1 }, { t: "TIPO", w: 1.4 }, { t: "TÍTULO", w: 2.6 }, { t: "LUGAR", w: 2 }, { t: "SEVERIDAD", w: 1, centro: true }],
      datos.eventos.map((e) => [e.desde.split("-").reverse().join("/"), e.hasta ? e.hasta.split("-").reverse().join("/") : "—", e.tipo, e.titulo, e.lugar || "—", e.severidad || "—"]));
  }

  espacio(40);
  doc.moveTo(M, doc.y).lineTo(M + ANCHO, doc.y).lineWidth(0.5).strokeColor(LINEA).stroke();
  doc.y += 6;
  doc.font("Oak-Bold").fontSize(8.5).fillColor(VERDE_OSCURO).text("INFORME ELABORADO POR", M, doc.y, { width: ANCHO });
  doc.font("Oak").fontSize(8.5).fillColor(GRIS).text(`${DIRECCION} – ${SUBSECRETARIA} – ${MINISTERIO}.`, M, doc.y, { width: ANCHO });
  doc.font("Oak").fontSize(7.5).text(`Fuente: historial del SMN y registros del sistema de alerta temprana. Generado el ${horaCompleta(new Date().toISOString())} h.`, M, doc.y + 2, { width: ANCHO });

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

module.exports = { generarInformeEventosPdf, subtituloDe };
